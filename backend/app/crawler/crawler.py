from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from protego import Protego

from app.config import settings
from app.crawler.extractor import ExtractedPage, extract_page_data, rendered_content_differs
from app.crawler.storage import CrawlStorage

logger = logging.getLogger(__name__)

try:
    from playwright.async_api import Browser, Error as PlaywrightError, async_playwright
except Exception:  # pragma: no cover - import may fail when browsers are not installed
    Browser = None  # type: ignore[misc, assignment]
    PlaywrightError = Exception
    async_playwright = None


@dataclass(slots=True)
class CrawlResult:
    page: ExtractedPage
    discovered_urls: list[str]


class CrawlerService:
    def __init__(
        self,
        *,
        start_url: str,
        max_pages: int = 200,
        max_depth: int = 3,
        concurrency: int | None = None,
        request_delay: float | None = None,
        thin_content_threshold: int | None = None,
        user_agent: str | None = None,
        storage: CrawlStorage | None = None,
        render_js_when_thin: bool = True,
        progress_callback: Callable[[], None] | None = None,
    ) -> None:
        parsed = urlparse(start_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("start_url must be a valid absolute http/https URL.")

        self.start_url = start_url
        self.root_host = parsed.hostname
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.concurrency = concurrency or settings.CRAWLER_CONCURRENCY
        self.request_delay = request_delay if request_delay is not None else settings.CRAWLER_REQUEST_DELAY
        self.thin_content_threshold = (
            thin_content_threshold
            if thin_content_threshold is not None
            else settings.CRAWLER_THIN_CONTENT_THRESHOLD
        )
        self.user_agent = user_agent or settings.CRAWLER_USER_AGENT
        self.storage = storage or CrawlStorage(flush_size=settings.CRAWLER_FLUSH_SIZE)
        self.render_js_when_thin = render_js_when_thin
        self.progress_callback = progress_callback
        self.flush_interval = settings.CRAWLER_FLUSH_INTERVAL

        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._last_request_at: dict[str, float] = {}
        self._host_locks: dict[str, asyncio.Lock] = {}
        self._robots_cache: dict[str, Protego] = {}
        self._browser: Browser | None = None
        self._playwright = None
        self._playwright_failed = False

    async def crawl(self, crawl_run_id: int) -> None:
        self.storage.set_run_started(crawl_run_id)

        timeout = httpx.Timeout(20.0, connect=10.0)
        headers = {"User-Agent": self.user_agent}
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            headers=headers,
        ) as client:
            flush_stop = asyncio.Event()
            flush_task = asyncio.create_task(self._periodic_flush(flush_stop))
            queue: deque[tuple[str, int]] = deque([(self.start_url, 0)])
            visited: set[str] = set()

            try:
                while queue and len(visited) < self.max_pages:
                    current_depth = queue[0][1]
                    level: list[str] = []

                    while (
                        queue
                        and queue[0][1] == current_depth
                        and len(visited) + len(level) < self.max_pages
                    ):
                        url, _ = queue.popleft()
                        if url in visited:
                            continue
                        visited.add(url)
                        level.append(url)

                    if not level:
                        continue

                    results = await asyncio.gather(
                        *(self._crawl_single_url(client, url) for url in level)
                    )

                    for result in results:
                        if result is None:
                            continue
                        await self.storage.add(crawl_run_id, result.page)
                        if self.progress_callback is not None:
                            self.progress_callback()

                        if current_depth >= self.max_depth:
                            continue

                        for discovered_url in result.discovered_urls:
                            if discovered_url in visited:
                                continue
                            queue.append((discovered_url, current_depth + 1))

                await self.storage.flush()
            except Exception:
                await self.storage.flush()
                self.storage.set_run_failed(crawl_run_id)
                raise
            finally:
                flush_stop.set()
                await flush_task
                await self._close_playwright()

    async def _crawl_single_url(self, client: httpx.AsyncClient, url: str) -> CrawlResult | None:
        async with self._semaphore:
            if not await self._is_allowed_by_robots(client, url):
                return None

            raw_page = await self._fetch_with_httpx(client, url)
            if raw_page is None:
                return None

            final_page = raw_page
            if self._should_render_js(raw_page):
                rendered_page = await self._fetch_with_playwright(url)
                if rendered_page is not None:
                    rendered_page.js_rendered = True
                    rendered_page.rendered_diff_significant = rendered_content_differs(
                        raw_page, rendered_page
                    )
                    final_page = rendered_page

            discovered_urls = [
                link.target_url for link in final_page.links if link.is_internal
            ]
            return CrawlResult(page=final_page, discovered_urls=discovered_urls)

    async def _fetch_with_httpx(
        self,
        client: httpx.AsyncClient,
        url: str,
    ) -> ExtractedPage | None:
        host = urlparse(url).hostname or self.root_host
        await self._respect_host_delay(host)

        started = time.perf_counter()
        try:
            response = await client.get(url)
        except httpx.HTTPError:
            elapsed_ms = (time.perf_counter() - started) * 1000
            return ExtractedPage(
                url=url,
                html=None,
                status_code=None,
                response_time_ms=elapsed_ms,
                redirect_hops=0,
                title=None,
                meta_description=None,
                canonical_url=None,
                meta_robots=None,
            )

        elapsed_ms = (time.perf_counter() - started) * 1000
        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type:
            return ExtractedPage(
                url=str(response.url),
                html=None,
                status_code=response.status_code,
                response_time_ms=elapsed_ms,
                redirect_hops=len(response.history),
                title=None,
                meta_description=None,
                canonical_url=None,
                meta_robots=None,
            )

        return extract_page_data(
            url=str(response.url),
            html=response.text,
            status_code=response.status_code,
            response_time_ms=elapsed_ms,
            root_host=self.root_host,
            redirect_hops=len(response.history),
        )

    async def _fetch_with_playwright(self, url: str) -> ExtractedPage | None:
        browser = await self._ensure_browser()
        if browser is None:
            return None

        page = await browser.new_page(user_agent=self.user_agent)
        try:
            started = time.perf_counter()
            response = await page.goto(url, wait_until="networkidle", timeout=30000)
            html = await page.content()
            elapsed_ms = (time.perf_counter() - started) * 1000
            return extract_page_data(
                url=page.url,
                html=html,
                status_code=response.status if response else None,
                response_time_ms=elapsed_ms,
                root_host=self.root_host,
                redirect_hops=0,
            )
        except PlaywrightError:
            return None
        finally:
            await page.close()

    async def _ensure_browser(self) -> Browser | None:
        if self._browser is not None:
            return self._browser
        if async_playwright is None or not self.render_js_when_thin:
            return None
        if self._playwright_failed:
            return None

        try:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(headless=True)
            return self._browser
        except Exception as exc:
            # Playwright is optional. On Windows under uvicorn's default event loop
            # it can fail with NotImplementedError; continue with httpx-only crawls.
            logger.warning("Playwright unavailable, continuing with HTML crawl only: %s", exc)
            self._playwright_failed = True
            self._browser = None
            self._playwright = None
            return None

    async def _close_playwright(self) -> None:
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    async def _is_allowed_by_robots(self, client: httpx.AsyncClient, url: str) -> bool:
        parsed = urlparse(url)
        host = parsed.hostname
        if not host:
            return False

        if host not in self._robots_cache:
            robots_url = f"{parsed.scheme}://{host}/robots.txt"
            try:
                response = await client.get(robots_url)
                body = response.text if response.status_code < 400 else ""
            except httpx.HTTPError:
                body = ""
            self._robots_cache[host] = Protego.parse(body)

        return self._robots_cache[host].can_fetch(url, self.user_agent)

    async def _respect_host_delay(self, host: str) -> None:
        lock = self._host_locks.setdefault(host, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            last_request_at = self._last_request_at.get(host)
            crawl_delay = 0.0
            parser = self._robots_cache.get(host)
            if parser is not None:
                crawl_delay = parser.crawl_delay(self.user_agent) or 0.0
            effective_delay = max(self.request_delay, crawl_delay)
            if last_request_at is not None:
                wait_time = effective_delay - (now - last_request_at)
                if wait_time > 0:
                    await asyncio.sleep(wait_time)
            self._last_request_at[host] = time.monotonic()

    def _should_render_js(self, page: ExtractedPage) -> bool:
        return (
            self.render_js_when_thin
            and not self._playwright_failed
            and page.html is not None
            and (page.status_code is None or page.status_code < 400)
            and page.word_count < self.thin_content_threshold
            and async_playwright is not None
        )

    async def _periodic_flush(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self.flush_interval)
            except asyncio.TimeoutError:
                await self.storage.flush()
