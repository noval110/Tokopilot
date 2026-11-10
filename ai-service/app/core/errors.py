"""Error envelope identical in shape to the Go API (PRD §12.2)."""

import logging
import secrets

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("tokopilot.ai")


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status, self.code, self.message = status, code, message


def request_id(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    return rid or "req_" + secrets.token_hex(12)


def _envelope(request: Request, status: int, code: str, message: str) -> JSONResponse:
    rid = request_id(request)
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "request_id": rid}},
        headers={"X-Request-Id": rid},
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def _service(request: Request, exc: ServiceError) -> JSONResponse:
        return _envelope(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, _: RequestValidationError) -> JSONResponse:
        return _envelope(request, 400, "VALIDATION_ERROR", "Permintaan tidak valid.")

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        msg = "Endpoint tidak ditemukan." if exc.status_code == 404 else "Permintaan gagal."
        return _envelope(request, exc.status_code, code, msg)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled error", extra={"request_id": request_id(request)}, exc_info=exc)
        return _envelope(request, 500, "INTERNAL_ERROR", "Terjadi kesalahan pada layanan AI.")
