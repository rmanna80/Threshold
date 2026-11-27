"""SYNTHETIC recovery data for exercising pipeline mechanics in tests ONLY.

Outcomes are generated from an arbitrary made-up formula with participant random intercepts and
injected missingness. Nothing here describes how alcohol affects real people, the generated
relationships must never be cited, and any report built from it is marked synthetic and can
never pass validation (evaluation/validation.py).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from ..datasets.synthetic import SYNTHETIC_MARKER
from .dataset import RecoveryDataset, dataset_from_rows
from .features import build_session_features

MIN = 60_000
HOUR = 60 * MIN
DAY = 24 * HOUR
T0 = 1_735_689_600_000  # 2025-01-01T00:00Z, arbitrary


def synthetic_recovery_dataset(
    participants: int = 30, sessions_per: int = 20, seed: int = 0, missing_checkin_rate: float = 0.2
) -> RecoveryDataset:
    rng = np.random.default_rng(seed)
    rows: list[dict[str, Any]] = []
    for p in range(participants):
        pid = f"{SYNTHETIC_MARKER}-R{p:03d}"
        intercept = rng.normal(0, 1.0)
        has_watch = rng.random() < 0.6
        tz = int(rng.choice([-300, -360, 0, 60]))
        starts: list[int] = []
        all_drinks: list[dict[str, Any]] = []
        day = 0
        for k in range(sessions_per):
            day += int(rng.integers(2, 9))
            start = T0 + day * DAY + (20 - tz // 60) * HOUR + int(rng.integers(-90, 90)) * MIN
            n = int(rng.poisson(3.5))
            gaps = rng.exponential(35, size=n).cumsum()
            drinks = [
                {
                    "consumedAt": int(start + g * MIN),
                    "standardDrinks": None if rng.random() < 0.08 else round(float(rng.uniform(0.7, 1.8)), 2),
                    "isAlcoholic": True,
                    "category": str(rng.choice(["beer", "wine", "spirits", "cocktail"])),
                    "confirmation": "user_confirmed",
                    "deletedAt": None,
                }
                for g in gaps
            ]
            last = int(start + gaps[-1] * MIN) if n else start
            end = int(last + rng.integers(10, 60) * MIN)
            sleep = None
            if has_watch and rng.random() < 0.85:
                onset = int(end + rng.integers(15, 120) * MIN)
                asleep = float(rng.normal(410, 50) - 12 * n)
                sleep = {
                    "asleepMinutes": max(120.0, asleep),
                    "inBedMinutes": max(130.0, asleep + rng.uniform(10, 60)),
                    "interruptions": int(rng.poisson(1 + 0.4 * n)),
                    "sleepStart": onset,
                }
            phys = (
                {"restingHrDeltaBpm": round(float(rng.normal(1.2 * n, 2)), 1), "hrvRobustZ": round(float(rng.normal(-0.3 * n, 1)), 2)}
                if sleep and rng.random() < 0.8
                else {}
            )
            feats = build_session_features(
                {
                    "session": {"startedAt": start, "endedAt": end, "tzOffsetMin": tz},
                    "drinks": drinks,
                    "priorDrinks": list(all_drinks),
                    "priorSessionStarts": list(starts),
                    "sleep": sleep,
                    **phys,
                }
            )
            v = feats["values"]
            latent = (
                -1.0
                + 0.9 * (v["std_drinks_known"] or 0)
                + 0.6 * (v["peak_std_60min"] or 0)
                - 2.0 * ((v["sleep_efficiency"] or 0.85) - 0.85)
                + intercept
                + rng.normal(0, 1.2)
            )
            severity: float | None = float(np.clip(np.round(latent), 0, 10))
            # Missing-not-at-random flavour: worse mornings slightly less likely to be logged.
            if rng.random() < missing_checkin_rate + (0.1 if severity is not None and severity >= 6 else 0):
                severity = None
            rows.append(
                {
                    "participant_id": pid,
                    "session_id": f"{SYNTHETIC_MARKER}-{p}-{k}",
                    "started_at": start,
                    "features": feats,
                    "severity": severity,
                }
            )
            starts.append(start)
            all_drinks.extend(drinks)
    return dataset_from_rows(rows, synthetic=True)
