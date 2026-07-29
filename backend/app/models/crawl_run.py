from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CrawlRun(Base):
    __tablename__ = "crawl_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_urls: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="crawl_runs")  # noqa: F821
    crawled_pages: Mapped[list["CrawledPage"]] = relationship(  # noqa: F821
        back_populates="crawl_run", cascade="all, delete-orphan"
    )
    scores: Mapped[list["CrawlRunScore"]] = relationship(  # noqa: F821
        back_populates="crawl_run", cascade="all, delete-orphan"
    )
