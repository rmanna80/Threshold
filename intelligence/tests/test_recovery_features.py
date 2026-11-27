"""Parity with packages/core/test-vectors/session_features.json (TypeScript implementation)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from threshold_intelligence.recovery_prediction.features import (
    SESSION_FEATURE_NAMES,
    build_session_features,
    night_after_session,
    overnight_physiology,
)

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "packages" / "core" / "test-vectors" / "session_features.json").read_text())


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_matches_typescript_exactly(case: dict) -> None:  # type: ignore[type-arg]
    got = build_session_features(case["input"])
    assert got == case["expected"]


def test_feature_names_match() -> None:
    assert list(VECTORS["cases"][0]["expected"]["values"].keys()) == list(SESSION_FEATURE_NAMES)


@pytest.mark.parametrize("case", VECTORS["assembly"]["nightAfterSession"], ids=lambda c: c["name"])
def test_night_after_session(case: dict) -> None:  # type: ignore[type-arg]
    n = night_after_session(case["nights"], case["session"], case["lastDrinkAt"])
    assert (n["name"] if n else None) == case["expectedName"]


@pytest.mark.parametrize("case", VECTORS["assembly"]["overnightPhysiology"], ids=lambda c: c["name"])
def test_overnight_physiology(case: dict) -> None:  # type: ignore[type-arg]
    got = overnight_physiology(case["sessionStartedAt"], case["sleep"], case["restingHr"], case["hrv"])
    assert got == case["expected"]
