"""Python port of packages/core/src/baselines.ts robust statistics (kept numerically identical)."""

from __future__ import annotations

import math
from collections.abc import Sequence


def _finite(xs: Sequence[float]) -> list[float]:
    return sorted(x for x in xs if math.isfinite(x))


def median(xs: Sequence[float]) -> float | None:
    v = _finite(xs)
    if not v:
        return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


def mad(xs: Sequence[float]) -> float | None:
    m = median(xs)
    return None if m is None else median([abs(x - m) for x in xs if math.isfinite(x)])


def robust_z(x: float, med: float | None, mad_value: float | None) -> float | None:
    """robust_z = 0.6745 × (x − median) / MAD; None when undefined (no spread / no data)."""
    if med is None or mad_value is None or not math.isfinite(x) or mad_value <= 1e-12:
        return None
    return 0.6745 * (x - med) / mad_value


def percentile(xs: Sequence[float], p: float) -> float | None:
    v = _finite(xs)
    if not v:
        return None
    if p <= 0:
        return v[0]
    if p >= 100:
        return v[-1]
    rank = p / 100 * (len(v) - 1)
    lo, hi = math.floor(rank), math.ceil(rank)
    return v[lo] + (v[hi] - v[lo]) * (rank - lo)


def ewma(xs: Sequence[float], alpha: float) -> float | None:
    """EWMA_t = α·x_t + (1 − α)·EWMA_{t−1}"""
    if not 0 < alpha <= 1:
        raise ValueError("alpha must be in (0, 1]")
    s: float | None = None
    for x in xs:
        if math.isfinite(x):
            s = x if s is None else alpha * x + (1 - alpha) * s
    return s


def maturity(samples: int, days: int, developing: tuple[int, int] = (5, 5), established: tuple[int, int] = (14, 14)) -> str:
    if samples >= established[0] and days >= established[1]:
        return "established"
    if samples >= developing[0] and days >= developing[1]:
        return "developing"
    return "insufficient"
