from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENV: str = "development"
    DB_URL: str = "sqlite:///./app/db/audit.db"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]
    CRAWLER_USER_AGENT: str = "SEOAuditBot/0.1"
    CRAWLER_CONCURRENCY: int = 5
    CRAWLER_REQUEST_DELAY: float = 0.5
    CRAWLER_FLUSH_SIZE: int = 25
    CRAWLER_FLUSH_INTERVAL: float = 3.0
    CRAWLER_THIN_CONTENT_THRESHOLD: int = 200
    ENRICHMENT_ENABLE_PAGESPEED: bool = False
    ENRICHMENT_ENABLE_GSC: bool = False
    ENRICHMENT_PAGESPEED_SAMPLE_LIMIT: int = 25
    ENRICHMENT_PAGESPEED_BATCH_SIZE: int = 2
    ENRICHMENT_PAGESPEED_REQUEST_DELAY: float = 1.0
    ENRICHMENT_PAGESPEED_MAX_RETRIES: int = 3
    ENRICHMENT_GSC_INSPECTION_SAMPLE_LIMIT: int = 20
    PAGESPEED_API_KEY: str | None = None
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REDIRECT_URI: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
