from sqlalchemy import String, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CrawlRunScore(Base):
    __tablename__ = "crawl_run_scores"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)

    crawl_run: Mapped["CrawlRun"] = relationship(back_populates="scores")  # noqa: F821
