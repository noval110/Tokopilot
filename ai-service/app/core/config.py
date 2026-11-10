"""Runtime settings for the AI service, loaded from environment variables."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# "none"     → assistant disabled (service still boots for health checks)
# "scripted" → deterministic stand-in used until a real vendor is chosen (ADR-0006)
# Real vendor adapters plug in here later without changing the Go API.
ProviderName = Literal["none", "scripted"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    app_env: Literal["development", "test", "staging", "production"] = "development"
    ai_service_token: SecretStr = SecretStr("")
    llm_provider: ProviderName = "none"
    llm_api_key: SecretStr = SecretStr("")
    llm_model: str = ""
    ai_request_timeout_seconds: float = Field(default=30, gt=0, le=120)

    @model_validator(mode="after")
    def _strict_outside_dev(self) -> "Settings":
        if self.app_env in ("staging", "production"):
            token = self.ai_service_token.get_secret_value()
            if len(token) < 32 or token.startswith("replace-with"):
                raise ValueError("AI_SERVICE_TOKEN must be >= 32 chars and not a placeholder")
        return self

    @property
    def provider_timeout(self) -> float:
        """Slightly below the Go API's per-call timeout so we answer before it gives up."""
        return max(0.5, self.ai_request_timeout_seconds * 0.8)


@lru_cache
def get_settings() -> Settings:
    return Settings()
