"""Server-side schema.

Only data the user chooses to sync lives here. Raw sensor data stays on the device except for
explicitly consented research uploads. Client timestamps are UTC epoch milliseconds (BigInteger)
to preserve exact values; server bookkeeping uses timezone-aware timestamps.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.security.crypto import EncryptedJSON


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    devices: Mapped[list[Device]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "client_device_id"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_device_id: Mapped[str] = mapped_column(String(100))
    platform: Mapped[str] = mapped_column(String(20), default="ios")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user: Mapped[User] = relationship(back_populates="devices")


class SyncedMixin:
    """Columns every synced, client-owned record carries for conflict resolution."""

    revision: Mapped[int] = mapped_column(Integer)
    client_updated_at_ms: Mapped[int] = mapped_column(BigInteger)
    device_id: Mapped[str] = mapped_column(String(100))
    deleted_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    payload: Mapped[Any] = mapped_column(EncryptedJSON)
    server_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DrinkingSessionRecord(SyncedMixin, Base):
    __tablename__ = "drinking_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'paused', 'ended')", name="status_valid"),
        Index("ix_drinking_sessions_user_started", "user_id", "started_at_ms"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10))
    started_at_ms: Mapped[int] = mapped_column(BigInteger)
    ended_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class DrinkEventRecord(SyncedMixin, Base):
    __tablename__ = "drink_events"
    __table_args__ = (
        CheckConstraint("standard_drinks IS NULL OR standard_drinks >= 0", name="std_nonnegative"),
        Index("ix_drink_events_user_consumed", "user_id", "consumed_at_ms"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drinking_sessions.id", ondelete="CASCADE"), index=True)
    consumed_at_ms: Mapped[int] = mapped_column(BigInteger)
    standard_drinks: Mapped[float | None] = mapped_column(Float, nullable=True)
    ethanol_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    confirmation: Mapped[str] = mapped_column(String(30))


class RecoveryCheckinRecord(SyncedMixin, Base):
    __tablename__ = "recovery_checkins"
    __table_args__ = (Index("ix_recovery_checkins_user_date", "user_id", "local_date"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("drinking_sessions.id", ondelete="SET NULL"), nullable=True)
    local_date: Mapped[str] = mapped_column(String(10))


class InterventionEventRecord(SyncedMixin, Base):
    __tablename__ = "intervention_events"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drinking_sessions.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(40))
    triggered_at_ms: Mapped[int] = mapped_column(BigInteger)
    delivered: Mapped[bool] = mapped_column(Boolean)


class ConsentRecordRow(SyncedMixin, Base):
    __tablename__ = "user_consents"
    __table_args__ = (Index("ix_user_consents_user_type", "user_id", "type", "recorded_at_ms"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(40))
    granted: Mapped[bool] = mapped_column(Boolean)
    version: Mapped[str] = mapped_column(String(20))
    recorded_at_ms: Mapped[int] = mapped_column(BigInteger)


class UserGoalsRecord(SyncedMixin, Base):
    __tablename__ = "user_goals"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)


class UserPreferencesRecord(SyncedMixin, Base):
    __tablename__ = "user_preferences"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)


class SyncEvent(Base):
    """Server change log. `seq` is a monotonically increasing cursor for pulls."""

    __tablename__ = "sync_events"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key"),
        Index("ix_sync_events_user_seq", "user_id", "seq"),
    )
    seq: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    op: Mapped[str] = mapped_column(String(10))
    revision: Mapped[int] = mapped_column(Integer)
    device_id: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    __table_args__ = (
        UniqueConstraint("model_id", "version"),
        CheckConstraint("status IN ('experimental', 'validated', 'retired')", name="status_valid"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    model_id: Mapped[str] = mapped_column(String(100))
    version: Mapped[str] = mapped_column(String(50))
    task: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default="experimental")
    validation_report: Mapped[Any] = mapped_column(EncryptedJSON, nullable=True)
    validated_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DataExportRequest(Base):
    __tablename__ = "data_export_requests"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(10), default="json")
    status: Mapped[str] = mapped_column(String(20), default="completed")
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchUpload(Base):
    """Consented research data (e.g. labelled motion windows). Disabled unless configured."""

    __tablename__ = "research_uploads"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    protocol_id: Mapped[str] = mapped_column(String(100))
    consent_record_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    sample_count: Mapped[int] = mapped_column(Integer)
    payload: Mapped[Any] = mapped_column(EncryptedJSON)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


SYNCED_MODELS: dict[str, type[SyncedMixin]] = {
    "drinking_session": DrinkingSessionRecord,
    "drink_event": DrinkEventRecord,
    "recovery_checkin": RecoveryCheckinRecord,
    "intervention_event": InterventionEventRecord,
    "consent_record": ConsentRecordRow,
    "user_goals": UserGoalsRecord,
    "user_preferences": UserPreferencesRecord,
}
