from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENV: str = "development"
    DB_URL: str = "sqlite:///./app/db/audit.db"
    # Comma-separated list (no JSON required).
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    CRAWLER_USER_AGENT: str = "SEOAuditBot/0.1"
    CRAWLER_CONCURRENCY: int = 5
    CRAWLER_REQUEST_DELAY: float = 0.5
    CRAWLER_FLUSH_SIZE: int = 25
    CRAWLER_FLUSH_INTERVAL: float = 3.0
    CRAWLER_THIN_CONTENT_THRESHOLD: int = 200

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def allowed_origins(self) -> list[str]:
        return [part.strip() for part in self.ALLOWED_ORIGINS.split(",") if part.strip()]


settings = Settings()
