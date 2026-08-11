from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.config import settings
from app.crawler.extractor import is_http_url

router = APIRouter(tags=["page-html"])

_MAX_HTML_BYTES = 5 * 1024 * 1024
_TIMEOUT = httpx.Timeout(45.0, connect=10.0)


class PageHtmlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class PageHtmlResponse(BaseModel):
    url: str
    final_url: str
    status_code: int
    content_type: str | None
    html: str


@router.post("/page-html", response_model=PageHtmlResponse)
async def fetch_page_html(body: PageHtmlRequest) -> PageHtmlResponse:
    """Fetch a page's HTML server-side for Current Page Check (avoids browser CORS)."""
    url = body.url.strip()
    if not is_http_url(url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL must be an absolute http(s) address.",
        )

    headers = {
        "User-Agent": settings.CRAWLER_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=_TIMEOUT,
            headers=headers,
        ) as client:
            response = await client.get(url)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timed out fetching {url}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not fetch page: {exc.__class__.__name__}",
        ) from exc

    content_type = response.headers.get("content-type")
    raw = response.content
    if len(raw) > _MAX_HTML_BYTES:
        raw = raw[:_MAX_HTML_BYTES]

    encoding = response.encoding or "utf-8"
    try:
        html = raw.decode(encoding, errors="replace")
    except LookupError:
        html = raw.decode("utf-8", errors="replace")

    return PageHtmlResponse(
        url=url,
        final_url=str(response.url),
        status_code=response.status_code,
        content_type=content_type,
        html=html,
    )
