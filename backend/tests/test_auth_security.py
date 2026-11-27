from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.logging_config import JsonFormatter, redact
from app.main import create_app
from app.security.middleware import MemoryLimiter
from tests.conftest import auth, register


def test_health_and_security_headers(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-frame-options"] == "DENY"


def test_register_login_refresh_rotation(client: TestClient) -> None:
    t = register(client)
    assert client.get("/v1/models", headers=auth(t)).status_code == 200
    login = client.post("/v1/auth/login", json={"email": t["email"].upper(), "password": t["password"], "deviceId": "phone-2"})
    assert login.status_code == 200
    r1 = client.post("/v1/auth/refresh", json={"refreshToken": t["refreshToken"]})
    assert r1.status_code == 200
    # Reusing a rotated refresh token is treated as theft: everything is revoked.
    reuse = client.post("/v1/auth/refresh", json={"refreshToken": t["refreshToken"]})
    assert reuse.status_code == 401
    assert client.post("/v1/auth/refresh", json={"refreshToken": r1.json()["refreshToken"]}).status_code == 401
    assert client.get("/v1/models", headers=auth(r1.json())).status_code == 401


def test_login_errors_are_generic(client: TestClient) -> None:
    t = register(client)
    wrong = client.post("/v1/auth/login", json={"email": t["email"], "password": "wrong password!", "deviceId": "d"})
    missing = client.post("/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong password!", "deviceId": "d"})
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


def test_registration_validation(client: TestClient) -> None:
    assert client.post("/v1/auth/register", json={"email": "a@example.com", "password": "short", "deviceId": "d"}).status_code == 422
    assert client.post("/v1/auth/register", json={"email": "not-an-email", "password": "long enough pw", "deviceId": "d"}).status_code == 422
    register(client, email="dup@example.com")
    dup = client.post("/v1/auth/register", json={"email": "DUP@example.com", "password": "long enough pw", "deviceId": "d"})
    assert dup.status_code == 409


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/v1/sync/pull"), ("post", "/v1/sync/push"), ("get", "/v1/account/export"), ("get", "/v1/models"), ("post", "/v1/auth/logout")],
)
def test_endpoints_require_authentication(client: TestClient, method: str, path: str) -> None:
    r = getattr(client, method)(path, headers={"Authorization": "Bearer not.a.token"})
    assert r.status_code == 401


def test_logout_revokes_access_tokens(client: TestClient) -> None:
    t = register(client)
    assert client.post("/v1/auth/logout", headers=auth(t)).status_code == 204
    assert client.get("/v1/models", headers=auth(t)).status_code == 401


def test_auth_rate_limit() -> None:
    app = create_app(limiter=MemoryLimiter())
    # Rebuild with a strict limit for this test.
    for m in app.user_middleware:
        if m.cls.__name__ == "SecurityMiddleware":
            m.kwargs["auth_per_minute"] = 3
    c = TestClient(app)
    codes = [c.post("/v1/auth/login", json={"email": "x@example.com", "password": "nope nope nope", "deviceId": "d"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401]
    assert codes[3:] == [429, 429]


def test_body_size_limit(client: TestClient) -> None:
    r = client.post("/v1/auth/login", content=b"x", headers={"content-length": str(3 * 1024 * 1024), "content-type": "application/json"})
    assert r.status_code == 413


def test_log_redaction() -> None:
    redacted = redact({"password": "p", "nested": {"refresh_token": "t", "ok": 1}})
    assert redacted == {"password": "[REDACTED]", "nested": {"refresh_token": "[REDACTED]", "ok": 1}}
    assert redact("contact me at someone@example.com with Bearer abc.def") == "contact me at [EMAIL] with Bearer [REDACTED]"
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "user %s", ("a@b.co",), None)
    record.payload = {"standardDrinks": 3}
    out = json.loads(JsonFormatter().format(record))
    assert out["msg"] == "user [EMAIL]"
    assert out["payload"] == "[REDACTED]"


def test_production_requires_strong_secrets() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(env="production", jwt_secret="change-me-in-every-environment", field_encryption_key="k", database_url="postgresql://x")
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        Settings(env="production", jwt_secret="y" * 40, field_encryption_key=None, database_url="postgresql://x")
