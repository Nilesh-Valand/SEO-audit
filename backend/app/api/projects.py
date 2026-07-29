from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.db.database import SessionLocal
from app.models import CrawlRun, Project
from app.services.crawl_runs import cancel_crawl_run
from app.services.deletions import delete_project

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    domain: str = Field(min_length=1, max_length=255)


class ProjectResponse(BaseModel):
    id: int
    domain: str
    created_at: datetime


class ProjectListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ProjectResponse]


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
) -> ProjectListResponse:
    with SessionLocal() as db:
        total = db.scalar(select(func.count()).select_from(Project)) or 0
        projects = db.scalars(
            select(Project)
            .order_by(Project.created_at.desc(), Project.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()

        return ProjectListResponse(
            total=total,
            page=page,
            page_size=page_size,
            items=[
                ProjectResponse(id=project.id, domain=project.domain, created_at=project.created_at)
                for project in projects
            ],
        )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(payload: CreateProjectRequest) -> ProjectResponse:
    domain = payload.domain.strip()
    with SessionLocal() as db:
        project = Project(domain=domain)
        db.add(project)
        db.commit()
        db.refresh(project)
        return ProjectResponse(id=project.id, domain=project.domain, created_at=project.created_at)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def remove_project(project_id: int) -> Response:
    with SessionLocal() as db:
        run_ids = list(
            db.scalars(select(CrawlRun.id).where(CrawlRun.project_id == project_id)).all()
        )
    for run_id in run_ids:
        cancel_crawl_run(run_id)

    with SessionLocal() as db:
        deleted = delete_project(db, project_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
