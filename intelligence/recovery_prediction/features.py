"""Session feature specification ``sf-v1`` (Python twin of packages/core/src/sessionFeatures.ts).

Features describe an evening as known the next morning BEFORE the recovery check-in, so no
check-in answer is ever an input. Unknown values are ``None``; nothing is imputed here.
Parity with TypeScript is enforced by packages/core/test-vectors/session_features.json.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

SESSION_FEATURE_VERSION = "sf-v1"
SESSION_FEATURE_NAMES: tuple[str, ...] = (
    "n_drinks",
    "n_unknown_strength",
    "unknown_fraction",
    "std_drinks_known",
    "n_non_alcoholic",
    "duration_min",
    "drinking_span_min",
    "mean_gap_min",
    "peak_std_30min",
    "peak_std_60min",
    "max_drinks_30min",
    "start_local_hour",
    "last_drink_local_hour",
    "weekend_night",
    "spirits_share",
    "prior_7d_std_drinks",
    "prior_7d_sessions",
    "days_since_previous_session",
    "sleep_asleep_min",
    "sleep_efficiency",
    "sleep_interruptions",
    "sleep_onset_after_last_drink_min",
    "resting_hr_delta_bpm",
    "hrv_robust_z",
)
FEATURE_GROUPS = ("drinks", "strength", "history", "sleep", "physiology")

MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS
SPIRIT_LIKE = frozenset({"spirits", "cocktail", "mixed_drink"})

Drink = Mapping[str, Any]


def _r6(x: float) -> float:
    """Round half up to 6 decimals, matching JavaScript's Math.round(x * 1e6) / 1e6."""
    v = math.floor(x * 1e6 + 0.5) / 1e6
    return 0.0 if v == 0 else v


def _counts(d: Drink) -> bool:
    return d.get("deletedAt") is None and bool(d.get("isAlcoholic")) and d.get("confirmation") != "detected_unconfirmed"


def _local_hour(at: int, tz: int) -> float:
    return ((at + tz * MINUTE_MS) % DAY_MS) / HOUR_MS


def _local_midnight(at: int, tz: int) -> int:
    local = at + tz * MINUTE_MS
    return local - (local % DAY_MS)


def _weekday_of_night(at: int, tz: int, boundary_hour: int = 6) -> int:
    """0 = Monday … 6 = Sunday for the local date with a 06:00 day boundary."""
    shifted = at + tz * MINUTE_MS - boundary_hour * HOUR_MS
    return datetime.fromtimestamp(shifted / 1000, tz=UTC).weekday()


def _peak(times: Sequence[int], weights: Sequence[float], window_ms: int) -> float:
    best, lo, total = 0.0, 0, 0.0
    for i, t in enumerate(times):
        total += weights[i]
        while times[lo] <= t - window_ms:
            total -= weights[lo]
            lo += 1
        best = max(best, total)
    return best


