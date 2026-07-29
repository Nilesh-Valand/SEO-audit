from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.models import CrawledPage, CrawlRun, PageLink, Project
from app.crawler.extractor import ExtractedPage

SessionFactory = Callable[[], Session]


@dataclass(slots=True)
class PendingPage:
    crawl_run_id: int
    page: ExtractedPage


class CrawlStorage:
    def __init__(
        self,
        *,
        session_factory: SessionFactory = SessionLocal,
        flush_size: int = 25,
        snapshot_root: Path | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._flush_size = flush_size
        self._snapshot_root = snapshot_root or (Path(__file__).resolve().parents[1] / "db" / "snapshots")
        self._buffer: list[PendingPage] = []
        self._lock = asyncio.Lock()

    async def add(self, crawl_run_id: int, page: ExtractedPage) -> None:
        async with self._lock:
            self._buffer.append(PendingPage(crawl_run_id=crawl_run_id, page=page))
            should_flush = len(self._buffer) >= self._flush_size

        if should_flush:
            await self.flush()

    async def flush(self) -> int:
        async with self._lock:
            if not self._buffer:
                return 0
            batch = self._buffer
            self._buffer = []

        return await asyncio.to_thread(self._write_batch, batch)

    def create_run(self, project_id: int) -> CrawlRun:
        with self._session_factory() as db:
            project = db.get(Project, project_id)
            if project is None:
                raise ValueError(f"Project {project_id} does not exist.")

            crawl_run = CrawlRun(
                project_id=project_id,
                status="pending",
                started_at=None,
                finished_at=None,
                total_urls=0,
            )
            db.add(crawl_run)
            db.commit()
            db.refresh(crawl_run)
            db.expunge(crawl_run)
            return crawl_run

    def get_run(self, crawl_run_id: int) -> CrawlRun | None:
        with self._session_factory() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is not None:
                db.expunge(crawl_run)
            return crawl_run

    def get_project(self, project_id: int) -> Project | None:
        with self._session_factory() as db:
            project = db.get(Project, project_id)
            if project is not None:
                db.expunge(project)
            return project

    def set_run_started(self, crawl_run_id: int) -> None:
        self._update_run_status(
            crawl_run_id,
            status="running",
            started_at=datetime.now(UTC),
            finished_at=None,
        )

    def set_run_completed(self, crawl_run_id: int) -> None:
        self._update_run_status(
            crawl_run_id,
            status="completed",
            finished_at=datetime.now(UTC),
        )

    def set_run_enriching(self, crawl_run_id: int) -> None:
        self._update_run_status(
            crawl_run_id,
            status="enriching",
        )

    def set_run_failed(self, crawl_run_id: int) -> None:
        self._update_run_status(
            crawl_run_id,
            status="failed",
            finished_at=datetime.now(UTC),
        )

    def _update_run_status(
        self,
        crawl_run_id: int,
        *,
        status: str,
        started_at: datetime | None | object = ...,
        finished_at: datetime | None | object = ...,
    ) -> None:
        with self._session_factory() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is None:
                return
            crawl_run.status = status
            if started_at is not ...:
                crawl_run.started_at = started_at
            if finished_at is not ...:
                crawl_run.finished_at = finished_at
            db.commit()

    def _write_batch(self, batch: list[PendingPage]) -> int:
        if not batch:
            return 0

        with self._session_factory() as db:
            run_counts: dict[int, int] = {}
            for item in batch:
                page = item.page
                html_path = self._save_html_snapshot(item.crawl_run_id, page.url, page.html)
                page_row = CrawledPage(
                    crawl_run_id=item.crawl_run_id,
                    url=page.url,
                    status_code=page.status_code,
                    title=page.title,
                    meta_description=page.meta_description,
                    canonical_url=page.canonical_url,
                    meta_robots=page.meta_robots,
                    h1=page.primary_h1,
                    word_count=page.word_count,
                    response_time_ms=page.response_time_ms,
                    redirect_hops=page.redirect_hops,
                    is_indexable=page.is_indexable,
                    has_schema=page.has_schema,
                    js_rendered=page.js_rendered,
                    rendered_diff_significant=page.rendered_diff_significant,
                    raw_html_path=html_path,
                )
                db.add(page_row)
                db.flush()

                for link in page.links:
                    db.add(
                        PageLink(
                            crawled_page_id=page_row.id,
                            target_url=link.target_url,
                            is_internal=link.is_internal,
                            anchor_text=link.anchor_text,
                        )
                    )

                run_counts[item.crawl_run_id] = run_counts.get(item.crawl_run_id, 0) + 1

            if run_counts:
                runs = db.scalars(select(CrawlRun).where(CrawlRun.id.in_(list(run_counts)))).all()
                for run in runs:
                    run.total_urls += run_counts.get(run.id, 0)

            db.commit()

        return len(batch)

    def _save_html_snapshot(self, crawl_run_id: int, url: str, html: str | None) -> str | None:
        if html is None:
            return None

        run_dir = self._snapshot_root / str(crawl_run_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
        file_path = run_dir / f"{digest}.html"
        file_path.write_text(html, encoding="utf-8")
        return str(file_path)
