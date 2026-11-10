"""FastAPI entrypoint for the TokoPilot AI service."""

import re
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from pydantic import ValidationError

from app.api.routes import internal, public
from app.core.config import get_settings
from app.core.errors import install_error_handlers

_SAFE_RID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class ConfigError(RuntimeError):
    """Startup configuration is invalid. Carries rule messages only, never input values."""


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Fail fast like the Go API: a misconfigured instance must not start and look healthy.
    try:
        get_settings()
    except ValidationError as exc:
        rules = "; ".join(
            str(e.get("msg", "invalid value")) for e in exc.errors(include_input=False, include_url=False)
        )
        raise ConfigError(f"invalid AI service configuration: {rules}") from None
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        lifespan=_lifespan,
        title="TokoPilot AI Service",
        version="0.1.0",
        # Internal service: no public interactive docs.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def _request_id(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        inbound = request.headers.get("x-request-id", "")
        rid = inbound if _SAFE_RID.match(inbound) else "req_" + secrets.token_hex(12)
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        return response

    install_error_handlers(app)
    app.include_router(public)
    app.include_router(internal)
    return app


app = create_app()
