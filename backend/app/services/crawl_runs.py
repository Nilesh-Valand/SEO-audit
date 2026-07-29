from __future__ import annotations

import asyncio
import logging

from app.crawler.crawler import CrawlerService
from app.crawler.storage import CrawlStorage
from app.rules.engine import RuleEngine
from app.services.enrichment import EnrichmentService

logger = logging.getLogger(__name__)

_ACTIVE_TASKS: dict[int, asyncio.Task[None]] = {}
_ACTIVE_PROGRESS: dict[int, int] = {}


def is_active(crawl_run_id: int) -> bool:
    task = _ACTIVE_TASKS.get(crawl_run_id)
    return task is not None and not task.done()


def get_progress(crawl_run_id: int) -> int | None:
    return _ACTIVE_PROGRESS.get(crawl_run_id)


def start_crawl_run(
    *,
    crawl_run_id: int,
    start_url: str,
    max_pages: int,
    max_depth: int = 3,
    enable_pagespeed: bool | None = None,
) -> None:
    storage = CrawlStorage()

    async def runner() -> None:
        try:
            service = CrawlerService(
                start_url=start_url,
                max_pages=max_pages,
                max_depth=max_depth,
                storage=storage,
                progress_callback=lambda: _ACTIVE_PROGRESS.__setitem__(
                    crawl_run_id,
                    _ACTIVE_PROGRESS.get(crawl_run_id, 0) + 1,
                ),
            )
            await service.crawl(crawl_run_id)
            storage.set_run_enriching(crawl_run_id)
            await EnrichmentService().enrich_crawl_run(
                crawl_run_id,
                enable_pagespeed=enable_pagespeed,
            )
            try:
                await asyncio.to_thread(RuleEngine().run, crawl_run_id)
            except Exception as exc:
                logger.warning("Auto audit failed for crawl run %s: %s", crawl_run_id, exc)
            storage.set_run_completed(crawl_run_id)
        except asyncio.CancelledError:
            storage.set_run_failed(crawl_run_id)
            raise
        except Exception as exc:
            logger.exception("Crawl run %s failed: %s", crawl_run_id, exc)
            storage.set_run_failed(crawl_run_id)
            raise

    task = asyncio.create_task(runner(), name=f"crawl-run-{crawl_run_id}")
    _ACTIVE_TASKS[crawl_run_id] = task
    _ACTIVE_PROGRESS[crawl_run_id] = 0
    task.add_done_callback(
        lambda _: (_ACTIVE_TASKS.pop(crawl_run_id, None), _ACTIVE_PROGRESS.pop(crawl_run_id, None))
    )


def cancel_crawl_run(crawl_run_id: int) -> bool:
    task = _ACTIVE_TASKS.get(crawl_run_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True

