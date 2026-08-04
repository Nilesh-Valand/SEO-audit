from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.crawler.storage import CrawlStorage
from app.db.database import SessionLocal
from app.models import AuditIssue, CrawledPage, CrawlRun, CrawlRunScore
from app.rules.engine import RuleEngine
from app.services.crawl_runs import cancel_crawl_run, get_progress, is_active, start_crawl_run
from app.services.deletions import delete_crawl_run
from app.services.report import ReportService, iter_file_chunks, remove_file

router = APIRouter(prefix="/crawl-runs", tags=["crawl-runs"])
storage = CrawlStorage()
rule_engine = RuleEngine()
report_service = ReportService()
_ACTIVE_ORPHAN_TASKS: set[asyncio.Task[None]] = set()
_ORPHAN_AUDIT_STARTED: set[int] = set()


class CreateCrawlRunRequest(BaseModel):
    project_id: int
    start_url: HttpUrl
    max_pages: int = Field(default=200, ge=1, le=5000)
    max_depth: int = Field(default=3, ge=0, le=20)
    enable_pagespeed: bool | None = None


class CrawlRunResponse(BaseModel):
    crawl_run_id: int
    status: str


class CrawlRunProgressResponse(BaseModel):
    id: int
    project_id: int
    status: str
    pages_crawled: int
    started_at: datetime | None
    finished_at: datetime | None
    active: bool


class CrawlRunListItemResponse(BaseModel):
    id: int
    project_id: int
    status: str
    total_pages: int
    started_at: datetime | None
    finished_at: datetime | None


class CrawlRunListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CrawlRunListItemResponse]


class RunAuditResponse(BaseModel):
    crawl_run_id: int
    issues_created: int
    scores_created: int


class PageVitalsResponse(BaseModel):
    mobile_performance_score: int | None = None
    mobile_lcp_ms: float | None = None
    mobile_inp_ms: float | None = None
    mobile_cls: float | None = None
    desktop_performance_score: int | None = None
    desktop_lcp_ms: float | None = None
    desktop_inp_ms: float | None = None
    desktop_cls: float | None = None


class PageDetailsResponse(BaseModel):
    id: int
    url: str
    title: str | None
    meta_description: str | None
    canonical_url: str | None
    word_count: int | None
    status_code: int | None
    response_time_ms: float | None
    vitals: PageVitalsResponse | None = None


class AuditIssueResponse(BaseModel):
    id: int
    rule_id: str
    category: str
    severity: str
    target_url: str | None
    message: str
    page_details: PageDetailsResponse | None = None


class AuditIssueListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AuditIssueResponse]


class ScoreItemResponse(BaseModel):
    category: str
    score: float


class ScoreListResponse(BaseModel):
    items: list[ScoreItemResponse]


class CrawlRunSummaryResponse(BaseModel):
    overall_score: float | None
    category_scores: dict[str, float]
    total_pages: int
    total_issues_by_severity: dict[str, int]


class CrawledPageListItemResponse(BaseModel):
    id: int
    url: str
    title: str | None
    status_code: int | None
    word_count: int | None
    response_time_ms: float | None
    issue_count: int


class CrawledPageListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CrawledPageListItemResponse]


class ReportIssueResponse(BaseModel):
    url: str | None
    rule: str
    severity: str
    message: str


class ReportCategoryResponse(BaseModel):
    name: str
    score: float | None
    issues: list[ReportIssueResponse]


class RecommendationResponse(BaseModel):
    rule: str
    severity: str
    category: str
    message: str
    pages_affected: int


class ReportResponse(BaseModel):
    project: dict[str, object | None]
    crawl_date: str | None
    overall_score: float | None
    category_scores: dict[str, float]
    summary: dict[str, object]
    categories: list[ReportCategoryResponse]
    recommendations: list[RecommendationResponse]


class DiffIssueResponse(BaseModel):
    rule_id: str
    category: str
    severity: str
    target_url: str | None
    message: str


class CrawlRunDiffResponse(BaseModel):
    current_run_id: int
    compare_to_run_id: int
    new_issues: list[DiffIssueResponse]
    resolved_issues: list[DiffIssueResponse]
    persisting_issues: list[DiffIssueResponse]
    counts: dict[str, int]


