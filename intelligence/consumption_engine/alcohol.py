from __future__ import annotations

import math
from dataclasses import dataclass

ETHANOL_DENSITY = 0.789  # g/mL at 20 °C
ML_PER_UNIT = {"ml": 1.0, "cl": 10.0, "l": 1000.0, "fl_oz_us": 29.5735295625, "fl_oz_imp": 28.4130625}
REGION_GRAMS = {"US": 14.0, "UK": 8.0, "AU": 10.0, "NZ": 10.0, "CA": 13.45, "IE": 10.0, "AT": 20.0}
MAX_SERVING_ML = 5000.0


class MeasurementError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class DrinkMeasurement:
    serving_ml: float
    consumed_ml: float
    ethanol_grams: float | None
    standard_drinks: float | None
    standard_drink_grams: float


def ethanol_grams(volume_ml: float, abv_percent: float) -> float:
    """ethanol_grams = volume_ml × abv/100 × 0.789"""
    if not math.isfinite(volume_ml) or volume_ml < 0:
        raise MeasurementError("invalid_volume", "volume must be finite and >= 0")
    if not math.isfinite(abv_percent) or not 0 <= abv_percent <= 100:
        raise MeasurementError("invalid_abv", "abv must be within [0, 100]")
    return volume_ml * (abv_percent / 100) * ETHANOL_DENSITY


def standard_drinks(grams: float, grams_per_standard_drink: float) -> float:
    if grams_per_standard_drink <= 0:
        raise MeasurementError("invalid_definition", "grams per standard drink must be > 0")
    return grams / grams_per_standard_drink


def measure_drink(
    value: float, unit: str, abv_percent: float | None, fraction_consumed: float, grams_per_standard_drink: float
) -> DrinkMeasurement:
    """Deterministic measurement; unknown ABV yields None rather than an assumed value."""
    if unit not in ML_PER_UNIT:
        raise MeasurementError("invalid_unit", f"unsupported unit {unit!r}")
    if not math.isfinite(value) or value <= 0:
        raise MeasurementError("invalid_volume", "serving volume must be > 0")
    if not math.isfinite(fraction_consumed) or not 0 < fraction_consumed <= 1:
        raise MeasurementError("invalid_fraction", "fraction consumed must be in (0, 1]")
    if abv_percent is not None and (not math.isfinite(abv_percent) or not 0 <= abv_percent <= 100):
        raise MeasurementError("invalid_abv", "abv must be within [0, 100]")
    serving_ml = value * ML_PER_UNIT[unit]
    if serving_ml > MAX_SERVING_ML:
        raise MeasurementError("implausible_volume", "serving too large")
    consumed = serving_ml * fraction_consumed
    if abv_percent is None:
        return DrinkMeasurement(serving_ml, consumed, None, None, grams_per_standard_drink)
    grams = ethanol_grams(consumed, abv_percent)
    return DrinkMeasurement(serving_ml, consumed, grams, standard_drinks(grams, grams_per_standard_drink), grams_per_standard_drink)
