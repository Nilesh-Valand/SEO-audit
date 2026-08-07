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
from app.crawler.extractor import (
    ExtractedPage,
    RedirectHop,
    extract_page_data,
    is_http_url,
    rendered_content_differs,
)
from app.crawler.storage import CrawlStorage
from app.crawler.normalize import normalize_url, prefer_www_from_seed

logger = logging.getLogger(__name__)

# Cap resource HEADs used for approximate page weight.
_MAX_WEIGHT_RESOURCES = 40

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
        self.prefer_www = prefer_www_from_seed(start_url)

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
            # Page crawl only — SITE / PAGE / CROSS_PAGE / HOMEPAGE checks are owned
            # by checks.orchestrator (phases 2–5), not the crawler loop.
            flush_stop = asyncio.Event()
            flush_task = asyncio.create_task(self._periodic_flush(flush_stop))
            start = normalize_url(self.start_url, prefer_www=self.prefer_www)
            queue: deque[tuple[str, int]] = deque([(start, 0)])
            visited: set[str] = set()
            stored_urls: set[str] = set()

            try:
                while queue and len(stored_urls) < self.max_pages:
                    current_depth = queue[0][1]
                    level: list[str] = []

                    while (
                        queue
                        and queue[0][1] == current_depth
                        and len(stored_urls) + len(level) < self.max_pages
                    ):
                        url, _ = queue.popleft()
                        key = normalize_url(url, prefer_www=self.prefer_www)
                        if key in visited:
                            continue
                        visited.add(key)
                        level.append(key)

                    if not level:
                        continue

                    results = await asyncio.gather(
                        *(self._crawl_single_url(client, url) for url in level),
                        return_exceptions=True,
                    )

                    for url, result in zip(level, results, strict=True):
                        if isinstance(result, BaseException):
                            logger.exception("Failed crawling %s: %s", url, result)
                            continue
                        if result is None:
                            continue

                        raw_final = result.page.url or url
                        final_key = normalize_url(raw_final, prefer_www=self.prefer_www)
                        visited.add(final_key)
                        if final_key in stored_urls:
                            continue
                        if len(stored_urls) >= self.max_pages:
                            break

                        result.page.raw_url = raw_final
                        result.page.url = final_key
                        stored_urls.add(final_key)
                        await self.storage.add(crawl_run_id, result.page)
                        if self.progress_callback is not None:
                            self.progress_callback()

                        if current_depth >= self.max_depth:
                            continue

                        for discovered_url in result.discovered_urls:
                            discovered_key = normalize_url(
                                discovered_url, prefer_www=self.prefer_www
                            )
                            if discovered_key in visited:
                                continue
                            queue.append((discovered_key, current_depth + 1))

                await self.storage.flush()
            except Exception:
                await self.storage.flush()
                self.storage.set_run_failed(crawl_run_id)
                raise
            finally:
                flush_stop.set()
                try:
                    await flush_task
                except Exception:
                    logger.exception("Periodic flush task ended with an error")
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
                rendered_page = await self._fetch_with_playwright(client, url)
                if rendered_page is not None:
                    rendered_page.js_rendered = True
                    rendered_page.rendered_diff_significant = rendered_content_differs(
                        raw_page, rendered_page
                    )
                    # Preserve redirect chain measured on the primary HTTP fetch.
                    if not rendered_page.redirect_chain and raw_page.redirect_chain:
                        rendered_page.redirect_chain = list(raw_page.redirect_chain)
                        rendered_page.redirect_hops = raw_page.redirect_hops
                    final_page = rendered_page

            if final_page.html is not None:
                try:
                    await self._enrich_page_signals(client, final_page)
                except Exception:
                    # Weight/favicon probes must never abort storing the page.
                    logger.exception("Page signal enrichment failed for %s", url)

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
        redirect_chain = _redirect_chain_from_response(response)
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
                redirect_chain=redirect_chain,
                html_bytes=_response_size_bytes(response),
            )

        html_text = response.text
        return extract_page_data(
            url=str(response.url),
            html=html_text,
            status_code=response.status_code,
            response_time_ms=elapsed_ms,
            root_host=self.root_host,
            redirect_hops=len(response.history),
            html_bytes=_response_size_bytes(response) or len(html_text.encode("utf-8", errors="replace")),
            redirect_chain=redirect_chain,
        )

    async def _fetch_with_playwright(
        self,
        client: httpx.AsyncClient,
        url: str,
    ) -> ExtractedPage | None:
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
                html_bytes=len(html.encode("utf-8", errors="replace")),
            )
        except PlaywrightError:
            return None
        finally:
            await page.close()

    async def _enrich_page_signals(self, client: httpx.AsyncClient, page: ExtractedPage) -> None:
        if page.favicon_in_html:
            page.favicon_present = True
        else:
            page.favicon_present = await self._probe_default_favicon(client, page.url)

        page.resource_request_count = self._count_resource_requests(page)
        page.total_page_weight_bytes = await self._estimate_page_weight(client, page)

    def _count_resource_requests(self, page: ExtractedPage) -> int:
        """Approximate subresource count: HTML document + unique CSS/JS/images."""
        seen: set[str] = set()
        count = 1  # HTML document itself
        for url in [*page.stylesheet_urls, *page.script_urls, *(img.src for img in page.images)]:
            if not is_http_url(url) or url in seen:
                continue
            seen.add(url)
            count += 1
        return count

    async def _probe_default_favicon(self, client: httpx.AsyncClient, page_url: str) -> bool:
        parsed = urlparse(page_url)
        favicon_url = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
        try:
            response = await client.head(favicon_url)
            if response.status_code < 400:
                return True
            # Some servers disallow HEAD; fall back to GET.
            if response.status_code in {405, 501}:
                response = await client.get(favicon_url)
                return response.status_code < 400
            return False
        except httpx.HTTPError:
            return False

    async def _estimate_page_weight(self, client: httpx.AsyncClient, page: ExtractedPage) -> int:
        total = page.html_bytes or 0
        resource_urls: list[str] = []
        seen: set[str] = set()

        for url in [*page.stylesheet_urls, *page.script_urls, *(img.src for img in page.images)]:
            if not is_http_url(url) or url in seen:
                continue
            seen.add(url)
            resource_urls.append(url)
            if len(resource_urls) >= _MAX_WEIGHT_RESOURCES:
                break

        if not resource_urls:
            return total

        sizes = await asyncio.gather(
            *(self._resource_size_bytes(client, url) for url in resource_urls)
        )
        size_by_url = {url: size for url, size in zip(resource_urls, sizes, strict=True)}
        for image in page.images:
            if image.src in size_by_url:
                image.size_bytes = size_by_url[image.src] or None
        return total + sum(sizes)

    async def _resource_size_bytes(self, client: httpx.AsyncClient, url: str) -> int:
        if not is_http_url(url):
            return 0
        try:
            response = await client.head(url)
            if response.status_code in {405, 501}:
                response = await client.get(url)
            if response.status_code >= 400:
                return 0
            size = _response_size_bytes(response)
            if size is not None:
                return size
            # HEAD without Content-Length — skip body download to stay lightweight.
            if response.request.method.upper() == "HEAD":
                return 0
            return len(response.content)
        except Exception:
            # Unsupported schemes / network errors — treat as zero weight.
            return 0

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
                raw_delay = parser.crawl_delay(self.user_agent)
                try:
                    crawl_delay = float(raw_delay) if raw_delay is not None else 0.0
                except (TypeError, ValueError):
                    crawl_delay = 0.0
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
                try:
                    await self.storage.flush()
                except Exception:
                    logger.exception("Periodic crawl flush failed")


def _redirect_chain_from_response(response: httpx.Response) -> list[RedirectHop]:
    hops: list[RedirectHop] = []
    for prior in response.history:
        hops.append(RedirectHop(url=str(prior.url), status_code=prior.status_code))
    return hops


def _response_size_bytes(response: httpx.Response) -> int | None:
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            return max(0, int(content_length))
        except ValueError:
            pass
    # For responses where the body was already read.
    try:
        content = response.content
    except Exception:
        return None
    return len(content)
