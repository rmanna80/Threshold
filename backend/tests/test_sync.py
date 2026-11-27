from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import get_engine
from tests.conftest import T0, auth, drink_payload, envelope, register, session_payload


def push(client: TestClient, tokens: dict, envelopes: list[dict], device: str = "phone-1") -> list[dict]:
    r = client.post("/v1/sync/push", json={"deviceId": device, "envelopes": envelopes}, headers=auth(tokens))
    assert r.status_code == 200, r.text
    return r.json()["acks"]


def new_ids() -> tuple[str, str]:
    return str(uuid.uuid4()), str(uuid.uuid4())


def test_push_pull_roundtrip_with_out_of_order_batch(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    # Drink listed before its session: the server orders sessions first.
    acks = push(client, t, [envelope("drink_event", drink_payload(did, sid)), envelope("drinking_session", session_payload(sid))])
    assert [a["status"] for a in acks] == ["applied", "applied"]
    pulled = client.get("/v1/sync/pull", params={"cursor": 0}, headers=auth(t)).json()
    assert {c["entityType"] for c in pulled["changes"]} == {"drinking_session", "drink_event"}
    drink = next(c for c in pulled["changes"] if c["entityType"] == "drink_event")
    assert drink["payload"]["beverageName"] == "Secret Lager"
    assert pulled["nextCursor"] > 0
    again = client.get("/v1/sync/pull", params={"cursor": pulled["nextCursor"]}, headers=auth(t)).json()
    assert again["changes"] == []


def test_idempotency_and_revision_guard(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    push(client, t, [envelope("drinking_session", session_payload(sid))])
    first = envelope("drink_event", drink_payload(did, sid))
    assert push(client, t, [first])[0]["status"] == "applied"
    assert push(client, t, [first])[0]["status"] == "duplicate"
    newer = envelope("drink_event", drink_payload(did, sid, revision=2, fraction=0.5, updated=T0 + 1))
    assert push(client, t, [newer])[0]["status"] == "applied"
    stale = envelope("drink_event", drink_payload(did, sid, revision=1, fraction=0.25, updated=T0 + 2), key="late-delivery-0001")
    ack = push(client, t, [stale])[0]
    assert ack["status"] == "stale"
    assert ack["serverRevision"] == 2
    changes = client.get("/v1/sync/pull", headers=auth(t)).json()["changes"]
    assert next(c for c in changes if c["entityId"] == did)["payload"]["fractionConsumed"] == 0.5


def test_tombstones_propagate(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    push(client, t, [envelope("drinking_session", session_payload(sid)), envelope("drink_event", drink_payload(did, sid))])
    tomb = drink_payload(did, sid, revision=2, updated=T0 + 5, deleted=T0 + 5)
    assert push(client, t, [envelope("drink_event", tomb, op="delete")])[0]["status"] == "applied"
    change = next(c for c in client.get("/v1/sync/pull", headers=auth(t)).json()["changes"] if c["entityId"] == did)
    assert change["deleted"] is True


def test_missing_session_is_deferred_not_rejected(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    ack = push(client, t, [envelope("drink_event", drink_payload(did, sid))])[0]
    assert ack["status"] == "deferred"
    push(client, t, [envelope("drinking_session", session_payload(sid))])
    assert push(client, t, [envelope("drink_event", drink_payload(did, sid))])[0]["status"] == "applied"


def test_inconsistent_alcohol_math_is_rejected(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    push(client, t, [envelope("drinking_session", session_payload(sid))])
    bad = drink_payload(did, sid)
    bad["standardDrinks"] = 0.1  # does not match ethanolGrams / 14
    ack = push(client, t, [envelope("drink_event", bad)])[0]
    assert ack["status"] == "rejected"
    bad2 = drink_payload(did, sid)
    bad2["ethanolGrams"] = 1.0
    bad2["standardDrinks"] = 1.0 / 14
    assert push(client, t, [envelope("drink_event", bad2)])[0]["status"] == "rejected"


def test_invalid_envelopes_are_rejected_individually(client: TestClient) -> None:
    t = register(client)
    sid = str(uuid.uuid4())
    good = envelope("drinking_session", session_payload(sid))
    mismatched = envelope("drinking_session", session_payload(str(uuid.uuid4())))
    mismatched["entityId"] = str(uuid.uuid4())
    acks = push(client, t, [{"idempotencyKey": "garbage-000", "entityType": "nope"}, good, mismatched])
    assert [a["status"] for a in acks] == ["rejected", "applied", "rejected"]


def test_cross_account_isolation(client: TestClient) -> None:
    alice = register(client)
    mallory = register(client)
    sid, did = new_ids()
    push(client, alice, [envelope("drinking_session", session_payload(sid)), envelope("drink_event", drink_payload(did, sid))])
    # Mallory tries to overwrite Alice's records by reusing their ids.
    hijack = push(client, mallory, [envelope("drinking_session", session_payload(sid, revision=9), key="hijack-session-1")])
    assert hijack[0]["status"] == "rejected"
    other_session = str(uuid.uuid4())
    push(client, mallory, [envelope("drinking_session", session_payload(other_session))])
    steal = push(client, mallory, [envelope("drink_event", drink_payload(str(uuid.uuid4()), sid))])
    assert steal[0]["status"] == "deferred"  # Alice's session is invisible to Mallory
    assert all(c["entityId"] != did for c in client.get("/v1/sync/pull", headers=auth(mallory)).json()["changes"])


def test_pull_pagination(client: TestClient) -> None:
    t = register(client)
    sid = str(uuid.uuid4())
    envs = [envelope("drinking_session", session_payload(sid))] + [envelope("drink_event", drink_payload(str(uuid.uuid4()), sid)) for _ in range(5)]
    push(client, t, envs)
    seen: set[str] = set()
    cursor = 0
    for _ in range(10):
        page = client.get("/v1/sync/pull", params={"cursor": cursor, "limit": 2}, headers=auth(t)).json()
        seen |= {c["entityId"] for c in page["changes"]}
        cursor = page["nextCursor"]
        if not page["hasMore"]:
            break
    assert len(seen) == 6


def test_payloads_are_encrypted_at_rest(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    push(client, t, [envelope("drinking_session", session_payload(sid)), envelope("drink_event", drink_payload(did, sid))])
    with get_engine().connect() as conn:
        raw = conn.execute(text("SELECT payload FROM drink_events")).scalar_one()
    assert raw.startswith("fernet:")
    assert "Secret Lager" not in raw


def test_export_and_account_deletion(client: TestClient) -> None:
    t = register(client)
    sid, did = new_ids()
    push(client, t, [envelope("drinking_session", session_payload(sid)), envelope("drink_event", drink_payload(did, sid))])
    export = client.get("/v1/account/export", headers=auth(t)).json()
    assert export["data"]["drinks"][0]["id"] == did
    assert client.request("DELETE", "/v1/account", json={"password": "wrong"}, headers=auth(t)).status_code == 403
    assert client.request("DELETE", "/v1/account", json={"password": t["password"]}, headers=auth(t)).status_code == 204
    with get_engine().connect() as conn:
        for table in ("users", "drinking_sessions", "drink_events", "sync_events", "refresh_tokens", "devices"):
            assert conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one() == 0  # noqa: S608
    assert client.get("/v1/sync/pull", headers=auth(t)).status_code == 401


def test_research_uploads_require_configuration_and_consent(client: TestClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    t = register(client)
    body = {"protocolId": "gesture-v1", "samples": [{"t": 0, "ax": 0.1}]}
    assert client.post("/v1/research/uploads", json=body, headers=auth(t)).status_code == 404
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "research_uploads_enabled", True)
    assert client.post("/v1/research/uploads", json=body, headers=auth(t)).status_code == 403
    consent = {
        "id": str(uuid.uuid4()),
        "type": "research_upload",
        "granted": True,
        "version": "2026-11-1",
        "recordedAt": T0,
        "revision": 1,
        "updatedAt": T0,
        "deviceId": "phone-1",
    }
    push(client, t, [envelope("consent_record", consent)])
    assert client.post("/v1/research/uploads", json=body, headers=auth(t)).status_code == 201
