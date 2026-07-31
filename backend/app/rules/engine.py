from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urldefrag, urlparse

import yaml
from bs4 import BeautifulSoup
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from app.db.database import SessionLocal
from app.models import AuditIssue, CrawledPage, CrawlRun, CrawlRunScore, PageLink, PageVital, SitemapFinding

SEVERITY_WEIGHTS = {
    "critical": 10,
    "high": 5,
    "medium": 2,
    "low": 1,
}


@dataclass(slots=True)
class RuleDefinition:
    id: str
    category: str
    description: str
    severity: str
    condition: str


@dataclass(slots=True)
class IssueRecord:
    crawl_run_id: int
    crawled_page_id: int | None
    target_url: str | None
    rule_id: str
    category: str
    severity: str
    message: str


@dataclass(slots=True)
class PageContext:
    page: CrawledPage
    normalized_url: str
    inbound_internal_links: int
    h1_count: int
    text_hash: str | None
    has_mixed_content: bool
    vitals: dict[str, PageVital]


class RuleEngine:
    def __init__(self, rules_path: str | Path | None = None) -> None:
        self.rules_path = Path(rules_path or Path(__file__).with_name("rules.yaml"))
        self.rules = self._load_rules()
        self._checks = {
            "missing_title": self._missing_title,
            "duplicate_title": self._duplicate_title,
            "missing_meta_description": self._missing_meta_description,
            "duplicate_meta_description": self._duplicate_meta_description,
            "broken_link": self._broken_link,
            "redirect_chain": self._redirect_chain,
            "canonical_noindex_conflict": self._canonical_noindex_conflict,
            "orphan_page": self._orphan_page,
            "missing_h1": self._missing_h1,
            "multiple_h1": self._multiple_h1,
            "lcp_fail": self._lcp_fail,
            "inp_fail": self._inp_fail,
            "cls_fail": self._cls_fail,
            "thin_content": self._thin_content,
            "duplicate_content": self._duplicate_content,
            "missing_schema": self._missing_schema,
            "mixed_content": self._mixed_content,
            "sitemap_orphan": self._sitemap_orphan,
            "crawled_not_in_sitemap": self._crawled_not_in_sitemap,
        }

    def run(self, crawl_run_id: int) -> dict[str, int]:
        with SessionLocal() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is None:
                raise ValueError(f"Crawl run {crawl_run_id} not found.")
            if crawl_run.status not in {"completed", "enriching", "running"}:
                raise ValueError("Rule engine can only run after the crawl has finished fetching pages.")

            page_contexts = self._load_page_contexts(db, crawl_run_id)
            findings = db.scalars(
                select(SitemapFinding).where(SitemapFinding.crawl_run_id == crawl_run_id)
            ).all()

            db.execute(delete(AuditIssue).where(AuditIssue.crawl_run_id == crawl_run_id))
            db.execute(delete(CrawlRunScore).where(CrawlRunScore.crawl_run_id == crawl_run_id))

            issues: list[IssueRecord] = []
            for rule in self.rules:
                check = self._checks.get(rule.condition)
                if check is None:
                    continue
                issues.extend(check(rule, crawl_run_id, page_contexts, findings))

            for issue in issues:
                db.add(
                    AuditIssue(
                        crawl_run_id=issue.crawl_run_id,
                        crawled_page_id=issue.crawled_page_id,
                        rule_id=issue.rule_id,
                        category=issue.category,
                        severity=issue.severity,
                        target_url=issue.target_url,
                        message=issue.message,
                    )
                )

            scores = self._compute_scores(crawl_run_id, issues, len(page_contexts))
            for category, score in scores.items():
                db.add(
                    CrawlRunScore(
                        crawl_run_id=crawl_run_id,
                        category=category,
                        score=score,
                    )
                )

            db.commit()
            return {"issues_created": len(issues), "scores_created": len(scores)}

    def _load_rules(self) -> list[RuleDefinition]:
        payload = yaml.safe_load(self.rules_path.read_text(encoding="utf-8")) or []
        return [RuleDefinition(**item) for item in payload]

    def _load_page_contexts(self, db: Session, crawl_run_id: int) -> list[PageContext]:
        pages = db.scalars(
            select(CrawledPage)
            .where(CrawledPage.crawl_run_id == crawl_run_id)
            .options(joinedload(CrawledPage.page_vitals))
            .order_by(CrawledPage.id.asc())
        ).unique().all()

        normalized_to_page = {self._normalize_url(page.url): page for page in pages}
        inbound_links = defaultdict(int)
        links = db.scalars(
            select(PageLink).join(CrawledPage).where(CrawledPage.crawl_run_id == crawl_run_id)
        ).all()
        for link in links:
            if not link.is_internal:
                continue
            target = self._normalize_url(link.target_url)
            if target in normalized_to_page:
                inbound_links[target] += 1

        contexts: list[PageContext] = []
        for page in pages:
            normalized_url = self._normalize_url(page.url)
            h1_count, text_hash, mixed_content = self._snapshot_signals(page.raw_html_path, page.url)
            vitals = {vital.strategy: vital for vital in page.page_vitals}
            contexts.append(
                PageContext(
                    page=page,
                    normalized_url=normalized_url,
                    inbound_internal_links=inbound_links.get(normalized_url, 0),
                    h1_count=h1_count,
                    text_hash=text_hash,
                    has_mixed_content=mixed_content,
                    vitals=vitals,
                )
            )
        return contexts

    def _snapshot_signals(self, raw_html_path: str | None, page_url: str) -> tuple[int, str | None, bool]:
        if not raw_html_path:
            return 0, None, False
        path = Path(raw_html_path)
        if not path.exists():
            return 0, None, False

        html = path.read_text(encoding="utf-8")
        soup = BeautifulSoup(html, "lxml")
        h1_count = len(soup.find_all("h1"))
        text_hash = self._content_hash(soup)
        mixed_content = self._has_mixed_content(soup, page_url)
        return h1_count, text_hash, mixed_content

    def _compute_scores(
        self,
        crawl_run_id: int,
        issues: list[IssueRecord],
        total_pages: int,
    ) -> dict[str, float]:
        checked = max(total_pages, 1)
        weights_by_category = defaultdict(int)
        total_weight = 0
        for issue in issues:
            weight = SEVERITY_WEIGHTS.get(issue.severity, 1)
            weights_by_category[issue.category] += weight
            total_weight += weight

        categories = {rule.category for rule in self.rules}
        scores = {
            category: max(0.0, round(100 - (weights_by_category[category] / checked), 2))
            for category in categories
        }
        scores["overall"] = max(0.0, round(100 - (total_weight / checked), 2))
        return scores

    def _missing_title(
        self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]
    ) -> list[IssueRecord]:
        return [
            self._page_issue(rule, crawl_run_id, page, "Page is missing a title tag.")
            for page in pages
            if not (page.page.title or "").strip()
        ]

    def _duplicate_title(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return self._duplicate_text_issues(
            rule,
            crawl_run_id,
            pages,
            lambda page: page.page.title,
            "Title is duplicated across {count} pages.",
        )

    def _missing_meta_description(
        self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]
    ) -> list[IssueRecord]:
        return [
            self._page_issue(rule, crawl_run_id, page, "Page is missing a meta description.")
            for page in pages
            if not (page.page.meta_description or "").strip()
        ]

    def _duplicate_meta_description(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return self._duplicate_text_issues(
            rule,
            crawl_run_id,
            pages,
            lambda page: page.page.meta_description,
            "Meta description is duplicated across {count} pages.",
        )

    def _broken_link(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                f"Page returned status {page.page.status_code}.",
            )
            for page in pages
            if page.page.status_code is not None and page.page.status_code >= 400
        ]

    def _redirect_chain(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                f"Page required {page.page.redirect_hops} redirects before resolving.",
            )
            for page in pages
            if page.page.redirect_hops >= 3
        ]

    def _canonical_noindex_conflict(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                "Page sets a canonical URL while also including noindex.",
            )
            for page in pages
            if page.page.canonical_url and "noindex" in (page.page.meta_robots or "").lower()
        ]

    def _orphan_page(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                "Page has no inbound internal links from other crawled pages.",
            )
            for page in pages
            if page.inbound_internal_links == 0
        ]

    def _missing_h1(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(rule, crawl_run_id, page, "Page is missing an H1 heading.")
            for page in pages
            if page.h1_count == 0
        ]

    def _multiple_h1(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                f"Page contains {page.h1_count} H1 headings.",
            )
            for page in pages
            if page.h1_count > 1
        ]

    def _lcp_fail(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return self._vital_issues(rule, crawl_run_id, pages, "lcp_ms", 2500, "LCP is {value:.0f}ms.")

    def _inp_fail(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return self._vital_issues(rule, crawl_run_id, pages, "inp_ms", 200, "INP/TBT is {value:.0f}ms.")

    def _cls_fail(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return self._vital_issues(rule, crawl_run_id, pages, "cls", 0.1, "CLS is {value:.2f}.")

    def _thin_content(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                f"Page has only {page.page.word_count or 0} visible words.",
            )
            for page in pages
            if (page.page.word_count or 0) < 300
        ]

    def _duplicate_content(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        groups = defaultdict(list)
        for page in pages:
            if page.text_hash:
                groups[page.text_hash].append(page)
        issues: list[IssueRecord] = []
        for group in groups.values():
            if len(group) < 2:
                continue
            for page in group:
                issues.append(
                    self._page_issue(
                        rule,
                        crawl_run_id,
                        page,
                        f"Page content hash matches {len(group)} pages in this crawl.",
                    )
                )
        return issues

    def _missing_schema(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        issues: list[IssueRecord] = []
        for page in pages:
            if page.page.has_schema:
                continue
            haystack = " ".join(
                filter(None, [page.page.url, page.page.title, page.page.h1])
            ).lower()
            likely_schema_page = any(
                token in haystack
                for token in ("product", "service", "blog", "article", "faq", "recipe", "event", "job", "news")
            )
            if likely_schema_page:
                issues.append(
                    self._page_issue(
                        rule,
                        crawl_run_id,
                        page,
                        "Page looks like a rich-result candidate but no JSON-LD schema was found.",
                    )
                )
        return issues

    def _mixed_content(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], _: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            self._page_issue(
                rule,
                crawl_run_id,
                page,
                "HTTPS page loads one or more HTTP resources.",
            )
            for page in pages
            if page.page.url.startswith("https://") and page.has_mixed_content
        ]

    def _sitemap_orphan(self, rule: RuleDefinition, crawl_run_id: int, _: list[PageContext], findings: list[SitemapFinding]) -> list[IssueRecord]:
        return [
            IssueRecord(
                crawl_run_id=crawl_run_id,
                crawled_page_id=None,
                target_url=finding.url,
                rule_id=rule.id,
                category=rule.category,
                severity=rule.severity,
                message=finding.message
                or "Sitemap URLs were not covered by this crawl. Increase max pages for broader coverage.",
            )
            for finding in findings
            if finding.finding_type == "in_sitemap_not_crawled"
        ]

    def _crawled_not_in_sitemap(self, rule: RuleDefinition, crawl_run_id: int, pages: list[PageContext], findings: list[SitemapFinding]) -> list[IssueRecord]:
        by_url = {page.normalized_url: page for page in pages}
        issues: list[IssueRecord] = []
        for finding in findings:
            if finding.finding_type != "crawled_not_in_sitemap":
                continue
            page = by_url.get(self._normalize_url(finding.url))
            if page is None:
                continue
            issues.append(
                self._page_issue(
                    rule,
                    crawl_run_id,
                    page,
                    "Crawled URL does not appear in the sitemap.",
                )
            )
        return issues

    def _duplicate_text_issues(
        self,
        rule: RuleDefinition,
        crawl_run_id: int,
        pages: list[PageContext],
        value_getter: Any,
        template: str,
    ) -> list[IssueRecord]:
        groups = defaultdict(list)
        for page in pages:
            value = (value_getter(page) or "").strip().lower()
            if value:
                groups[value].append(page)

        issues: list[IssueRecord] = []
        for group in groups.values():
            if len(group) < 2:
                continue
            for page in group:
                issues.append(
                    self._page_issue(
                        rule,
                        crawl_run_id,
                        page,
                        template.format(count=len(group)),
                    )
                )
        return issues

    def _vital_issues(
        self,
        rule: RuleDefinition,
        crawl_run_id: int,
        pages: list[PageContext],
        field_name: str,
        threshold: float,
        message_template: str,
    ) -> list[IssueRecord]:
        # Skipped automatically when ENABLE_PAGESPEED is off / no vitals exist.
        issues: list[IssueRecord] = []
        for page in pages:
            candidates = [getattr(vital, field_name) for vital in page.vitals.values()]
            values = [value for value in candidates if value is not None]
            if not values:
                continue
            worst = max(values)
            if worst > threshold:
                issues.append(
                    self._page_issue(
                        rule,
                        crawl_run_id,
                        page,
                        message_template.format(value=worst),
                    )
                )
        return issues

    def _page_issue(
        self,
        rule: RuleDefinition,
        crawl_run_id: int,
        page: PageContext,
        message: str,
    ) -> IssueRecord:
        return IssueRecord(
            crawl_run_id=crawl_run_id,
            crawled_page_id=page.page.id,
            target_url=page.page.url,
            rule_id=rule.id,
            category=rule.category,
            severity=rule.severity,
            message=message,
        )

    def _content_hash(self, soup: BeautifulSoup) -> str | None:
        for tag in soup(["script", "style", "noscript", "template", "svg"]):
            tag.extract()
        text = " ".join(soup.get_text(" ", strip=True).split())
        if len(text.split()) < 50:
            return None
        return hashlib.sha1(text.encode("utf-8")).hexdigest()

    def _has_mixed_content(self, soup: BeautifulSoup, page_url: str) -> bool:
        if not page_url.startswith("https://"):
            return False
        for tag in soup.find_all(["img", "script", "iframe", "audio", "video", "source", "link"]):
            candidate = tag.get("src") or tag.get("href")
            if isinstance(candidate, str) and candidate.strip().lower().startswith("http://"):
                return True
        return False

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