def build_session_features(inp: Mapping[str, Any]) -> dict[str, Any]:
    session = inp["session"]
    tz = int(session["tzOffsetMin"])
    start = int(session["startedAt"])
    alcoholic = sorted((d for d in inp.get("drinks", []) if _counts(d)), key=lambda d: d["consumedAt"])
    times = [int(d["consumedAt"]) for d in alcoholic]
    n = len(alcoholic)
    n_unknown = sum(1 for d in alcoholic if d.get("standardDrinks") is None)
    known = [float(d["standardDrinks"]) if d.get("standardDrinks") is not None else 0.0 for d in alcoholic]
    std_known = 0.0
    for k in known:
        std_known += k
    first = times[0] if times else None
    last = times[-1] if times else None
    span = (last - first) / MINUTE_MS if first is not None and last is not None else None
    end = session.get("endedAt") if session.get("endedAt") is not None else last

    spirit_std = 0.0
    for d, k in zip(alcoholic, known, strict=True):
        spirit_std += k if d.get("category") in SPIRIT_LIKE else 0.0

    prior_drinks = inp.get("priorDrinks")
    prior_starts = inp.get("priorSessionStarts")
    has_history = prior_drinks is not None and prior_starts is not None
    week_ago = start - 7 * DAY_MS
    prior7_std = prior7_sessions = days_since_prev = None
    if has_history:
        window = sorted(
            (d for d in prior_drinks if _counts(d) and week_ago <= d["consumedAt"] < start),  # type: ignore[union-attr]
            key=lambda d: d["consumedAt"],
        )
        prior7_std = 0.0
        for d in window:
            prior7_std += float(d["standardDrinks"]) if d.get("standardDrinks") is not None else 0.0
        earlier = [int(t) for t in prior_starts if t < start]  # type: ignore[union-attr]
        prior7_sessions = sum(1 for t in earlier if t >= week_ago)
        days_since_prev = (start - max(earlier)) / DAY_MS if earlier else None

    sleep = inp.get("sleep")
    rhr = inp.get("restingHrDeltaBpm")
    hrv = inp.get("hrvRobustZ")
    night = _weekday_of_night(start, tz)

    raw: dict[str, float | None] = {
        "n_drinks": n,
        "n_unknown_strength": n_unknown,
        "unknown_fraction": n_unknown / n if n else None,
        "std_drinks_known": std_known,
        "n_non_alcoholic": sum(1 for d in inp.get("drinks", []) if d.get("deletedAt") is None and not d.get("isAlcoholic")),
        "duration_min": max(0, end - start) / MINUTE_MS if end is not None else None,
        "drinking_span_min": span,
        "mean_gap_min": span / (n - 1) if span is not None and n >= 2 else None,
        "peak_std_30min": _peak(times, known, 30 * MINUTE_MS),
        "peak_std_60min": _peak(times, known, 60 * MINUTE_MS),
        "max_drinks_30min": _peak(times, [1.0] * n, 30 * MINUTE_MS),
        "start_local_hour": _local_hour(start, tz),
        "last_drink_local_hour": (last + tz * MINUTE_MS - _local_midnight(start, tz)) / HOUR_MS if last is not None else None,
        "weekend_night": 1 if night in (4, 5) else 0,
        "spirits_share": spirit_std / std_known if std_known > 0 else None,
        "prior_7d_std_drinks": prior7_std,
        "prior_7d_sessions": prior7_sessions,
        "days_since_previous_session": days_since_prev,
        "sleep_asleep_min": sleep["asleepMinutes"] if sleep else None,
        "sleep_efficiency": min(1.0, sleep["asleepMinutes"] / sleep["inBedMinutes"]) if sleep and sleep["inBedMinutes"] > 0 else None,
        "sleep_interruptions": sleep["interruptions"] if sleep else None,
        "sleep_onset_after_last_drink_min": (sleep["sleepStart"] - last) / MINUTE_MS
        if sleep and sleep.get("sleepStart") is not None and last is not None
        else None,
        "resting_hr_delta_bpm": rhr,
        "hrv_robust_z": hrv,
    }
    values = {k: (None if raw[k] is None else _r6(float(raw[k]))) for k in SESSION_FEATURE_NAMES}  # type: ignore[arg-type]
    availability = {
        "drinks": n > 0,
        "strength": n_unknown == 0,
        "history": has_history,
        "sleep": sleep is not None,
        "physiology": rhr is not None or hrv is not None,
    }
    strength_known = 1 - n_unknown / n if n else 1.0
    quality = _r6((strength_known + float(has_history) + float(sleep is not None) + float(availability["physiology"])) / 4)
    return {
        "version": SESSION_FEATURE_VERSION,
        "values": values,
        "availability": availability,
        "dataQuality": quality,
        "inputQuality": "high" if quality >= 0.75 else "medium" if quality >= 0.5 else "low",
    }


def feature_matrix(rows: Iterable[Mapping[str, Any]]) -> list[list[float]]:
    """Feature dicts → rows of floats with NaN for missing values (models handle NaN explicitly)."""
    return [[math.nan if r["values"][k] is None else float(r["values"][k]) for k in SESSION_FEATURE_NAMES] for r in rows]


# ---------------------------------------------------------------------------
# Input assembly — same rules as nightAfterSession / overnightPhysiology in TypeScript
# ---------------------------------------------------------------------------

SLEEP_SEARCH_MS = 18 * HOUR_MS
MATURITY_DEVELOPING = {"resting_heart_rate": (5, 5), "hrv_sdnn": (10, 5)}  # (samples, distinct days)
BASELINE_WINDOW_DAYS = 28


def _median(values: Sequence[float]) -> float | None:
    xs = sorted(v for v in values if math.isfinite(v))
    if not xs:
        return None
    mid = len(xs) // 2
    return xs[mid] if len(xs) % 2 else (xs[mid - 1] + xs[mid]) / 2


def _local_date(at: int, tz: int) -> str:
    return datetime.fromtimestamp((at + tz * MINUTE_MS) / 1000, tz=UTC).strftime("%Y-%m-%d")


