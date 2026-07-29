import asyncio
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Windows + Playwright needs ProactorEventLoop for subprocess support.
# Even with this, Playwright may still fail under uvicorn --reload; the crawler
# treats Playwright as optional and continues with httpx HTML crawling.
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from app.config import settings
from app.api.crawl_runs import router as crawl_runs_router
from app.api.gsc import router as gsc_router
from app.api.health import router as health_router
from app.api.projects import router as projects_router

app = FastAPI(title="SEO Audit API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(crawl_runs_router, prefix="/api")
app.include_router(gsc_router, prefix="/api")
