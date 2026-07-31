from __future__ import annotations

from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENV: str = "development"
    DB_URL: str = "sqlite:///./app/db/audit.db"
    # Comma-separated. Leave empty until the Chrome extension ID is known (Phase 2).
    # Example then: chrome-extension://<extension-id>
    ALLOWED_ORIGINS: str = ""
    CRAWLER_USER_AGENT: str = "SEOAuditBot/0.1"
    CRAWLER_CONCURRENCY: int = 5
    CRAWLER_REQUEST_DELAY: float = 0.5
    CRAWLER_FLUSH_SIZE: int = 25
    CRAWLER_FLUSH_INTERVAL: float = 3.0
    CRAWLER_THIN_CONTENT_THRESHOLD: int = 200
    ENABLE_PAGESPEED: bool = False
    ENRICHMENT_PAGESPEED_SAMPLE_LIMIT: int = 25
    ENRICHMENT_PAGESPEED_BATCH_SIZE: int = 2
    ENRICHMENT_PAGESPEED_REQUEST_DELAY: float = 1.0
    ENRICHMENT_PAGESPEED_MAX_RETRIES: int = 3
    PAGESPEED_API_KEY: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def allowed_origins(self) -> list[str]:
        return [part.strip() for part in self.ALLOWED_ORIGINS.split(",") if part.strip()]

    @field_validator("PAGESPEED_API_KEY", mode="before")
    @classmethod
    def empty_str_to_none(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


settings = Settings()
