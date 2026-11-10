"""Request dependencies: internal service authentication."""

import hmac
from typing import Annotated

from fastapi import Depends, Header

from app.core.config import Settings, get_settings
from app.core.errors import ServiceError


def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Only the Go API may call internal routes. It sends `Authorization: Bearer <token>`.

    An empty configured token always rejects, so a misconfigured deploy fails closed.
    """
    expected = settings.ai_service_token.get_secret_value()
    scheme, _, presented = (authorization or "").partition(" ")
    if not expected or scheme.lower() != "bearer" or not hmac.compare_digest(presented.encode(), expected.encode()):
        raise ServiceError(401, "UNAUTHENTICATED", "Service credential tidak valid.")
