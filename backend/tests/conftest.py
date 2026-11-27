from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from cryptography.fernet import Fernet

_tmp = tempfile.mkdtemp(prefix="threshold-test-")
os.environ["THRESHOLD_ENV"] = "test"
os.environ["THRESHOLD_DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["THRESHOLD_FIELD_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["THRESHOLD_JWT_SECRET"] = "test-secret-" + "x" * 40
os.environ["THRESHOLD_AUTH_RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["THRESHOLD_RATE_LIMIT_PER_MINUTE"] = "10000"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import get_engine, reset_engine  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.main import create_app  # noqa: E402
from app.security.middleware import MemoryLimiter  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated() -> Iterator[None]:
    get_settings.cache_clear()
    reset_engine()
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield
    reset_engine()


@pytest.fixture(autouse=True)
def clean_tables() -> Iterator[None]:
    yield
    with get_engine().begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f"DELETE FROM {table.name}"))  # noqa: S608 - fixed table names


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(limiter=MemoryLimiter()))


def register(client: TestClient, email: str | None = None, password: str = "correct horse battery", device: str = "phone-1") -> dict[str, Any]:  # noqa: S107
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": password, "deviceId": device})
    assert r.status_code == 201, r.text
    return {"email": email, "password": password, **r.json()}


def auth(tokens: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['accessToken']}"}


# ---------------------------------------------------------------------------
# Payload factories mirroring the mobile app's records
# ---------------------------------------------------------------------------

T0 = 1_764_291_600_000


def session_payload(sid: str, revision: int = 1, status: str = "active", updated: int = T0, device: str = "phone-1") -> dict[str, Any]:
    return {
        "id": sid,
        "status": status,
        "startedAt": T0,
        "endedAt": None if status != "ended" else T0 + 3_600_000,
        "tzOffsetMin": -300,
        "pauses": [],
        "startContext": {"restingHeartRateBpm": None, "hrvSdnnMs": None, "lastNightSleepMinutes": None, "healthDataAuthorized": False},
        "goalSnapshot": {"maxStandardDrinksPerSession": 3, "paceGoalMinutesBetweenDrinks": None},
        "origin": "phone",
        "revision": revision,
        "updatedAt": updated,
        "deletedAt": None,
        "deviceId": device,
    }


def drink_payload(did: str, sid: str, revision: int = 1, fraction: float = 1.0, updated: int = T0, deleted: int | None = None) -> dict[str, Any]:
    ml = 12 * 29.5735295625
    grams = ml * fraction * 0.05 * 0.789
    return {
        "id": did,
        "sessionId": sid,
        "beverageId": None,
        "beverageName": "Secret Lager",
        "category": "beer",
        "servingInput": {"value": 12, "unit": "fl_oz_us"},
        "servingMl": ml,
        "fractionConsumed": fraction,
        "abvPercent": 5,
        "ethanolGrams": grams,
        "standardDrinks": grams / 14,
        "standardDrinkGrams": 14,
        "isAlcoholic": True,
        "consumedAt": T0 + 600_000,
        "loggedAt": T0 + 600_000,
        "tzOffsetMin": -300,
        "source": "manual",
        "confirmation": "user_confirmed",
        "uncertainty": {"abvKnown": True, "volumeKnown": True, "standardDrinksLow": None, "standardDrinksHigh": None, "note": None},
        "revision": revision,
        "updatedAt": updated,
        "deletedAt": deleted,
        "deviceId": "phone-1",
    }


def envelope(entity_type: str, payload: dict[str, Any], op: str = "upsert", key: str | None = None) -> dict[str, Any]:
    return {
        "idempotencyKey": key or f"{entity_type}:{payload['id']}:{payload['revision']}:{op}",
        "entityType": entity_type,
        "entityId": payload["id"],
        "op": op,
        "revision": payload["revision"],
        "clientUpdatedAt": payload["updatedAt"],
        "deviceId": payload.get("deviceId", "phone-1"),
        "payload": payload,
    }
