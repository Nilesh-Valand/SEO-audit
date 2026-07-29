from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class AuditIssue(Base):
    __tablename__ = "audit_issues"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    crawl_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("crawl_runs.id"), nullable=True, index=True
    )
    crawled_page_id: Mapped[int | None] = mapped_column(
        ForeignKey("crawled_pages.id"), nullable=True, index=True
    )
    rule_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    severity: Mapped[str] = mapped_column(String(50), nullable=False)
    target_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    crawled_page: Mapped["CrawledPage | None"] = relationship(back_populates="audit_issues")  # noqa: F821
