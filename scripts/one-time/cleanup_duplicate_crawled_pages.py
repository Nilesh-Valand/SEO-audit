#!/usr/bin/env python3
"""
ONE-TIME cleanup: collapse duplicate crawled_pages that share a normalized URL.

Status: ready to run manually (NOT an Alembic auto-migration).
Keep under scripts/one-time/ after running so it is not confused with regular migrations.

Usage (from repo root):
  cd backend
  python ../scripts/one-time/cleanup_duplicate_crawled_pages.py

Or:
  cd backend && python -c "import runpy; runpy.run_path(r'../scripts/one-time/cleanup_duplicate_crawled_pages.py')"
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

from sqlalchemy import delete, func, select

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.crawler.normalize import normalize_url  # noqa: E402
from app.db.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    AuditIssue,
    CrawledPage,
    CrawlRun,
    PageLink,
    PageTechnicalDetails,
    PageVital,
)


def main() -> int:
    with SessionLocal() as db:
        pages = db.scalars(select(CrawledPage).order_by(CrawledPage.id.asc())).all()
        groups: dict[tuple[int, str], list[CrawledPage]] = defaultdict(list)
        for page in pages:
            key = (page.crawl_run_id, normalize_url(page.url))
            groups[key].append(page)

        duplicate_groups = {k: v for k, v in groups.items() if len(v) > 1}
        deleted_pages = 0
        deleted_issues = 0
        deleted_links = 0
        deleted_vitals = 0
        deleted_tech = 0
        singleton_updates = 0

        for (_run_id, canonical), group in groups.items():
            keep = group[0]
            if keep.url != canonical:
                keep.url = canonical
                if len(group) == 1:
                    singleton_updates += 1

            if len(group) < 2:
                continue

            drop_ids = [page.id for page in group[1:]]
            deleted_links += (
                db.execute(delete(PageLink).where(PageLink.crawled_page_id.in_(drop_ids))).rowcount
                or 0
            )
            deleted_vitals += (
                db.execute(delete(PageVital).where(PageVital.crawled_page_id.in_(drop_ids))).rowcount
                or 0
            )
            deleted_tech += (
                db.execute(
                    delete(PageTechnicalDetails).where(
                        PageTechnicalDetails.crawled_page_id.in_(drop_ids)
                    )
                ).rowcount
                or 0
            )
            deleted_issues += (
                db.execute(
                    delete(AuditIssue).where(AuditIssue.crawled_page_id.in_(drop_ids))
                ).rowcount
                or 0
            )
            deleted_pages += (
                db.execute(delete(CrawledPage).where(CrawledPage.id.in_(drop_ids))).rowcount or 0
            )

        touched_runs = {run_id for run_id, _ in groups}
        for run_id in touched_runs:
            run = db.get(CrawlRun, run_id)
            if run is None:
                continue
            run.total_urls = (
                db.scalar(
                    select(func.count())
                    .select_from(CrawledPage)
                    .where(CrawledPage.crawl_run_id == run_id)
                )
                or 0
            )

        db.commit()

    print("=== crawled_pages duplicate cleanup ===")
    print(f"duplicate groups found : {len(duplicate_groups)}")
    print(f"pages deleted          : {deleted_pages}")
    print(f"audit_issues deleted   : {deleted_issues}")
    print(f"page_links deleted     : {deleted_links}")
    print(f"page_vitals deleted    : {deleted_vitals}")
    print(f"technical_details del  : {deleted_tech}")
    print(f"singleton urls updated : {singleton_updates}")
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
