from __future__ import annotations

import bisect
from dataclasses import dataclass
from typing import Any

MINUTE_MS = 60_000
WINDOWS = (15, 30, 60, 120)
THRESHOLDS = {"rapid30": 2.0, "rapid60": 3.0, "count30": 3, "conc120": 4.0, "gap": 20.0, "skew": 5 * MINUTE_MS}
EPS = 1e-9


@dataclass(frozen=True)
class PaceEvent:
    id: str
    consumed_at: int
    standard_drinks: float | None
    revision: int
    updated_at: int
    counts: bool


def _latest(events: list[PaceEvent]) -> list[PaceEvent]:
    by_id: dict[str, PaceEvent] = {}
    for e in events:
        cur = by_id.get(e.id)
        if cur is None or e.revision > cur.revision or (e.revision == cur.revision and e.updated_at > cur.updated_at):
            by_id[e.id] = e
    return sorted((e for e in by_id.values() if e.counts), key=lambda e: (e.consumed_at, e.id))


def pace_snapshot(events: list[PaceEvent], now: int) -> dict[str, Any]:
    """Port of PaceTracker.snapshot (packages/core/src/pace.ts) for offline feature generation."""
    counted = _latest(events)
    times = [e.consumed_at for e in counted]
    std_prefix = [0.0]
    for e in counted:
        std_prefix.append(std_prefix[-1] + (e.standard_drinks or 0.0))
    horizon = now + int(THRESHOLDS["skew"])
    visible_end = bisect.bisect_right(times, horizon)
    visible = counted[:visible_end]

    def window(w: int) -> dict[str, Any]:
        i = bisect.bisect_right(times, now - w * MINUTE_MS)
        j = bisect.bisect_right(times, horizon)
        es = counted[i:j]
        return {
            "drinkCount": len(es),
            "standardDrinks": sum(e.standard_drinks or 0.0 for e in es),
            "unknownStrengthCount": sum(1 for e in es if e.standard_drinks is None),
        }

    windows = {str(w): window(w) for w in WINDOWS}
    intervals = [visible[k].consumed_at - visible[k - 1].consumed_at for k in range(1, len(visible))]
    max30, max60 = 0, 0.0
    i30 = i60 = 0
    for j, e in enumerate(visible):
        while visible[i30].consumed_at <= e.consumed_at - 30 * MINUTE_MS:
            i30 += 1
        while visible[i60].consumed_at <= e.consumed_at - 60 * MINUTE_MS:
            i60 += 1
        max30 = max(max30, j - i30 + 1)
        max60 = max(max60, std_prefix[j + 1] - std_prefix[i60])
    clusters, last = 0, None
    for e in visible:
        if last is None or e.consumed_at - last > THRESHOLDS["gap"] * MINUTE_MS:
            clusters += 1
        last = e.consumed_at
    reasons = []
    if windows["30"]["standardDrinks"] + EPS >= THRESHOLDS["rapid30"]:
        reasons.append("std_30")
    if windows["60"]["standardDrinks"] + EPS >= THRESHOLDS["rapid60"]:
        reasons.append("std_60")
    if windows["30"]["drinkCount"] >= THRESHOLDS["count30"]:
        reasons.append("count_30")
    return {
        "totalDrinks": len(counted),
        "totalUnknownStrength": sum(1 for e in counted if e.standard_drinks is None),
        "totalStandardDrinks": std_prefix[-1],
        "windows": windows,
        "timeSinceLastDrinkMs": max(0, now - visible[-1].consumed_at) if visible else None,
        "meanIntervalMs": sum(intervals) / len(intervals) if intervals else None,
        "maxDrinksInAny30Min": max30,
        "maxStandardDrinksInAny60Min": max60,
        "clusterCount": clusters,
        "rapidConsumption": bool(reasons),
        "rapidReasons": reasons,
        "concentrated": windows["120"]["standardDrinks"] + EPS >= THRESHOLDS["conc120"],
        "clockSkewDetected": visible_end < len(counted),
    }
