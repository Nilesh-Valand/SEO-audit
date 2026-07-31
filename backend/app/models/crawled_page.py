from sqlalchemy import String, Text, Integer, Boolean, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CrawledPage(Base):
    __tablename__ = "crawled_pages"
    __table_args__ = (
        UniqueConstraint("crawl_run_id", "url", name="uq_crawled_pages_run_url"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    raw_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta_robots: Mapped[str | None] = mapped_column(String(255), nullable=True)
    h1: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    redirect_hops: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_indexable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    has_schema: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    js_rendered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rendered_diff_significant: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    raw_html_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    crawl_run: Mapped["CrawlRun"] = relationship(back_populates="crawled_pages")  # noqa: F821
    links: Mapped[list["PageLink"]] = relationship(  # noqa: F821
        back_populates="crawled_page", cascade="all, delete-orphan"
    )
    page_vitals: Mapped[list["PageVital"]] = relationship(  # noqa: F821
        back_populates="crawled_page", cascade="all, delete-orphan"
    )
    audit_issues: Mapped[list["AuditIssue"]] = relationship(  # noqa: F821
        back_populates="crawled_page", cascade="all, delete-orphan"
    )
    technical_details: Mapped["PageTechnicalDetails | None"] = relationship(  # noqa: F821
        back_populates="crawled_page",
        cascade="all, delete-orphan",
        uselist=False,
    )
