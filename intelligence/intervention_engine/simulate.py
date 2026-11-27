"""Offline notification-burden simulation for research on prompt fatigue.

Replays recorded drink logs through a simplified pace rule set (mirroring packages/core) under each
frequency preference and counts how many prompts would be delivered. Used to tune policy against
real (consented) logs without exposing anyone to extra notifications.
"""

from __future__ import annotations

from typing import Any

from ..consumption_engine.pace import PaceEvent, pace_snapshot

MINUTE_MS = 60_000
GAPS = {"minimal": 30 * MINUTE_MS, "standard": 15 * MINUTE_MS, "frequent": 10 * MINUTE_MS}
CAPS = {"minimal": 4, "standard": 8, "frequent": 12}


def simulate_prompts(events: list[PaceEvent], frequency: str = "standard", session_goal: float | None = None) -> dict[str, Any]:
    if frequency not in GAPS:
        raise ValueError(f"unknown frequency {frequency!r}")
    seen: set[str] = set()
    delivered: list[dict[str, Any]] = []
    for e in sorted(events, key=lambda x: x.consumed_at):
        now = e.consumed_at
        snap = pace_snapshot([x for x in events if x.consumed_at <= now], now)
        candidates: list[tuple[int, str]] = []
        if snap["rapidConsumption"]:
            candidates.append((1, f"pace:rapid:{snap['totalDrinks']}"))
        if session_goal is not None and snap["totalStandardDrinks"] + 1e-9 >= session_goal:
            candidates.append((1, "goal:session:reached"))
        for priority, key in sorted(candidates):
            if key in seen or len(delivered) >= CAPS[frequency]:
                continue
            is_goal = key.startswith("goal:")
            if not is_goal and delivered and now - delivered[-1]["at"] < GAPS[frequency]:
                continue
            seen.add(key)
            delivered.append({"at": now, "key": key, "priority": priority})
            break
    return {"frequency": frequency, "delivered": delivered, "count": len(delivered)}
