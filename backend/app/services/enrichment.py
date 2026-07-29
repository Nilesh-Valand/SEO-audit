from __future__ import annotations

import asyncio
import json
import secrets
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode, urldefrag, urlparse

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal
from app.models import CrawledPage, CrawlRun, GscCredential, GscSnapshot, PageVital, SitemapFinding

PAGESPEED_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GSC_SITEMAPS_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites/{site_url}/sitemaps"
GSC_URL_INSPECTION_ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"


@dataclass(slots=True)
class OAuthState:
    project_id: int
    property_url: str
    expires_at: datetime


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
class PageVitalRecord:
    crawled_page_id: int
    lcp_ms: float | None
    inp_ms: float | None
    cls: float | None
    performance_score: int | None
    strategy: str


@dataclass(slots=True)
class SitemapComparison:
    findings: list[tuple[str, str, str]]
    missing_page_ids: list[int]


_OAUTH_STATES: dict[str, OAuthState] = {}


class EnrichmentService:
    def __init__(self, session_factory: Callable[[], Session] = SessionLocal) -> None:
        self._session_factory = session_factory
        self._pagespeed_lock = asyncio.Lock()
        self._next_pagespeed_at = 0.0

    async def enrich_crawl_run(
        self,
        crawl_run_id: int,
        *,
        enable_pagespeed: bool | None = None,
    ) -> None:
        context = await asyncio.to_thread(self._load_run_context, crawl_run_id)
        if context is None or not context.pages:
            return

        headers = {"User-Agent": settings.CRAWLER_USER_AGENT}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
            if settings.ENRICHMENT_ENABLE_PAGESPEED and enable_pagespeed is not False:
                try:
                    vitals = await self._collect_pagespeed_vitals(client, context.pages)
                    if vitals:
                        await asyncio.to_thread(self._save_page_vitals, vitals)
                except Exception:
                    pass

            try:
                await self._run_sitemap_check(client, context)
            except Exception:
                pass

            if settings.ENRICHMENT_ENABLE_GSC:
                try:
                    credential = await asyncio.to_thread(
                        self._get_gsc_credential, context.project_id
                    )
                    if credential is not None:
                        await self._sync_gsc_snapshot(client, context, credential)
                except Exception:
                    pass

    def create_gsc_oauth_url(self, *, project_id: int, property_url: str) -> str:
        self._validate_gsc_oauth_config()
        state = secrets.token_urlsafe(32)
        _OAUTH_STATES[state] = OAuthState(
            project_id=project_id,
            property_url=property_url,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": GSC_SCOPE,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
        return f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"

    async def complete_gsc_oauth(self, *, state: str, code: str) -> dict[str, Any]:
        self._validate_gsc_oauth_config()
        oauth_state = _OAUTH_STATES.pop(state, None)
        if oauth_state is None or oauth_state.expires_at < datetime.now(UTC):
            raise ValueError("OAuth state is missing or expired.")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            token_payload = response.json()

        await asyncio.to_thread(
            self._upsert_gsc_credential,
            oauth_state.project_id,
            oauth_state.property_url,
            token_payload,
        )
        return {
            "project_id": oauth_state.project_id,
            "property_url": oauth_state.property_url,
        }

    def _load_run_context(self, crawl_run_id: int) -> CrawlRunContext | None:
        with self._session_factory() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is None:
                return None

            pages = db.scalars(
                select(CrawledPage)
                .where(CrawledPage.crawl_run_id == crawl_run_id)
                .order_by(CrawledPage.id.asc())
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

    async def _collect_pagespeed_vitals(
        self,
        client: httpx.AsyncClient,
        pages: list[PageRecord],
    ) -> list[PageVitalRecord]:
        sample_pages = [
            page
            for page in pages
            if page.status_code is None or page.status_code < 400
        ][: settings.ENRICHMENT_PAGESPEED_SAMPLE_LIMIT]
        if not sample_pages:
            return []

        semaphore = asyncio.Semaphore(settings.ENRICHMENT_PAGESPEED_BATCH_SIZE)
        records: list[PageVitalRecord] = []

        async def process(page: PageRecord, strategy: str) -> None:
            async with semaphore:
                metrics = await self._fetch_pagespeed_metrics(client, page.url, strategy)
                if metrics is None:
                    return
                records.append(
                    PageVitalRecord(
                        crawled_page_id=page.id,
                        lcp_ms=metrics.get("lcp_ms"),
                        inp_ms=metrics.get("inp_ms"),
                        cls=metrics.get("cls"),
                        performance_score=metrics.get("performance_score"),
                        strategy=strategy,
                    )
                )

        await asyncio.gather(
            *(
                process(page, strategy)
                for page in sample_pages
                for strategy in ("mobile", "desktop")
            )
        )
        return records

    async def _fetch_pagespeed_metrics(
        self,
        client: httpx.AsyncClient,
        url: str,
        strategy: str,
    ) -> dict[str, float | int | None] | None:
        params = {"url": url, "strategy": strategy, "category": "performance"}
        if settings.PAGESPEED_API_KEY:
            params["key"] = settings.PAGESPEED_API_KEY

        backoff = settings.ENRICHMENT_PAGESPEED_REQUEST_DELAY
        for attempt in range(settings.ENRICHMENT_PAGESPEED_MAX_RETRIES):
            await self._wait_for_pagespeed_slot()
            try:
                response = await client.get(PAGESPEED_ENDPOINT, params=params)
                if response.status_code == 429 or response.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        "Retryable PageSpeed response",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                payload = response.json()
                return self._parse_pagespeed_payload(payload)
            except (httpx.RequestError, httpx.HTTPStatusError):
                if attempt == settings.ENRICHMENT_PAGESPEED_MAX_RETRIES - 1:
                    return None
                await asyncio.sleep(backoff)
                backoff *= 2
        return None

    async def _wait_for_pagespeed_slot(self) -> None:
        async with self._pagespeed_lock:
            now = time.monotonic()
            wait_time = self._next_pagespeed_at - now
            if wait_time > 0:
                await asyncio.sleep(wait_time)
            self._next_pagespeed_at = time.monotonic() + settings.ENRICHMENT_PAGESPEED_REQUEST_DELAY

    def _parse_pagespeed_payload(self, payload: dict[str, Any]) -> dict[str, float | int | None]:
        lighthouse = payload.get("lighthouseResult", {})
        audits = lighthouse.get("audits", {})

        lcp = self._numeric_value(audits.get("largest-contentful-paint"))
        inp = self._numeric_value(audits.get("interaction-to-next-paint"))
        if inp is None:
            inp = self._numeric_value(audits.get("total-blocking-time"))
        cls = self._numeric_value(audits.get("cumulative-layout-shift"))

        performance = lighthouse.get("categories", {}).get("performance", {}).get("score")
        performance_score = None
        if isinstance(performance, (int, float)):
            performance_score = int(round(performance * 100))

        return {
            "lcp_ms": lcp,
            "inp_ms": inp,
            "cls": cls,
            "performance_score": performance_score,
        }

    async def _run_sitemap_check(
        self,
        client: httpx.AsyncClient,
        context: CrawlRunContext,
    ) -> None:
        if not context.pages:
            return

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
    ) -> set[str]:
        seen = seen or set()
        normalized_sitemap_url = self._normalize_url(sitemap_url)
        if normalized_sitemap_url in seen:
            return set()
        seen.add(normalized_sitemap_url)

        try:
            response = await client.get(normalized_sitemap_url)
            response.raise_for_status()
        except httpx.HTTPError:
            return set()

        try:
            root = ET.fromstring(response.text)
        except ET.ParseError:
            return set()

        tag = self._strip_xml_namespace(root.tag)
        if tag == "sitemapindex":
            urls: set[str] = set()
            for sitemap_node in root.findall(".//{*}sitemap/{*}loc"):
                if sitemap_node.text:
                    urls.update(
                        await self._fetch_sitemap_urls(client, sitemap_node.text.strip(), seen)
                    )
            return urls

        if tag != "urlset":
            return set()

        return {
            self._normalize_url(node.text.strip())
            for node in root.findall(".//{*}url/{*}loc")
            if node.text
        }

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

        for sitemap_url in sorted(sitemap_urls - set(crawled_pages)):
            findings.append(
                (
                    sitemap_url,
                    "in_sitemap_not_crawled",
                    "URL appears in the sitemap but was not crawled or linked during the crawl run.",
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

    async def _sync_gsc_snapshot(
        self,
        client: httpx.AsyncClient,
        context: CrawlRunContext,
        credential: GscCredential,
    ) -> None:
        access_token = await self._ensure_valid_gsc_token(client, credential)
        headers = {"Authorization": f"Bearer {access_token}"}

        sitemaps_payload = await self._fetch_gsc_sitemaps(client, headers, credential.property_url)
        inspected_pages = context.pages[: settings.ENRICHMENT_GSC_INSPECTION_SAMPLE_LIMIT]
        inspection_payloads: list[dict[str, Any]] = []
        indexed_count = 0
        inspection_errors = 0

        for page in inspected_pages:
            result = await self._inspect_gsc_url(client, headers, credential.property_url, page.url)
            if result is None:
                continue
            inspection_payloads.append(result)
            if self._is_url_indexed(result):
                indexed_count += 1
            else:
                inspection_errors += 1

        sitemap_entries = sitemaps_payload.get("sitemap", []) if isinstance(sitemaps_payload, dict) else []
        sitemap_errors = sum(int(item.get("errors", 0) or 0) for item in sitemap_entries)
        sitemap_warnings = sum(int(item.get("warnings", 0) or 0) for item in sitemap_entries)
        snapshot_payload = {
            "sitemaps": sitemap_payload_for_json(sitemaps_payload),
            "inspections": inspection_payloads,
        }

        await asyncio.to_thread(
            self._save_gsc_snapshot,
            context.project_id,
            indexed_count,
            len(inspection_payloads),
            self._summarize_sitemap_submission_status(sitemap_entries),
            sitemap_errors + sitemap_warnings + inspection_errors,
            snapshot_payload,
        )

    async def _fetch_gsc_sitemaps(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        property_url: str,
    ) -> dict[str, Any]:
        endpoint = GSC_SITEMAPS_ENDPOINT.format(site_url=quote(property_url, safe=""))
        response = await client.get(endpoint, headers=headers)
        response.raise_for_status()
        return response.json()

    async def _inspect_gsc_url(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        property_url: str,
        url: str,
    ) -> dict[str, Any] | None:
        try:
            response = await client.post(
                GSC_URL_INSPECTION_ENDPOINT,
                headers=headers,
                json={
                    "inspectionUrl": url,
                    "siteUrl": property_url,
                    "languageCode": "en-US",
                },
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError:
            return None

    async def _ensure_valid_gsc_token(
        self,
        client: httpx.AsyncClient,
        credential: GscCredential,
    ) -> str:
        if credential.expires_at is None or credential.expires_at > datetime.now(UTC) + timedelta(minutes=1):
            return credential.access_token

        if not credential.refresh_token:
            return credential.access_token

        self._validate_gsc_oauth_config()
        response = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "refresh_token": credential.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        response.raise_for_status()
        token_payload = response.json()
        await asyncio.to_thread(
            self._upsert_gsc_credential,
            credential.project_id,
            credential.property_url,
            token_payload,
            credential.refresh_token,
        )
        return str(token_payload["access_token"])

    def _save_page_vitals(self, records: list[PageVitalRecord]) -> None:
        if not records:
            return

        page_ids = {record.crawled_page_id for record in records}
        with self._session_factory() as db:
            db.execute(delete(PageVital).where(PageVital.crawled_page_id.in_(page_ids)))
            for record in records:
                db.add(
                    PageVital(
                        crawled_page_id=record.crawled_page_id,
                        lcp_ms=record.lcp_ms,
                        inp_ms=record.inp_ms,
                        cls=record.cls,
                        performance_score=record.performance_score,
                        strategy=record.strategy,
                    )
                )
            db.commit()

    def _save_sitemap_comparison(
        self,
        crawl_run_id: int,
        comparison: SitemapComparison,
    ) -> None:
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

    def _get_gsc_credential(self, project_id: int) -> GscCredential | None:
        with self._session_factory() as db:
            credential = db.scalar(
                select(GscCredential).where(GscCredential.project_id == project_id)
            )
            if credential is not None:
                db.expunge(credential)
            return credential

    def _upsert_gsc_credential(
        self,
        project_id: int,
        property_url: str,
        token_payload: dict[str, Any],
        fallback_refresh_token: str | None = None,
    ) -> None:
        refresh_token = token_payload.get("refresh_token") or fallback_refresh_token
        expires_in = token_payload.get("expires_in")
        expires_at = None
        if isinstance(expires_in, (int, float)):
            expires_at = datetime.now(UTC) + timedelta(seconds=int(expires_in))

        with self._session_factory() as db:
            credential = db.scalar(
                select(GscCredential).where(GscCredential.project_id == project_id)
            )
            if credential is None:
                credential = GscCredential(
                    project_id=project_id,
                    property_url=property_url,
                    access_token=str(token_payload["access_token"]),
                    refresh_token=refresh_token,
                    token_type=token_payload.get("token_type"),
                    scope=token_payload.get("scope"),
                    expires_at=expires_at,
                )
                db.add(credential)
            else:
                credential.property_url = property_url
                credential.access_token = str(token_payload["access_token"])
                credential.refresh_token = refresh_token or credential.refresh_token
                credential.token_type = token_payload.get("token_type") or credential.token_type
                credential.scope = token_payload.get("scope") or credential.scope
                credential.expires_at = expires_at
            db.commit()

    def _save_gsc_snapshot(
        self,
        project_id: int,
        indexed_page_count: int,
        inspected_url_count: int,
        sitemap_submission_status: str,
        coverage_errors: int,
        payload: dict[str, Any],
    ) -> None:
        with self._session_factory() as db:
            db.add(
                GscSnapshot(
                    project_id=project_id,
                    indexed_page_count=indexed_page_count,
                    inspected_url_count=inspected_url_count,
                    sitemap_submission_status=sitemap_submission_status,
                    coverage_errors=coverage_errors,
                    raw_payload=json.dumps(payload),
                )
            )
            db.commit()

    def _validate_gsc_oauth_config(self) -> None:
        if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET or not settings.GOOGLE_REDIRECT_URI:
            raise ValueError(
                "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
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

    def _numeric_value(self, audit: dict[str, Any] | None) -> float | None:
        if not isinstance(audit, dict):
            return None
        value = audit.get("numericValue")
        return float(value) if isinstance(value, (int, float)) else None

    def _is_url_indexed(self, payload: dict[str, Any]) -> bool:
        result = payload.get("inspectionResult", {}).get("indexStatusResult", {})
        verdict = str(result.get("verdict", "")).upper()
        coverage_state = str(result.get("coverageState", "")).lower()
        return verdict == "PASS" or "indexed" in coverage_state

    def _summarize_sitemap_submission_status(self, sitemap_entries: list[dict[str, Any]]) -> str:
        if not sitemap_entries:
            return "missing"
        if any(item.get("isPending") for item in sitemap_entries):
            return "pending"
        return "submitted"


def sitemap_payload_for_json(payload: Any) -> Any:
    return payload if isinstance(payload, (dict, list, str, int, float, bool)) or payload is None else str(payload)
