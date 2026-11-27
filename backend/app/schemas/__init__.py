"""Pydantic schemas. Wire format is camelCase to match the mobile app (packages/validation)."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from pydantic.alias_generators import to_camel

ETHANOL_DENSITY = 0.789
EPOCH_MAX = 8_640_000_000_000_000


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


Ms = Field(ge=0, le=EPOCH_MAX)
Score = Field(default=None, ge=0, le=10)

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class Credentials(CamelModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    device_id: str = Field(min_length=1, max_length=100)


class RefreshRequest(CamelModel):
    refresh_token: str = Field(min_length=20, max_length=200)
    device_id: str | None = Field(default=None, max_length=100)


class TokenResponse(CamelModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int


class DeleteAccountRequest(CamelModel):
    password: str = Field(min_length=1, max_length=128)


# ---------------------------------------------------------------------------
# Entity payloads (validated before storage; unknown fields are dropped)
# ---------------------------------------------------------------------------


class Versioned(CamelModel):
    revision: int = Field(ge=1)
    updated_at: int = Ms
    device_id: str = Field(min_length=1, max_length=100)


class Pause(CamelModel):
    started_at: int = Ms
    ended_at: int | None = Field(default=None, ge=0, le=EPOCH_MAX)


class Snapshot(CamelModel):
    value: float
    unit: str = Field(max_length=20)
    measured_at: int = Ms
    source: str = Field(max_length=100)


class StartContext(CamelModel):
    resting_heart_rate_bpm: Snapshot | None = None
    hrv_sdnn_ms: Snapshot | None = None
    last_night_sleep_minutes: Snapshot | None = None
    health_data_authorized: bool = False


class GoalSnapshot(CamelModel):
    max_standard_drinks_per_session: float | None = Field(default=None, ge=0, le=30)
    pace_goal_minutes_between_drinks: float | None = Field(default=None, ge=15, le=240)


class DrinkingSessionPayload(Versioned):
    id: uuid.UUID
    status: Literal["active", "paused", "ended"]
    started_at: int = Ms
    ended_at: int | None = Field(default=None, ge=0, le=EPOCH_MAX)
    tz_offset_min: int = Field(ge=-840, le=840)
    pauses: list[Pause] = Field(default_factory=list, max_length=200)
    start_context: StartContext
    goal_snapshot: GoalSnapshot
    origin: Literal["phone", "watch", "auto_prompt"]
    deleted_at: int | None = Field(default=None, ge=0, le=EPOCH_MAX)


class VolumeInput(CamelModel):
    value: float = Field(gt=0)
    unit: Literal["ml", "cl", "l", "fl_oz_us", "fl_oz_imp"]


class Uncertainty(CamelModel):
    abv_known: bool
    volume_known: bool
    standard_drinks_low: float | None = Field(default=None, ge=0)
    standard_drinks_high: float | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)


class DrinkEventPayload(Versioned):
    id: uuid.UUID
    session_id: uuid.UUID
    beverage_id: uuid.UUID | None = None
    beverage_name: str = Field(min_length=1, max_length=120)
    category: Literal["beer", "wine", "spirits", "cocktail", "hard_seltzer", "cider", "mixed_drink", "nonalcoholic", "water", "custom"]
    serving_input: VolumeInput
    serving_ml: float = Field(gt=0, le=5000)
    fraction_consumed: float = Field(gt=0, le=1)
    abv_percent: float | None = Field(default=None, ge=0, le=100)
    ethanol_grams: float | None = Field(default=None, ge=0)
    standard_drinks: float | None = Field(default=None, ge=0)
    standard_drink_grams: float = Field(gt=0, le=30)
    is_alcoholic: bool
    consumed_at: int = Ms
    logged_at: int = Ms
    tz_offset_min: int = Field(ge=-840, le=840)
    source: Literal["manual", "quick_log", "watch", "label_scan", "gesture_assisted", "imported"]
    confirmation: Literal["user_confirmed", "estimated", "detected_unconfirmed"]
    uncertainty: Uncertainty
    deleted_at: int | None = Field(default=None, ge=0, le=EPOCH_MAX)

    @model_validator(mode="after")
    def check_alcohol_math(self) -> DrinkEventPayload:
        """Server-side integrity check of the deterministic alcohol math (no silent fixes)."""
        if self.ethanol_grams is not None and self.standard_drinks is None:
            raise ValueError("standardDrinks is required when ethanolGrams is known")
        if self.ethanol_grams is not None and self.standard_drinks is not None:
            expected_std = self.ethanol_grams / self.standard_drink_grams
            if abs(expected_std - self.standard_drinks) > 1e-6 * max(1.0, expected_std):
                raise ValueError("standardDrinks is inconsistent with ethanolGrams")
        if self.abv_percent is not None and self.ethanol_grams is not None:
            expected = self.serving_ml * self.fraction_consumed * (self.abv_percent / 100) * ETHANOL_DENSITY
            if abs(expected - self.ethanol_grams) > 1e-6 * max(1.0, expected):
                raise ValueError("ethanolGrams is inconsistent with volume and ABV")
        return self


class RecoveryCheckinPayload(CamelModel):
    id: uuid.UUID
    session_id: uuid.UUID | None = None
    local_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    completed_at: int = Ms
    headache: int | None = Score
    fatigue: int | None = Score
    nausea: int | None = Score
    dizziness: int | None = Score
    sleep_quality: int | None = Score
    mental_clarity: int | None = Score
    overall_severity: int | None = Score
    functional_impairment: int | None = Score
    ate_before_drinking: bool | None = None
    hydration_reported: Literal["none", "some", "regular"] | None = None
    revision: int = Field(ge=1)
    updated_at: int = Ms
    deleted_at: int | None = Field(default=None, ge=0, le=EPOCH_MAX)


class InterventionEventPayload(CamelModel):
    id: uuid.UUID
    session_id: uuid.UUID
    category: Literal["consumption_pace", "personal_goal", "nonalcoholic_alternative", "physiological_change", "recovery_awareness", "session_closure"]
    message_key: str = Field(max_length=60)
    title: str = Field(max_length=120)
    body: str = Field(max_length=500)
    priority: int = Field(ge=1, le=3)
    dedupe_key: str = Field(max_length=120)
    triggered_at: int = Ms
    delivered: bool
    suppressed_reason: str | None = Field(default=None, max_length=60)
    acknowledged_at: int | None = None
    dismissed: bool = False


ConsentType = Literal[
    "health_alcohol_data_processing", "healthkit", "motion", "notifications", "cloud_sync", "research_upload", "research_recording", "crash_reporting", "automatic_detection"
]


class ConsentPayload(CamelModel):
    id: uuid.UUID
    type: ConsentType
    granted: bool
    version: str = Field(min_length=1, max_length=20)
    recorded_at: int = Ms


class GoalsPayload(CamelModel):
    objectives: list[str] = Field(default_factory=list, max_length=10)
    max_standard_drinks_per_session: float | None = Field(default=None, ge=0, le=30)
    max_standard_drinks_per_week: float | None = Field(default=None, ge=0, le=100)
    alcohol_free_days_per_week: int | None = Field(default=None, ge=0, le=7)
    pace_goal_minutes_between_drinks: int | None = Field(default=None, ge=15, le=240)
    updated_at: int = Ms


class PreferencesPayload(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")
    updated_at: int = Ms


PAYLOAD_MODELS: dict[str, type[CamelModel]] = {
    "drinking_session": DrinkingSessionPayload,
    "drink_event": DrinkEventPayload,
    "recovery_checkin": RecoveryCheckinPayload,
    "intervention_event": InterventionEventPayload,
    "consent_record": ConsentPayload,
    "user_goals": GoalsPayload,
    "user_preferences": PreferencesPayload,
}

EntityType = Literal["drinking_session", "drink_event", "recovery_checkin", "intervention_event", "consent_record", "user_goals", "user_preferences"]

# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


class SyncEnvelopeIn(CamelModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    entity_type: EntityType
    entity_id: uuid.UUID
    op: Literal["upsert", "delete"]
    revision: int = Field(ge=1)
    client_updated_at: int = Ms
    device_id: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any] | None = None


class SyncPushRequest(CamelModel):
    device_id: str = Field(min_length=1, max_length=100)
    envelopes: list[dict[str, Any]] = Field(max_length=2000)


AckStatus = Literal["applied", "duplicate", "stale", "rejected", "deferred"]


class SyncAck(CamelModel):
    idempotency_key: str
    status: AckStatus
    server_revision: int
    reason: str | None = None


class SyncPushResponse(CamelModel):
    acks: list[SyncAck]


class SyncChange(CamelModel):
    seq: int
    entity_type: str
    entity_id: uuid.UUID
    revision: int
    client_updated_at: int
    device_id: str
    deleted: bool
    payload: dict[str, Any] | None


class SyncPullResponse(CamelModel):
    changes: list[SyncChange]
    next_cursor: int
    has_more: bool


class ModelVersionOut(CamelModel):
    model_id: str
    version: str
    task: str
    status: Literal["experimental", "validated", "retired"]
