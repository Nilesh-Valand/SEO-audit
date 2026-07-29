from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.config import settings
from app.crawler.storage import CrawlStorage
from app.services.enrichment import EnrichmentService

router = APIRouter(prefix="/gsc", tags=["gsc"])
storage = CrawlStorage()
enrichment_service = EnrichmentService()

_GSC_DISABLED_DETAIL = (
    "Google Search Console integration is disabled. "
    "Set ENABLE_GSC=true and configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, "
    "and GOOGLE_REDIRECT_URI to enable it."
)


class GscOAuthStartResponse(BaseModel):
    authorization_url: str


class GscOAuthCallbackResponse(BaseModel):
    connected: bool
    project_id: int
    property_url: str


@router.get("/oauth/start", response_model=GscOAuthStartResponse)
async def start_gsc_oauth(
    project_id: int = Query(..., ge=1),
    property_url: str = Query(..., min_length=1),
) -> GscOAuthStartResponse:
    if not settings.ENRICHMENT_ENABLE_GSC:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_GSC_DISABLED_DETAIL)

    project = storage.get_project(project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found.",
        )

    try:
        authorization_url = enrichment_service.create_gsc_oauth_url(
            project_id=project_id,
            property_url=property_url,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return GscOAuthStartResponse(authorization_url=authorization_url)


@router.get("/oauth/callback", response_model=GscOAuthCallbackResponse)
async def gsc_oauth_callback(code: str, state: str) -> GscOAuthCallbackResponse:
    if not settings.ENRICHMENT_ENABLE_GSC:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_GSC_DISABLED_DETAIL)

    try:
        result = await enrichment_service.complete_gsc_oauth(state=state, code=code)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to complete Google OAuth exchange.",
        ) from exc

    return GscOAuthCallbackResponse(connected=True, **result)
