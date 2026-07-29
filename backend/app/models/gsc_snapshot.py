from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class GscSnapshot(Base):
    __tablename__ = "gsc_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"), nullable=False, index=True
    )
    indexed_page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inspected_url_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sitemap_submission_status: Mapped[str | None] = mapped_column(String(255), nullable=True)
    coverage_errors: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), nullable=False
    )

    project: Mapped["Project"] = relationship(back_populates="gsc_snapshots")  # noqa: F821
