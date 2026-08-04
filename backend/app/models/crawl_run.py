from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
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

    # Site-level checks (once per crawl run)
    robots_txt_found: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    robots_txt_valid: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    robots_txt_ai_disallowed: Mapped[list | dict | None] = mapped_column(JSON, nullable=True)
    robots_txt_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    llms_txt_present: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    soft_404_probe_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    soft_404_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    soft_404_word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    soft_404_is_soft: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    soft_404_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped["Project"] = relationship(back_populates="crawl_runs")  # noqa: F821
    crawled_pages: Mapped[list["CrawledPage"]] = relationship(  # noqa: F821
        back_populates="crawl_run", cascade="all, delete-orphan"
    )
    scores: Mapped[list["CrawlRunScore"]] = relationship(  # noqa: F821
        back_populates="crawl_run", cascade="all, delete-orphan"
    )
