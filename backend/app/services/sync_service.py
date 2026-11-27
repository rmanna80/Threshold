"""Idempotent, revision-guarded synchronisation.

Conflict rule (identical on phone, watch and server): higher revision wins, then later client
updatedAt, then the lexicographically greater device id. Each envelope is acknowledged as:
applied | duplicate (idempotency key seen) | stale (server has a newer version) |
rejected (invalid — never retry) | deferred (dependency missing — retry later).
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    SYNCED_MODELS,
    ConsentRecordRow,
    DrinkEventRecord,
    DrinkingSessionRecord,
    InterventionEventRecord,
    RecoveryCheckinRecord,
    SyncedMixin,
    SyncEvent,
    User,
    UserGoalsRecord,
    UserPreferencesRecord,
)
from app.schemas import PAYLOAD_MODELS, SyncAck, SyncChange, SyncEnvelopeIn

ORDER = {"drinking_session": 0, "consent_record": 1, "user_goals": 1, "user_preferences": 1, "drink_event": 2, "recovery_checkin": 2, "intervention_event": 3}
MAX_PAYLOAD_KEYS = 64


def compare(a: tuple[int, int, str], b: tuple[int, int, str]) -> int:
    if a[0] != b[0]:
        return a[0] - b[0]
    if a[1] != b[1]:
        return 1 if a[1] > b[1] else -1
    return (a[2] > b[2]) - (a[2] < b[2])


def _columns(entity_type: str, p: dict[str, Any]) -> dict[str, Any]:
    """Denormalised, queryable columns extracted from a validated payload."""
    if entity_type == "drinking_session":
        return {"status": p["status"], "started_at_ms": p["startedAt"], "ended_at_ms": p.get("endedAt")}
    if entity_type == "drink_event":
        return {
            "session_id": uuid.UUID(str(p["sessionId"])),
            "consumed_at_ms": p["consumedAt"],
            "standard_drinks": p.get("standardDrinks"),
            "ethanol_grams": p.get("ethanolGrams"),
            "confirmation": p["confirmation"],
        }
    if entity_type == "recovery_checkin":
        sid = p.get("sessionId")
        return {"session_id": uuid.UUID(str(sid)) if sid else None, "local_date": p["localDate"]}
    if entity_type == "intervention_event":
        return {"session_id": uuid.UUID(str(p["sessionId"])), "category": p["category"], "triggered_at_ms": p["triggeredAt"], "delivered": p["delivered"]}
    if entity_type == "consent_record":
        return {"type": p["type"], "granted": p["granted"], "version": p["version"], "recorded_at_ms": p["recordedAt"]}
    return {}


def _dependency_missing(db: Session, user: User, entity_type: str, cols: dict[str, Any]) -> bool:
    sid = cols.get("session_id")
    if entity_type in ("drink_event", "intervention_event") or (entity_type == "recovery_checkin" and sid):
        owner = db.get(DrinkingSessionRecord, sid)
        return owner is None or owner.user_id != user.id
    return False


def apply_envelopes(db: Session, user: User, raw_envelopes: list[dict[str, Any]]) -> list[SyncAck]:
    acks: dict[int, SyncAck] = {}
    parsed: list[tuple[int, SyncEnvelopeIn]] = []
    for i, raw in enumerate(raw_envelopes):
        try:
            parsed.append((i, SyncEnvelopeIn.model_validate(raw)))
        except ValidationError as e:
            key = str(raw.get("idempotencyKey", f"invalid-{i}"))[:128]
            acks[i] = SyncAck(idempotency_key=key, status="rejected", server_revision=0, reason=f"invalid envelope: {e.error_count()} error(s)")
    parsed.sort(key=lambda t: (ORDER.get(t[1].entity_type, 9), t[0]))

    for i, env in parsed:
        acks[i] = _apply_one(db, user, env)
        db.flush()
    db.commit()
    return [acks[i] for i in sorted(acks)]


def _apply_one(db: Session, user: User, env: SyncEnvelopeIn) -> SyncAck:
    def ack(status: str, rev: int, reason: str | None = None) -> SyncAck:
        return SyncAck(idempotency_key=env.idempotency_key, status=status, server_revision=rev, reason=reason)  # type: ignore[arg-type]

    seen = db.scalar(select(SyncEvent).where(SyncEvent.user_id == user.id, SyncEvent.idempotency_key == env.idempotency_key))
    model = SYNCED_MODELS[env.entity_type]
    existing: SyncedMixin | None = db.get(model, env.entity_id)
    if existing is not None and getattr(existing, "user_id", None) != user.id:
        # Never reveal or touch another user's record, even on UUID collision.
        return ack("rejected", 0, "entity belongs to another account")
    if seen is not None:
        return ack("duplicate", existing.revision if existing else 0)

    if env.payload is None:
        return ack("rejected", existing.revision if existing else 0, "payload required")
    if len(env.payload) > MAX_PAYLOAD_KEYS:
        return ack("rejected", 0, "payload too large")
    try:
        validated = PAYLOAD_MODELS[env.entity_type].model_validate(env.payload)
    except ValidationError as e:
        return ack("rejected", existing.revision if existing else 0, f"invalid payload: {e.errors()[0]['msg'][:120]}")
    payload = validated.model_dump(by_alias=True, mode="json")
    pid = payload.get("id")
    if pid is not None and str(pid) != str(env.entity_id):
        return ack("rejected", 0, "payload id does not match entityId")

    incoming = (env.revision, env.client_updated_at, env.device_id)
    if existing is not None and compare(incoming, (existing.revision, existing.client_updated_at_ms, existing.device_id)) <= 0:
        _log(db, user, env, "stale")
        return ack("stale", existing.revision)

    cols = _columns(env.entity_type, payload)
    if _dependency_missing(db, user, env.entity_type, cols):
        return ack("deferred", existing.revision if existing else 0, "referenced session not yet synced")

    deleted_at = payload.get("deletedAt") if env.op == "upsert" else (payload.get("deletedAt") or env.client_updated_at)
    common = {
        "revision": env.revision,
        "client_updated_at_ms": env.client_updated_at,
        "device_id": env.device_id,
        "deleted_at_ms": deleted_at,
        "payload": payload,
        **cols,
    }
    if existing is None:
        db.add(model(id=env.entity_id, user_id=user.id, **common))  # type: ignore[call-arg]
    else:
        for k, v in common.items():
            setattr(existing, k, v)
    _log(db, user, env, "applied")
    return ack("applied", env.revision)


def _log(db: Session, user: User, env: SyncEnvelopeIn, status: str) -> None:
    db.add(
        SyncEvent(
            user_id=user.id,
            idempotency_key=env.idempotency_key,
            entity_type=env.entity_type,
            entity_id=env.entity_id,
            op=env.op,
            revision=env.revision,
            device_id=env.device_id,
            status=status,
        )
    )


def pull_changes(db: Session, user: User, cursor: int, limit: int) -> tuple[list[SyncChange], int, bool]:
    events = db.scalars(
        select(SyncEvent).where(SyncEvent.user_id == user.id, SyncEvent.seq > cursor, SyncEvent.status == "applied").order_by(SyncEvent.seq).limit(limit + 1)
    ).all()
    has_more = len(events) > limit
    events = events[:limit]
    latest: dict[tuple[str, uuid.UUID], int] = {}
    for e in events:
        latest[(e.entity_type, e.entity_id)] = e.seq
    changes: list[SyncChange] = []
    for (etype, eid), seq in sorted(latest.items(), key=lambda kv: kv[1]):
        row: SyncedMixin | None = db.get(SYNCED_MODELS[etype], eid)
        if row is None:
            continue
        changes.append(
            SyncChange(
                seq=seq,
                entity_type=etype,
                entity_id=eid,
                revision=row.revision,
                client_updated_at=row.client_updated_at_ms,
                device_id=row.device_id,
                deleted=row.deleted_at_ms is not None,
                payload=row.payload,
            )
        )
    next_cursor = events[-1].seq if events else cursor
    return changes, next_cursor, has_more


def export_user(db: Session, user: User) -> dict[str, Any]:
    def rows(model: type[SyncedMixin]) -> list[Any]:
        return [r.payload for r in db.scalars(select(model).where(model.user_id == user.id))]  # type: ignore[attr-defined]

    return {
        "account": {"id": str(user.id), "email": user.email, "createdAt": user.created_at.isoformat()},
        "sessions": rows(DrinkingSessionRecord),
        "drinks": rows(DrinkEventRecord),
        "checkins": rows(RecoveryCheckinRecord),
        "interventions": rows(InterventionEventRecord),
        "consents": rows(ConsentRecordRow),
        "goals": rows(UserGoalsRecord),
        "preferences": rows(UserPreferencesRecord),
    }
