from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup

WHITESPACE_RE = re.compile(r"\s+")


@dataclass(slots=True)
class ExtractedLink:
    target_url: str
    is_internal: bool
    anchor_text: str | None


@dataclass(slots=True)
class ExtractedImage:
    src: str
    alt: str | None


@dataclass(slots=True)
class ExtractedSchemaBlock:
    raw: str
    parsed: Any | None


@dataclass(slots=True)
class ExtractedPage:
    url: str
    html: str | None
    status_code: int | None
    response_time_ms: float | None
    title: str | None
    meta_description: str | None
    canonical_url: str | None
    meta_robots: str | None
    redirect_hops: int = 0
    headings: dict[str, list[str]] = field(default_factory=dict)
    links: list[ExtractedLink] = field(default_factory=list)
    word_count: int = 0
    is_indexable: bool = True
    has_schema: bool = False
    schema_blocks: list[ExtractedSchemaBlock] = field(default_factory=list)
    images: list[ExtractedImage] = field(default_factory=list)
    js_rendered: bool = False
    rendered_diff_significant: bool = False

    @property
    def primary_h1(self) -> str | None:
        return (self.headings.get("h1") or [None])[0]


def extract_page_data(
    *,
    url: str,
    html: str,
    status_code: int | None,
    response_time_ms: float | None,
    root_host: str,
    redirect_hops: int = 0,
) -> ExtractedPage:
    soup = BeautifulSoup(html, "lxml")

    title = _clean_text(soup.title.string if soup.title and soup.title.string else None)
    meta_description = _get_meta_content(soup, "description")
    canonical_url = _extract_canonical(url, soup)
    meta_robots = _get_meta_content(soup, "robots")
    headings = _extract_headings(soup)
    links = _extract_links(soup, url, root_host)
    visible_text = _extract_visible_text(soup)
    word_count = len(visible_text.split()) if visible_text else 0
    schema_blocks = _extract_schema_blocks(soup)
    images = _extract_images(soup, url)

    return ExtractedPage(
        url=url,
        html=html,
        status_code=status_code,
        response_time_ms=response_time_ms,
        redirect_hops=redirect_hops,
        title=title,
        meta_description=meta_description,
        canonical_url=canonical_url,
        meta_robots=meta_robots,
        headings=headings,
        links=links,
        word_count=word_count,
        is_indexable=_is_indexable(meta_robots),
        has_schema=bool(schema_blocks),
        schema_blocks=schema_blocks,
        images=images,
    )


def rendered_content_differs(raw_page: ExtractedPage, rendered_page: ExtractedPage) -> bool:
    raw_words = raw_page.word_count
    rendered_words = rendered_page.word_count
    if raw_words == 0:
        return rendered_words >= 100

    delta = abs(rendered_words - raw_words)
    relative_delta = delta / max(raw_words, 1)

    raw_title = raw_page.title or ""
    rendered_title = rendered_page.title or ""
    title_changed = raw_title.strip() != rendered_title.strip()

    return delta >= 100 or relative_delta >= 0.5 or title_changed


def _extract_headings(soup: BeautifulSoup) -> dict[str, list[str]]:
    headings: dict[str, list[str]] = {}
    for tag_name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        values = [_clean_text(tag.get_text(" ", strip=True)) for tag in soup.find_all(tag_name)]
        values = [value for value in values if value]
        if values:
            headings[tag_name] = values
    return headings


def _extract_links(soup: BeautifulSoup, page_url: str, root_host: str) -> list[ExtractedLink]:
    links: list[ExtractedLink] = []
    seen: set[tuple[str, bool, str | None]] = set()
    for tag in soup.find_all("a", href=True):
        absolute = _normalize_link(page_url, tag["href"])
        if not absolute:
            continue

        anchor_text = _clean_text(tag.get_text(" ", strip=True))
        is_internal = _same_domain(urlparse(absolute).hostname, root_host)
        key = (absolute, is_internal, anchor_text)
        if key in seen:
            continue
        seen.add(key)
        links.append(
            ExtractedLink(
                target_url=absolute,
                is_internal=is_internal,
                anchor_text=anchor_text or None,
            )
        )
    return links


def _extract_visible_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript", "template", "svg"]):
        tag.extract()
    return _clean_text(soup.get_text(" ", strip=True)) or ""


def _extract_schema_blocks(soup: BeautifulSoup) -> list[ExtractedSchemaBlock]:
    blocks: list[ExtractedSchemaBlock] = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = tag.string or tag.get_text(strip=True)
        raw = raw.strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        blocks.append(ExtractedSchemaBlock(raw=raw, parsed=parsed))
    return blocks


def _extract_images(soup: BeautifulSoup, page_url: str) -> list[ExtractedImage]:
    images: list[ExtractedImage] = []
    for tag in soup.find_all("img"):
        src = tag.get("src")
        if not src:
            continue
        images.append(
            ExtractedImage(
                src=urljoin(page_url, src),
                alt=_clean_text(tag.get("alt")),
            )
        )
    return images


def _extract_canonical(page_url: str, soup: BeautifulSoup) -> str | None:
    tag = soup.find("link", rel=lambda value: value and "canonical" in value)
    href = tag.get("href") if tag else None
    return _normalize_link(page_url, href)


def _get_meta_content(soup: BeautifulSoup, name: str) -> str | None:
    tag = soup.find("meta", attrs={"name": lambda value: value and value.lower() == name})
    if tag is None:
        tag = soup.find("meta", attrs={"property": lambda value: value and value.lower() == name})
    return _clean_text(tag.get("content")) if tag else None


def _is_indexable(meta_robots: str | None) -> bool:
    if not meta_robots:
        return True
    return "noindex" not in meta_robots.lower()


def _normalize_link(base_url: str, href: str | None) -> str | None:
    if not href:
        return None
    absolute = urljoin(base_url, href.strip())
    absolute, _ = urldefrag(absolute)
    parsed = urlparse(absolute)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return parsed._replace(fragment="").geturl()


def _same_domain(hostname: str | None, root_host: str) -> bool:
    if not hostname:
        return False
    return _normalize_host(hostname) == _normalize_host(root_host)


def _normalize_host(hostname: str) -> str:
    return hostname.lower().removeprefix("www.")


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = WHITESPACE_RE.sub(" ", value).strip()
    return cleaned or None
