import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import create_app

TOKEN = "t" * 40


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_service_token=TOKEN)
    return TestClient(app, raise_server_exceptions=False)


def test_healthz_is_public(client: TestClient) -> None:
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers["x-request-id"].startswith("req_")


def test_internal_requires_service_token(client: TestClient) -> None:
    res = client.get("/internal/v1/ping")
    assert res.status_code == 401
    body = res.json()["error"]
    assert body["code"] == "UNAUTHENTICATED"
    assert body["request_id"]


def test_internal_rejects_wrong_token(client: TestClient) -> None:
    res = client.get("/internal/v1/ping", headers={"Authorization": "Bearer wrong"})
    assert res.status_code == 401


def test_internal_accepts_valid_token_without_leaking_config(client: TestClient) -> None:
    res = client.get("/internal/v1/ping", headers={"Authorization": f"Bearer {TOKEN}"})
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "provider_configured": False}
    assert TOKEN not in res.text


def test_empty_configured_token_fails_closed() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_service_token="")
    res = TestClient(app).get("/internal/v1/ping", headers={"Authorization": "Bearer "})
    assert res.status_code == 401


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    res = client.get("/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_safe_inbound_request_id_is_reused(client: TestClient) -> None:
    res = client.get("/healthz", headers={"X-Request-Id": "req_from_go_api_123"})
    assert res.headers["x-request-id"] == "req_from_go_api_123"


def test_production_rejects_placeholder_token() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="production", ai_service_token="replace-with-service-secret")


def test_production_misconfiguration_fails_at_startup_without_echoing_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.main import ConfigError

    secret = "short-but-secret-value"
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("AI_SERVICE_TOKEN", secret)
    monkeypatch.setenv("LLM_API_KEY", "sk-must-never-appear-in-logs")
    get_settings.cache_clear()
    try:
        with pytest.raises(ConfigError) as exc, TestClient(create_app()):
            pass
        message = str(exc.value)
        assert "AI_SERVICE_TOKEN must be" in message
        assert secret not in message and "sk-must-never" not in message
        assert exc.value.__cause__ is None and exc.value.__suppress_context__
    finally:
        get_settings.cache_clear()
