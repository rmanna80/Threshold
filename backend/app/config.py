from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT_SECRET = "change-me-in-every-environment"  # noqa: S105 - placeholder detected below


class Settings(BaseSettings):
    """Environment-specific configuration (THRESHOLD_* variables)."""

    model_config = SettingsConfigDict(env_prefix="THRESHOLD_", env_file=".env", extra="ignore")

    env: Literal["development", "test", "staging", "production"] = "development"
    database_url: str = "postgresql+psycopg://threshold:threshold@localhost:5432/threshold"
    redis_url: str | None = None
    jwt_secret: str = INSECURE_DEFAULT_SECRET
    jwt_issuer: str = "threshold-api"
    access_token_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    refresh_token_ttl_seconds: int = Field(default=30 * 24 * 3600, ge=3600)
    field_encryption_key: str | None = None
    cors_origins: list[str] = Field(default_factory=list)
    rate_limit_per_minute: int = Field(default=120, ge=1)
    auth_rate_limit_per_minute: int = Field(default=10, ge=1)
    max_sync_batch: int = Field(default=500, ge=1, le=2000)
    research_uploads_enabled: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def require_secrets_outside_dev(self) -> Settings:
        if self.env in ("staging", "production"):
            if self.jwt_secret == INSECURE_DEFAULT_SECRET or len(self.jwt_secret) < 32:
                raise ValueError("THRESHOLD_JWT_SECRET must be set to a strong secret outside development")
            if not self.field_encryption_key:
                raise ValueError("THRESHOLD_FIELD_ENCRYPTION_KEY is required outside development")
            if not self.database_url.startswith("postgresql"):
                raise ValueError("PostgreSQL is required outside development")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
