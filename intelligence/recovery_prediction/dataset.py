"""Recovery dataset assembly from Threshold export bundles.

Each participant contributes one JSON export (Profile → Your data → Everything (JSON)), shared
with the study team under a separately consented protocol. One row per ended, non-deleted
session; the outcome comes from the morning check-in linked to that session (if any).

Outcome definitions are ANALYSIS CHOICES, not clinical cut-offs, and are recorded in every report:
  * ``severity``  — overallSeverity, 0–10 (regression target, MAE)
  * ``moderate_or_worse`` — severity >= ``severity_threshold`` (default 5) (binary target)
  * ``severity_band`` — 0: 0–2, 1: 3–5, 2: 6–10 (ordinal target)
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .features import (
    FEATURE_GROUPS,
    SESSION_FEATURE_NAMES,
    build_session_features,
    feature_matrix,
    night_after_session,
    overnight_physiology,
    summarize_sleep,
)

DEFAULT_SEVERITY_THRESHOLD = 5
BAND_EDGES = (3, 6)  # severity < 3 → 0, < 6 → 1, else 2


def severity_band(severity: float) -> int:
    return 0 if severity < BAND_EDGES[0] else 1 if severity < BAND_EDGES[1] else 2


@dataclass
class RecoveryDataset:
    X: NDArray[np.float64]
    feature_names: list[str]
    severity: NDArray[np.float64]  # NaN where no check-in / no severity answer
    groups: NDArray[np.str_]
    times: NDArray[np.float64]
    session_ids: list[str]
    input_quality: list[str]
    availability: dict[str, NDArray[np.bool_]]
    synthetic: bool
    severity_threshold: int = DEFAULT_SEVERITY_THRESHOLD
    sources: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.session_ids)

    @property
    def has_outcome(self) -> NDArray[np.bool_]:
        return ~np.isnan(self.severity)

    @property
    def binary(self) -> NDArray[np.int64]:
        """1 = moderate-or-worse; only meaningful where ``has_outcome``."""
        return (np.nan_to_num(self.severity, nan=-1) >= self.severity_threshold).astype(np.int64)

    def labelled(self) -> RecoveryDataset:
        m = self.has_outcome
        idx = np.flatnonzero(m)
        return RecoveryDataset(
            X=self.X[m],
            feature_names=self.feature_names,
            severity=self.severity[m],
            groups=self.groups[m],
            times=self.times[m],
            session_ids=[self.session_ids[i] for i in idx],
            input_quality=[self.input_quality[i] for i in idx],
            availability={k: v[m] for k, v in self.availability.items()},
            synthetic=self.synthetic,
            severity_threshold=self.severity_threshold,
            sources=self.sources,
        )


def _feature_drink(d: Mapping[str, Any]) -> dict[str, Any]:
    return {k: d.get(k) for k in ("consumedAt", "standardDrinks", "isAlcoholic", "category", "confirmation", "deletedAt")}


def rows_from_export(bundle: Mapping[str, Any], participant_id: str) -> list[dict[str, Any]]:
    data = bundle.get("data", {})
    sessions = [s for s in data.get("sessions", []) if s.get("deletedAt") is None and s.get("endedAt") is not None]
    drinks_by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for d in data.get("drinks", []):
        drinks_by_session[d["sessionId"]].append(_feature_drink(d))
    checkin_by_session: dict[str, Mapping[str, Any]] = {}
    for c in sorted(data.get("checkins", []), key=lambda c: c.get("updatedAt", 0)):
        if c.get("deletedAt") is None and c.get("sessionId"):
            checkin_by_session[c["sessionId"]] = c
    measurements = data.get("measurements", [])
    sleep_samples = [m for m in measurements if m.get("kind") in ("sleep_asleep", "sleep_in_bed", "sleep_awake")]
    nights_by_tz: dict[int, list[dict[str, Any]]] = {}
    rows = []
    for s in sessions:
        tz = int(s["tzOffsetMin"])
        own = drinks_by_session.get(s["id"], [])
        others = [d for sid, ds in drinks_by_session.items() if sid != s["id"] for d in ds]
        counted = sorted(
            d["consumedAt"]
            for d in own
            if d.get("deletedAt") is None and d.get("isAlcoholic") and d.get("confirmation") != "detected_unconfirmed"
        )
        last = counted[-1] if counted else None
        if tz not in nights_by_tz:
            nights_by_tz[tz] = summarize_sleep(sleep_samples, tz)
        nights = nights_by_tz[tz]
        night = night_after_session(nights, s, last)

        def samples(kind: str, tz: int = tz) -> list[dict[str, Any]]:
            return [{"value": m["value"], "at": m["startAt"], "tzOffsetMin": tz} for m in measurements if m.get("kind") == kind]

        phys = overnight_physiology(int(s["startedAt"]), night, samples("resting_heart_rate"), samples("hrv_sdnn"))
        feats = build_session_features(
            {
                "session": s,
                "drinks": own,
                "priorDrinks": others,
                "priorSessionStarts": [o["startedAt"] for o in sessions if o["id"] != s["id"]],
                "sleep": night,
                **phys,
            }
        )
        c = checkin_by_session.get(s["id"])
        sev = c.get("overallSeverity") if c else None
        rows.append(
            {"participant_id": participant_id, "session_id": s["id"], "started_at": s["startedAt"], "features": feats, "severity": sev}
        )
    return rows


def dataset_from_rows(
    rows: Sequence[Mapping[str, Any]], synthetic: bool, severity_threshold: int = DEFAULT_SEVERITY_THRESHOLD
) -> RecoveryDataset:
    if not rows:
        raise ValueError("no sessions found")
    feats = [r["features"] for r in rows]
    return RecoveryDataset(
        X=np.asarray(feature_matrix(feats), dtype=float),
        feature_names=list(SESSION_FEATURE_NAMES),
        severity=np.asarray([math.nan if r["severity"] is None else float(r["severity"]) for r in rows]),
        groups=np.asarray([r["participant_id"] for r in rows]),
        times=np.asarray([float(r["started_at"]) for r in rows]),
        session_ids=[r["session_id"] for r in rows],
        input_quality=[f["inputQuality"] for f in feats],
        availability={g: np.asarray([bool(f["availability"][g]) for f in feats], dtype=bool) for g in FEATURE_GROUPS},
        synthetic=synthetic,
        severity_threshold=severity_threshold,
    )


def load_export_dir(
    directory: str | Path, manifest: Mapping[str, str] | None = None, severity_threshold: int = DEFAULT_SEVERITY_THRESHOLD
) -> RecoveryDataset:
    """Load every ``*.json`` export in ``directory``. ``manifest`` maps file name → study code;
    otherwise the file stem is used as the participant id (never use names or emails)."""
    rows: list[dict[str, Any]] = []
    sources = []
    for path in sorted(Path(directory).glob("*.json")):
        bundle = json.loads(path.read_text(encoding="utf-8"))
        if bundle.get("app", {}).get("name") != "Threshold":
            raise ValueError(f"{path} is not a Threshold export")
        pid = (manifest or {}).get(path.name, path.stem)
        rows.extend(rows_from_export(bundle, pid))
        sources.append(path.name)
    ds = dataset_from_rows(rows, synthetic=False, severity_threshold=severity_threshold)
    ds.sources = sources
    return ds
