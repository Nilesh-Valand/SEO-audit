from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class SitemapFinding(Base):
    __tablename__ = "sitemap_findings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    crawl_run_id: Mapped[int] = mapped_column(
        ForeignKey("crawl_runs.id"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    finding_type: Mapped[str] = mapped_column(String(100), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )

    crawl_run: Mapped["CrawlRun"] = relationship()  # noqa: F821
