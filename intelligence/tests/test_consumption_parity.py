"""Cross-language parity: Python ports must reproduce the shared TypeScript/Swift vectors."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from threshold_intelligence.consumption_engine import REGION_GRAMS, PaceEvent, measure_drink, pace_snapshot
from threshold_intelligence.consumption_engine.alcohol import MeasurementError

VECTORS = Path(__file__).resolve().parents[2] / "packages" / "core" / "test-vectors"
ALCOHOL = json.loads((VECTORS / "alcohol.json").read_text())
PACE = json.loads((VECTORS / "pace.json").read_text())


def test_region_definitions_match_vectors() -> None:
    assert ALCOHOL["regionGrams"] == REGION_GRAMS


@pytest.mark.parametrize("case", ALCOHOL["valid"], ids=lambda c: c["name"])
def test_alcohol_valid(case: dict) -> None:
    i, x = case["input"], case["expected"]
    m = measure_drink(i["serving"]["value"], i["serving"]["unit"], i["abvPercent"], i["fractionConsumed"], REGION_GRAMS[i["region"]])
    assert m.serving_ml == pytest.approx(x["servingMl"], abs=1e-9)
    assert m.ethanol_grams == pytest.approx(x["ethanolGrams"], abs=1e-9)
    assert m.standard_drinks == pytest.approx(x["standardDrinks"], abs=1e-9)


@pytest.mark.parametrize("case", ALCOHOL["invalid"], ids=lambda c: c["name"])
def test_alcohol_invalid(case: dict) -> None:
    i = case["input"]
    with pytest.raises(MeasurementError) as err:
        measure_drink(i["serving"]["value"], i["serving"]["unit"], i["abvPercent"], i["fractionConsumed"], 14)
    assert err.value.code == case["expectedErrorCode"]


def test_unknown_abv_is_not_assumed() -> None:
    m = measure_drink(6, "fl_oz_us", None, 1, 14)
    assert m.ethanol_grams is None and m.standard_drinks is None


@pytest.mark.parametrize("case", PACE["cases"], ids=lambda c: c["name"])
def test_pace_vectors(case: dict) -> None:
    events = [PaceEvent(e["id"], e["consumedAt"], e["standardDrinks"], e["revision"], e["updatedAt"], e["counts"]) for e in case["events"]]
    s = pace_snapshot(events, case["now"])
    x = case["expected"]
    for key in (
        "totalDrinks",
        "totalUnknownStrength",
        "timeSinceLastDrinkMs",
        "maxDrinksInAny30Min",
        "clusterCount",
        "rapidReasons",
        "concentrated",
        "clockSkewDetected",
    ):
        assert s[key] == x[key], key
    assert s["totalStandardDrinks"] == pytest.approx(x["totalStandardDrinks"])
    assert s["maxStandardDrinksInAny60Min"] == pytest.approx(x["maxStandardDrinksInAny60Min"])
    for w in ("15", "30", "60", "120"):
        assert s["windows"][w]["drinkCount"] == x["windows"][w]["drinkCount"]
        assert s["windows"][w]["standardDrinks"] == pytest.approx(x["windows"][w]["standardDrinks"])
