from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class PageVital(Base):
    __tablename__ = "page_vitals"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    crawled_page_id: Mapped[int] = mapped_column(
        ForeignKey("crawled_pages.id"), nullable=False, index=True
    )
    lcp_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    inp_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    cls: Mapped[float | None] = mapped_column(Float, nullable=True)
    performance_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    strategy: Mapped[str] = mapped_column(String(20), nullable=False)

    crawled_page: Mapped["CrawledPage"] = relationship(back_populates="page_vitals")  # noqa: F821
