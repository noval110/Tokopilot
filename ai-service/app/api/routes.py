"""HTTP routes. /internal/* is callable only by the Go API (service token)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import require_service_token
from app.core.config import Settings, get_settings
from app.llm.registry import get_provider
from app.orchestrator.chat import run_step
from app.schemas.chat import ChatRequest, ChatResponse

public = APIRouter()
internal = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_service_token)])


@public.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@internal.get("/ping")
def ping(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str | bool]:
    # Reports whether a provider is configured, never which key or credential.
    return {"status": "ok", "provider_configured": settings.llm_provider != "none"}


@internal.post("/chat", response_model=ChatResponse, response_model_exclude_none=True)
async def chat(req: ChatRequest, settings: Annotated[Settings, Depends(get_settings)]) -> ChatResponse:
    """One model step. Returns an answer or proposed read-only tool calls."""
    provider = get_provider(settings)
    return await run_step(provider, req, settings.provider_timeout)
