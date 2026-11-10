"""Select the provider adapter from configuration (LLM_PROVIDER)."""

from app.core.config import Settings
from app.core.errors import ServiceError
from app.llm.base import LLMProvider
from app.llm.scripted import ScriptedProvider


def get_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "scripted":
        return ScriptedProvider()
    # "none": assistant disabled. Real vendors (ADR-0006) are added here.
    raise ServiceError(503, "AI_NOT_CONFIGURED", "Provider AI belum dikonfigurasi.")
