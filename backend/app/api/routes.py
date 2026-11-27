from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app import __version__
from app.config import get_settings
from app.models import ConsentRecordRow, DataExportRequest, Device, ModelVersion, ResearchUpload, User
from app.schemas import (
    Credentials,
    DeleteAccountRequest,
    ModelVersionOut,
    RefreshRequest,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
    TokenResponse,
)
from app.security.auth import (
    CurrentUser,
    DbSession,
    create_access_token,
    hash_password,
    issue_refresh_token,
    needs_rehash,
    revoke_all,
    rotate_refresh_token,
    verify_password,
)
from app.services.sync_service import apply_envelopes, export_user, pull_changes

router = APIRouter()


@router.get("/health", tags=["meta"])
def health(db: DbSession) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "version": __version__}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def _touch_device(db: DbSession, user: User, device_id: str) -> None:
    dev = db.scalar(select(Device).where(Device.user_id == user.id, Device.client_device_id == device_id))
    if dev is None:
        db.add(Device(user_id=user.id, client_device_id=device_id))
    else:
        dev.last_seen_at = datetime.now(UTC)


def _tokens(db: DbSession, user: User, device_id: str | None) -> TokenResponse:
    refresh = issue_refresh_token(db, user, device_id)
    db.commit()
    return TokenResponse(access_token=create_access_token(user), refresh_token=refresh, expires_in=get_settings().access_token_ttl_seconds)


@router.post("/v1/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, tags=["auth"])
def register(body: Credentials, db: DbSession) -> TokenResponse:
    user = User(email=body.email.lower(), password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        # Generic message: do not confirm whether an email is registered beyond what is necessary.
        raise HTTPException(status.HTTP_409_CONFLICT, "Unable to register with these details") from exc
    _touch_device(db, user, body.device_id)
    return _tokens(db, user, body.device_id)


@router.post("/v1/auth/login", response_model=TokenResponse, tags=["auth"])
def login(body: Credentials, db: DbSession) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_login_at = datetime.now(UTC)
    _touch_device(db, user, body.device_id)
    return _tokens(db, user, body.device_id)


@router.post("/v1/auth/refresh", response_model=TokenResponse, tags=["auth"])
def refresh(body: RefreshRequest, db: DbSession) -> TokenResponse:
    user, new_refresh = rotate_refresh_token(db, body.refresh_token, body.device_id)
    db.commit()
    return TokenResponse(access_token=create_access_token(user), refresh_token=new_refresh, expires_in=get_settings().access_token_ttl_seconds)


@router.post("/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
def logout(user: CurrentUser, db: DbSession) -> Response:
    revoke_all(db, user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


@router.post("/v1/sync/push", response_model=SyncPushResponse, tags=["sync"])
def push(body: SyncPushRequest, user: CurrentUser, db: DbSession) -> SyncPushResponse:
    if len(body.envelopes) > get_settings().max_sync_batch:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too many envelopes in one batch")
    _touch_device(db, user, body.device_id)
    return SyncPushResponse(acks=apply_envelopes(db, user, body.envelopes))


@router.get("/v1/sync/pull", response_model=SyncPullResponse, tags=["sync"])
def pull(user: CurrentUser, db: DbSession, cursor: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=1000)] = 500) -> SyncPullResponse:
    changes, next_cursor, has_more = pull_changes(db, user, cursor, limit)
    return SyncPullResponse(changes=changes, next_cursor=next_cursor, has_more=has_more)


# ---------------------------------------------------------------------------
# Account: export & deletion
# ---------------------------------------------------------------------------


@router.get("/v1/account/export", tags=["account"])
def export_account(user: CurrentUser, db: DbSession) -> dict[str, Any]:
    data = export_user(db, user)
    db.add(DataExportRequest(user_id=user.id, format="json", status="completed", completed_at=datetime.now(UTC)))
    db.commit()
    return {"schemaVersion": 1, "exportedAt": datetime.now(UTC).isoformat(), "data": data}


@router.delete("/v1/account", status_code=status.HTTP_204_NO_CONTENT, tags=["account"])
def delete_account(body: DeleteAccountRequest, user: CurrentUser, db: DbSession) -> Response:
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password confirmation failed")
    # Hard delete; every user-owned table cascades on users.id.
    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Model registry (read-only to clients)
# ---------------------------------------------------------------------------


@router.get("/v1/models", response_model=list[ModelVersionOut], tags=["models"])
def list_models(_: CurrentUser, db: DbSession) -> list[ModelVersionOut]:
    rows = db.scalars(select(ModelVersion).where(ModelVersion.status != "retired").order_by(ModelVersion.created_at)).all()
    return [ModelVersionOut(model_id=r.model_id, version=r.version, task=r.task, status=r.status) for r in rows]  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Research uploads (disabled unless configured AND consented)
# ---------------------------------------------------------------------------


@router.post("/v1/research/uploads", status_code=status.HTTP_201_CREATED, tags=["research"])
def research_upload(body: dict[str, Any], user: CurrentUser, db: DbSession) -> dict[str, str]:
    if not get_settings().research_uploads_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Research uploads are not enabled")
    consent = db.scalar(
        select(ConsentRecordRow)
        .where(ConsentRecordRow.user_id == user.id, ConsentRecordRow.type == "research_upload")
        .order_by(ConsentRecordRow.recorded_at_ms.desc())
        .limit(1)
    )
    if consent is None or not consent.granted:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Research consent has not been granted")
    samples = body.get("samples")
    protocol = body.get("protocolId")
    if not isinstance(samples, list) or not isinstance(protocol, str) or not (1 <= len(samples) <= 100_000):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "protocolId and 1–100000 samples are required")
    upload = ResearchUpload(user_id=user.id, protocol_id=protocol[:100], consent_record_id=consent.id, sample_count=len(samples), payload=body)
    db.add(upload)
    db.commit()
    return {"id": str(upload.id) if upload.id else str(uuid.uuid4())}
