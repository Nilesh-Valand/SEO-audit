from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urldefrag, urlparse

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal
from app.models import CrawledPage, CrawlRun, SitemapFinding

# Cap sitemap expansion so giant sites (Shopify, etc.) do not flood the DB.
SITEMAP_URL_LIMIT = 5_000


@dataclass(slots=True)
class PageRecord:
    id: int
    url: str
    word_count: int | None
    status_code: int | None
    is_indexable: bool


@dataclass(slots=True)
class CrawlRunContext:
    crawl_run_id: int
    project_id: int
    pages: list[PageRecord]


@dataclass(slots=True)
class SitemapComparison:
    findings: list[tuple[str, str, str]]
    missing_page_ids: list[int]


class EnrichmentService:
    """Post-crawl enrichment. Currently sitemap comparison only (no external API keys)."""

    def __init__(self, session_factory: Callable[[], Session] = SessionLocal) -> None:
        self._session_factory = session_factory

    async def enrich_crawl_run(self, crawl_run_id: int, **_: object) -> None:
        context = await asyncio.to_thread(self._load_run_context, crawl_run_id)
        if context is None or not context.pages:
            return

        headers = {"User-Agent": settings.CRAWLER_USER_AGENT}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
            try:
                await self._run_sitemap_check(client, context)
            except Exception:
                pass

    async def _run_sitemap_check(
        self,
        client: httpx.AsyncClient,
        context: CrawlRunContext,
    ) -> None:
        base_url = self._site_root_from_url(context.pages[0].url)
        sitemap_urls = await self._fetch_sitemap_urls(client, f"{base_url}/sitemap.xml")
        if not sitemap_urls:
            return

        comparison = self._compare_sitemap_to_crawl(context.pages, sitemap_urls)
        await asyncio.to_thread(
            self._save_sitemap_comparison,
            context.crawl_run_id,
            comparison,
        )

    async def _fetch_sitemap_urls(
        self,
        client: httpx.AsyncClient,
        sitemap_url: str,
        seen: set[str] | None = None,
        collected: set[str] | None = None,
    ) -> set[str]:
        seen = seen or set()
        collected = collected if collected is not None else set()
        if len(collected) >= SITEMAP_URL_LIMIT:
            return collected

        normalized_sitemap_url = self._normalize_url(sitemap_url)
        if normalized_sitemap_url in seen:
            return collected
        seen.add(normalized_sitemap_url)

        try:
            response = await client.get(normalized_sitemap_url)
            response.raise_for_status()
        except httpx.HTTPError:
            return collected

        try:
            root = ET.fromstring(response.text)
        except ET.ParseError:
            return collected

        tag = self._strip_xml_namespace(root.tag)
        if tag == "sitemapindex":
            for sitemap_node in root.findall(".//{*}sitemap/{*}loc"):
                if len(collected) >= SITEMAP_URL_LIMIT:
                    break
                if sitemap_node.text:
                    await self._fetch_sitemap_urls(
                        client,
                        sitemap_node.text.strip(),
                        seen,
                        collected,
                    )
            return collected

        if tag != "urlset":
            return collected

        for node in root.findall(".//{*}url/{*}loc"):
            if len(collected) >= SITEMAP_URL_LIMIT:
                break
            if node.text:
                collected.add(self._normalize_url(node.text.strip()))
        return collected

    def _compare_sitemap_to_crawl(
        self,
        pages: list[PageRecord],
        sitemap_urls: set[str],
    ) -> SitemapComparison:
        crawled_pages = {
            self._normalize_url(page.url): page
            for page in pages
            if page.url
        }

        findings: list[tuple[str, str, str]] = []
        missing_page_ids: list[int] = []
        not_crawled = sorted(sitemap_urls - set(crawled_pages))

        # One summary finding instead of thousands of per-URL noise on large sites.
        if not_crawled:
            sample = ", ".join(not_crawled[:5])
            extra = len(not_crawled) - min(5, len(not_crawled))
            sample_note = f" Examples: {sample}" + (f" (+{extra} more)." if extra > 0 else ".")
            findings.append(
                (
                    not_crawled[0],
                    "in_sitemap_not_crawled",
                    (
                        f"{len(not_crawled)} sitemap URL(s) were not crawled in this run "
                        f"(crawled {len(crawled_pages)} page(s); sitemap compared {len(sitemap_urls)} URL(s))."
                        f"{sample_note} Increase max pages if you need broader sitemap coverage."
                    ),
                )
            )

        for crawled_url, page in crawled_pages.items():
            if crawled_url in sitemap_urls:
                continue
            findings.append(
                (
                    crawled_url,
                    "crawled_not_in_sitemap",
                    "URL was crawled successfully but does not appear in the discovered sitemap.",
                )
            )
            missing_page_ids.append(page.id)

        return SitemapComparison(findings=findings, missing_page_ids=missing_page_ids)

    def _save_sitemap_comparison(self, crawl_run_id: int, comparison: SitemapComparison) -> None:
        with self._session_factory() as db:
            db.execute(delete(SitemapFinding).where(SitemapFinding.crawl_run_id == crawl_run_id))
            for url, finding_type, message in comparison.findings:
                db.add(
                    SitemapFinding(
                        crawl_run_id=crawl_run_id,
                        url=url,
                        finding_type=finding_type,
                        message=message,
                    )
                )
            db.commit()

    def _load_run_context(self, crawl_run_id: int) -> CrawlRunContext | None:
        with self._session_factory() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is None:
                return None
            pages = db.scalars(
                select(CrawledPage).where(CrawledPage.crawl_run_id == crawl_run_id)
            ).all()
            return CrawlRunContext(
                crawl_run_id=crawl_run.id,
                project_id=crawl_run.project_id,
                pages=[
                    PageRecord(
                        id=page.id,
                        url=page.url,
                        word_count=page.word_count,
                        status_code=page.status_code,
                        is_indexable=page.is_indexable,
                    )
                    for page in pages
                ],
            )

    def _site_root_from_url(self, url: str) -> str:
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}"

    def _normalize_url(self, url: str) -> str:
        normalized, _ = urldefrag(url)
        parsed = urlparse(normalized)
        path = parsed.path or "/"
        return parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            path=path.rstrip("/") or "/",
            fragment="",
        ).geturl()

    def _strip_xml_namespace(self, tag: str) -> str:
        return tag.split("}", 1)[-1]