def night_after_session(
    nights: Sequence[Mapping[str, Any]], session: Mapping[str, Any], last_drink_at: int | None
) -> Mapping[str, Any] | None:
    start = int(session["startedAt"])
    lo = last_drink_at if last_drink_at is not None else start
    end = session.get("endedAt")
    hi = (end if end is not None else last_drink_at if last_drink_at is not None else start) + SLEEP_SEARCH_MS
    best: Mapping[str, Any] | None = None
    for n in nights:
        s = n.get("sleepStart")
        if s is None or s < lo or s > hi:
            continue
        if best is None or s < best["sleepStart"]:
            best = n
    return best


def _baseline(samples: Sequence[Mapping[str, Any]], before: int, kind: str) -> tuple[float | None, float | None] | None:
    need_samples, need_days = MATURITY_DEVELOPING[kind]
    lo = before - BASELINE_WINDOW_DAYS * DAY_MS
    usable = [s for s in samples if math.isfinite(s["value"]) and lo <= s["at"] < before]
    days = {_local_date(int(s["at"]), int(s["tzOffsetMin"])) for s in usable}
    if len(usable) < need_samples or len(days) < need_days:
        return None
    values = [float(s["value"]) for s in usable]
    med = _median(values)
    mad = _median([abs(v - med) for v in values]) if med is not None else None
    return med, mad


def overnight_physiology(
    session_started_at: int,
    sleep: Mapping[str, Any] | None,
    resting_hr: Sequence[Mapping[str, Any]],
    hrv: Sequence[Mapping[str, Any]],
) -> dict[str, float | None]:
    out: dict[str, float | None] = {"restingHrDeltaBpm": None, "hrvRobustZ": None}
    if not sleep or sleep.get("sleepStart") is None or sleep.get("sleepEnd") is None:
        return out
    s0, s1 = int(sleep["sleepStart"]), int(sleep["sleepEnd"])
    base = _baseline(resting_hr, session_started_at, "resting_heart_rate")
    night_rhr = sorted((s for s in resting_hr if s0 <= s["at"] <= s1 + 12 * HOUR_MS), key=lambda s: s["at"])
    if base and base[0] is not None and night_rhr:
        out["restingHrDeltaBpm"] = _r6(float(night_rhr[0]["value"]) - base[0])
    hbase = _baseline(hrv, session_started_at, "hrv_sdnn")
    night = _median([float(s["value"]) for s in hrv if s0 <= s["at"] <= s1])
    if hbase and night is not None and hbase[0] is not None and hbase[1] is not None and hbase[1] > 1e-12:
        out["hrvRobustZ"] = _r6(0.6745 * (night - hbase[0]) / hbase[1])
    return out


def summarize_sleep(samples: Sequence[Mapping[str, Any]], tz: int) -> list[dict[str, Any]]:
    """Port of summarizeSleep (packages/core/src/baselines.ts): merge overlapping intervals per stage."""
    by_night: dict[str, list[Mapping[str, Any]]] = {}
    for s in samples:
        if s["kind"] not in ("sleep_asleep", "sleep_in_bed", "sleep_awake") or s["endAt"] <= s["startAt"]:
            continue
        by_night.setdefault(_local_date(int(s["endAt"]) + 6 * HOUR_MS, tz), []).append(s)

    def union_minutes(iv: Iterable[Mapping[str, Any]]) -> float:
        total, cur_s, cur_e = 0.0, -math.inf, -math.inf
        for x in sorted(iv, key=lambda x: x["startAt"]):
            if x["startAt"] > cur_e:
                if cur_e > cur_s:
                    total += cur_e - cur_s
                cur_s, cur_e = x["startAt"], x["endAt"]
            else:
                cur_e = max(cur_e, x["endAt"])
        if cur_e > cur_s:
            total += cur_e - cur_s
        return total / MINUTE_MS

    out = []
    for night, items in by_night.items():
        asleep = [s for s in items if s["kind"] == "sleep_asleep"]
        awake = [s for s in items if s["kind"] == "sleep_awake"]
        start = min((s["startAt"] for s in asleep), default=None)
        end = max((s["endAt"] for s in asleep), default=None)
        interruptions = 0 if start is None or end is None else sum(1 for w in awake if w["startAt"] > start and w["endAt"] < end)
        out.append(
            {
                "night": night,
                "asleepMinutes": union_minutes(asleep),
                "inBedMinutes": union_minutes(s for s in items if s["kind"] == "sleep_in_bed"),
                "awakeMinutes": union_minutes(awake),
                "interruptions": interruptions,
                "sleepStart": start,
                "sleepEnd": end,
            }
        )
    return sorted(out, key=lambda n: n["night"])