def _require_crawl_run(crawl_run_id: int) -> CrawlRun:
    crawl_run = storage.get_run(crawl_run_id)
    if crawl_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crawl run {crawl_run_id} not found.",
        )
    return crawl_run


def _build_page_vitals(page: CrawledPage) -> PageVitalsResponse | None:
    if not getattr(page, "page_vitals", None):
        return None
    vitals = {vital.strategy: vital for vital in page.page_vitals}
    mobile = vitals.get("mobile")
    desktop = vitals.get("desktop")
    return PageVitalsResponse(
        mobile_performance_score=mobile.performance_score if mobile else None,
        mobile_lcp_ms=mobile.lcp_ms if mobile else None,
        mobile_inp_ms=mobile.inp_ms if mobile else None,
        mobile_cls=mobile.cls if mobile else None,
        desktop_performance_score=desktop.performance_score if desktop else None,
        desktop_lcp_ms=desktop.lcp_ms if desktop else None,
        desktop_inp_ms=desktop.inp_ms if desktop else None,
        desktop_cls=desktop.cls if desktop else None,
    )


@router.get("", response_model=CrawlRunListResponse)
async def list_crawl_runs(
    project_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
) -> CrawlRunListResponse:
    with SessionLocal() as db:
        filters = []
        if project_id is not None:
            filters.append(CrawlRun.project_id == project_id)

        total = db.scalar(select(func.count()).select_from(CrawlRun).where(*filters)) or 0
        crawl_runs = db.scalars(
            select(CrawlRun)
            .where(*filters)
            .order_by(CrawlRun.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()

        return CrawlRunListResponse(
            total=total,
            page=page,
            page_size=page_size,
            items=[
                CrawlRunListItemResponse(
                    id=crawl_run.id,
                    project_id=crawl_run.project_id,
                    status=crawl_run.status,
                    total_pages=crawl_run.total_urls,
                    started_at=crawl_run.started_at,
                    finished_at=crawl_run.finished_at,
                )
                for crawl_run in crawl_runs
            ],
        )


@router.post("", response_model=CrawlRunResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_crawl_run(payload: CreateCrawlRunRequest) -> CrawlRunResponse:
    project = storage.get_project(payload.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {payload.project_id} not found.",
        )

    crawl_run = storage.create_run(payload.project_id)
    start_crawl_run(
        crawl_run_id=crawl_run.id,
        start_url=str(payload.start_url),
        max_pages=payload.max_pages,
        max_depth=payload.max_depth,
        enable_pagespeed=payload.enable_pagespeed,
    )

    return CrawlRunResponse(crawl_run_id=crawl_run.id, status="pending")


@router.get("/{crawl_run_id}", response_model=CrawlRunProgressResponse)
async def get_crawl_run(crawl_run_id: int) -> CrawlRunProgressResponse:
    crawl_run = _require_crawl_run(crawl_run_id)
    active = is_active(crawl_run.id)

    # Heal runs left in running/enriching after a server reload killed the worker.
    # Keep this path fast — never run the full rules engine inline on poll requests.
    if crawl_run.status in {"running", "enriching"} and not active:
        with SessionLocal() as db:
            page_count = (
                db.scalar(
                    select(func.count())
                    .select_from(CrawledPage)
                    .where(CrawledPage.crawl_run_id == crawl_run_id)
                )
                or 0
            )
            score_count = (
                db.scalar(
                    select(func.count())
                    .select_from(CrawlRunScore)
                    .where(CrawlRunScore.crawl_run_id == crawl_run_id)
                )
                or 0
            )
        if page_count > 0 and score_count > 0:
            storage.set_run_completed(crawl_run_id)
            crawl_run = _require_crawl_run(crawl_run_id)
        elif page_count > 0:
            # Finish scoring in the background so progress polls stay responsive.
            storage.set_run_enriching(crawl_run_id)
            if crawl_run_id not in _ORPHAN_AUDIT_STARTED:
                _ORPHAN_AUDIT_STARTED.add(crawl_run_id)

                async def _finish_orphan_audit(run_id: int = crawl_run_id) -> None:
                    try:
                        await asyncio.to_thread(rule_engine.run, run_id)
                        storage.set_run_completed(run_id)
                    except Exception:
                        storage.set_run_failed(run_id)
                    finally:
                        _ORPHAN_AUDIT_STARTED.discard(run_id)

                task = asyncio.create_task(
                    _finish_orphan_audit(), name=f"orphan-audit-{crawl_run_id}"
                )
                _ACTIVE_ORPHAN_TASKS.add(task)
                task.add_done_callback(_ACTIVE_ORPHAN_TASKS.discard)
            crawl_run = _require_crawl_run(crawl_run_id)
        else:
            storage.set_run_failed(crawl_run_id)
            crawl_run = _require_crawl_run(crawl_run_id)

    return CrawlRunProgressResponse(
        id=crawl_run.id,
        project_id=crawl_run.project_id,
        status=crawl_run.status,
        pages_crawled=max(crawl_run.total_urls, get_progress(crawl_run.id) or 0),
        started_at=crawl_run.started_at,
        finished_at=crawl_run.finished_at,
        active=is_active(crawl_run.id) or any(
            not t.done() and t.get_name() == f"orphan-audit-{crawl_run.id}" for t in _ACTIVE_ORPHAN_TASKS
        ),
    )


@router.delete("/{crawl_run_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def remove_crawl_run(crawl_run_id: int) -> Response:
    cancel_crawl_run(crawl_run_id)
    with SessionLocal() as db:
        deleted = delete_crawl_run(db, crawl_run_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crawl run {crawl_run_id} not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{crawl_run_id}/summary", response_model=CrawlRunSummaryResponse)
async def get_crawl_run_summary(crawl_run_id: int) -> CrawlRunSummaryResponse:
    _require_crawl_run(crawl_run_id)
    with SessionLocal() as db:
        total_pages = db.scalar(
            select(func.count()).select_from(CrawledPage).where(CrawledPage.crawl_run_id == crawl_run_id)
        ) or 0

        scores = db.scalars(
            select(CrawlRunScore)
            .where(CrawlRunScore.crawl_run_id == crawl_run_id)
            .order_by(CrawlRunScore.category.asc())
        ).all()
        category_scores = {score.category: score.score for score in scores if score.category != "overall"}
        overall_score = next((score.score for score in scores if score.category == "overall"), None)

        severity_rows = db.execute(
            select(AuditIssue.severity, func.count(AuditIssue.id))
            .where(AuditIssue.crawl_run_id == crawl_run_id)
            .group_by(AuditIssue.severity)
        ).all()
        severity_counts = {severity: count for severity, count in severity_rows}
        for severity in ("critical", "high", "medium", "low"):
            severity_counts.setdefault(severity, 0)

        return CrawlRunSummaryResponse(
            overall_score=overall_score,
            category_scores=category_scores,
            total_pages=total_pages,
            total_issues_by_severity=severity_counts,
        )


@router.post("/{crawl_run_id}/run-audit", response_model=RunAuditResponse)
async def run_audit(crawl_run_id: int) -> RunAuditResponse:
    crawl_run = _require_crawl_run(crawl_run_id)
    if crawl_run.status not in {"completed", "failed", "enriching"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Audit can only run after the crawl has produced pages.",
        )
    with SessionLocal() as db:
        page_count = (
            db.scalar(
                select(func.count())
                .select_from(CrawledPage)
                .where(CrawledPage.crawl_run_id == crawl_run_id)
            )
            or 0
        )
    if page_count == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No crawled pages available to audit.",
        )

    try:
        result = await asyncio.to_thread(rule_engine.run, crawl_run_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    if crawl_run.status != "completed":
        storage.set_run_completed(crawl_run_id)

    return RunAuditResponse(
        crawl_run_id=crawl_run_id,
        issues_created=result["issues_created"],
        scores_created=result["scores_created"],
    )


@router.get("/{crawl_run_id}/issues", response_model=AuditIssueListResponse)
async def get_crawl_run_issues(
    crawl_run_id: int,
    category: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> AuditIssueListResponse:
    _require_crawl_run(crawl_run_id)

    with SessionLocal() as db:
        filters = [AuditIssue.crawl_run_id == crawl_run_id]
        if category:
            filters.append(AuditIssue.category == category)
        if severity:
            filters.append(AuditIssue.severity == severity)

        total = db.scalar(select(func.count()).select_from(AuditIssue).where(*filters)) or 0
        issues = db.scalars(
            select(AuditIssue)
            .where(*filters)
            .options(joinedload(AuditIssue.crawled_page).joinedload(CrawledPage.page_vitals))
            .order_by(AuditIssue.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).unique().all()

        return AuditIssueListResponse(
            total=total,
            page=page,
            page_size=page_size,
            items=[
                AuditIssueResponse(
                    id=issue.id,
                    rule_id=issue.rule_id,
                    category=issue.category,
                    severity=issue.severity,
                    target_url=issue.target_url or (issue.crawled_page.url if issue.crawled_page else None),
                    message=issue.message,
                    page_details=(
                        PageDetailsResponse(
                            id=issue.crawled_page.id,
                            url=issue.crawled_page.url,
                            title=issue.crawled_page.title,
                            meta_description=issue.crawled_page.meta_description,
                            canonical_url=issue.crawled_page.canonical_url,
                            word_count=issue.crawled_page.word_count,
                            status_code=issue.crawled_page.status_code,
                            response_time_ms=issue.crawled_page.response_time_ms,
                            vitals=_build_page_vitals(issue.crawled_page),
                        )
                        if issue.crawled_page
                        else None
                    ),
                )
                for issue in issues
            ],
        )


@router.get("/{crawl_run_id}/pages", response_model=CrawledPageListResponse)
async def get_crawl_run_pages(
    crawl_run_id: int,
    status_code: int | None = Query(default=None),
    issue_category: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str = Query(default="url"),
    sort_order: str = Query(default="asc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> CrawledPageListResponse:
    _require_crawl_run(crawl_run_id)

    with SessionLocal() as db:
        filters = [CrawledPage.crawl_run_id == crawl_run_id]
        if status_code is not None:
            filters.append(CrawledPage.status_code == status_code)
        if search:
            filters.append(CrawledPage.url.ilike(f"%{search}%"))

        query = select(CrawledPage).where(*filters).options(joinedload(CrawledPage.audit_issues))
        count_query = select(func.count(func.distinct(CrawledPage.id))).where(*filters)
        if issue_category:
            query = query.join(AuditIssue).where(
                AuditIssue.crawl_run_id == crawl_run_id,
                AuditIssue.category == issue_category,
            )
            count_query = count_query.join(AuditIssue).where(
                AuditIssue.crawl_run_id == crawl_run_id,
                AuditIssue.category == issue_category,
            )

        sort_map = {
            "url": CrawledPage.url,
            "status_code": CrawledPage.status_code,
            "word_count": CrawledPage.word_count,
            "response_time_ms": CrawledPage.response_time_ms,
        }
        sort_column = sort_map.get(sort_by, CrawledPage.url)
        query = query.order_by(sort_column.desc() if sort_order == "desc" else sort_column.asc())

        total = db.scalar(count_query) or 0
        pages = db.scalars(
            query.offset((page - 1) * page_size).limit(page_size)
        ).unique().all()

        return CrawledPageListResponse(
            total=total,
            page=page,
            page_size=page_size,
            items=[
                CrawledPageListItemResponse(
                    id=crawled_page.id,
                    url=crawled_page.url,
                    title=crawled_page.title,
                    status_code=crawled_page.status_code,
                    word_count=crawled_page.word_count,
                    response_time_ms=crawled_page.response_time_ms,
                    issue_count=len(crawled_page.audit_issues),
                )
                for crawled_page in pages
            ],
        )


@router.get("/{crawl_run_id}/scores", response_model=ScoreListResponse)
async def get_crawl_run_scores(crawl_run_id: int) -> ScoreListResponse:
    _require_crawl_run(crawl_run_id)
    with SessionLocal() as db:
        scores = db.scalars(
            select(CrawlRunScore)
            .where(CrawlRunScore.crawl_run_id == crawl_run_id)
            .order_by(CrawlRunScore.category.asc())
        ).all()

        return ScoreListResponse(
            items=[ScoreItemResponse(category=score.category, score=score.score) for score in scores]
        )


def _issue_match_key(issue: AuditIssue) -> tuple[str, str]:
    url = issue.target_url or (issue.crawled_page.url if issue.crawled_page else None) or ""
    return (url, issue.rule_id)


def _to_diff_issue(issue: AuditIssue) -> DiffIssueResponse:
    url = issue.target_url or (issue.crawled_page.url if issue.crawled_page else None)
    return DiffIssueResponse(
        rule_id=issue.rule_id,
        category=issue.category,
        severity=issue.severity,
        target_url=url,
        message=issue.message,
    )


@router.get("/{crawl_run_id}/diff", response_model=CrawlRunDiffResponse)
async def get_crawl_run_diff(
    crawl_run_id: int,
    compare_to: int = Query(..., ge=1, description="Previous crawl run id to compare against"),
) -> CrawlRunDiffResponse:
    current = _require_crawl_run(crawl_run_id)
    previous = _require_crawl_run(compare_to)
    if current.project_id != previous.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="compare_to must belong to the same project as the current crawl run.",
        )
    if crawl_run_id == compare_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="compare_to must be a different crawl run.",
        )

    with SessionLocal() as db:
        current_issues = db.scalars(
            select(AuditIssue)
            .where(AuditIssue.crawl_run_id == crawl_run_id)
            .options(joinedload(AuditIssue.crawled_page))
            .order_by(AuditIssue.id.asc())
        ).all()
        previous_issues = db.scalars(
            select(AuditIssue)
            .where(AuditIssue.crawl_run_id == compare_to)
            .options(joinedload(AuditIssue.crawled_page))
            .order_by(AuditIssue.id.asc())
        ).all()

        current_by_key: dict[tuple[str, str], AuditIssue] = {}
        for issue in current_issues:
            key = _issue_match_key(issue)
            current_by_key.setdefault(key, issue)

        previous_by_key: dict[tuple[str, str], AuditIssue] = {}
        for issue in previous_issues:
            key = _issue_match_key(issue)
            previous_by_key.setdefault(key, issue)

        current_keys = set(current_by_key)
        previous_keys = set(previous_by_key)

        new_issues = [_to_diff_issue(current_by_key[key]) for key in sorted(current_keys - previous_keys)]
        resolved_issues = [
            _to_diff_issue(previous_by_key[key]) for key in sorted(previous_keys - current_keys)
        ]
        persisting_issues = [
            _to_diff_issue(current_by_key[key]) for key in sorted(current_keys & previous_keys)
        ]

        return CrawlRunDiffResponse(
            current_run_id=crawl_run_id,
            compare_to_run_id=compare_to,
            new_issues=new_issues,
            resolved_issues=resolved_issues,
            persisting_issues=persisting_issues,
            counts={
                "new": len(new_issues),
                "resolved": len(resolved_issues),
                "persisting": len(persisting_issues),
            },
        )


@router.get("/{crawl_run_id}/report", response_model=ReportResponse)
async def get_crawl_run_report(crawl_run_id: int) -> ReportResponse:
    _require_crawl_run(crawl_run_id)
    try:
        report = await asyncio.to_thread(report_service.build_report, crawl_run_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ReportResponse(**report)


@router.get("/{crawl_run_id}/export/csv")
async def export_crawl_run_csv(crawl_run_id: int) -> StreamingResponse:
    _require_crawl_run(crawl_run_id)
    filename = f"crawl-run-{crawl_run_id}-issues.csv"
    return StreamingResponse(
        report_service.iter_csv_rows(crawl_run_id),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{crawl_run_id}/export/xlsx")
async def export_crawl_run_xlsx(crawl_run_id: int) -> StreamingResponse:
    _require_crawl_run(crawl_run_id)
    file_path, filename = await asyncio.to_thread(report_service.generate_xlsx_file, crawl_run_id)
    return StreamingResponse(
        iter_file_chunks(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        background=BackgroundTask(remove_file, file_path),
    )


@router.get("/{crawl_run_id}/export/pdf")
async def export_crawl_run_pdf(crawl_run_id: int) -> StreamingResponse:
    _require_crawl_run(crawl_run_id)
    try:
        file_path, filename = await asyncio.to_thread(report_service.generate_pdf_file, crawl_run_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF export failed: {exc}",
        ) from exc
    return StreamingResponse(
        iter_file_chunks(file_path),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        background=BackgroundTask(remove_file, file_path),
    )
