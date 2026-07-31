from app.models.project import Project
from app.models.crawl_run import CrawlRun
from app.models.crawled_page import CrawledPage
from app.models.page_link import PageLink
from app.models.audit_issue import AuditIssue
from app.models.crawl_run_score import CrawlRunScore
from app.models.page_vital import PageVital
from app.models.sitemap_finding import SitemapFinding
from app.models.page_technical_details import PageTechnicalDetails

__all__ = [
    "Project",
    "CrawlRun",
    "CrawledPage",
    "PageLink",
    "AuditIssue",
    "CrawlRunScore",
    "PageVital",
    "SitemapFinding",
    "PageTechnicalDetails",
]
