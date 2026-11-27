"""Validation gate. A model may be promoted to `validated` only if its evaluation report meets
every criterion below AND carries human sign-off. Reports built from synthetic data always fail.

The thresholds are project policy for *enabling a feature*, not claims about safety.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class GestureCriteria:
    min_participants: int = 30
    min_drinking_windows: int = 2000
    min_recall: float = 0.80
    max_false_positive_rate: float = 0.05
    max_ece: float = 0.10
    max_latency_ms: float = 50.0


@dataclass(frozen=True)
class RecoveryCriteria:
    min_participants: int = 100
    min_sessions_with_outcomes: int = 1000
    min_brier_skill: float = 0.05
    max_ece: float = 0.10
    require_temporal_validation: bool = True


def gate_gesture(report: dict[str, Any], c: GestureCriteria = GestureCriteria()) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    ds = report.get("dataset", {})
    if ds.get("synthetic", True):
        reasons.append("dataset is synthetic or unspecified")
    if ds.get("n_participants", 0) < c.min_participants:
        reasons.append(f"needs >= {c.min_participants} participants (has {ds.get('n_participants', 0)})")
    if ds.get("label_counts", {}).get("drinking_like", 0) < c.min_drinking_windows:
        reasons.append(f"needs >= {c.min_drinking_windows} drinking-like windows")
    if not report.get("evaluation", {}).get("participant_separated", False):
        reasons.append("evaluation is not participant-separated")
    sel = report.get("selection", {})
    fam = report.get("families", {}).get(sel.get("family", ""), {})
    b = fam.get("binary", {})
    ci = fam.get("drinking_recall_ci", [0.0, 0.0])
    if ci[0] < c.min_recall:
        reasons.append(f"recall CI lower bound {ci[0]:.2f} < {c.min_recall}")
    if b.get("false_positive_rate", 1.0) > c.max_false_positive_rate:
        reasons.append(f"false positive rate {b.get('false_positive_rate', 1.0):.3f} > {c.max_false_positive_rate}")
    if fam.get("ece", 1.0) > c.max_ece:
        reasons.append("calibration error too high")
    if fam.get("latency_ms_median", 1e9) > c.max_latency_ms:
        reasons.append("inference latency too high")
    if not report.get("ethics", {}).get("approval_reference"):
        reasons.append("missing ethics approval reference")
    if not report.get("sign_off", {}).get("approved_by"):
        reasons.append("missing human sign-off")
    return (not reasons, reasons)


def gate_recovery(report: dict[str, Any], c: RecoveryCriteria = RecoveryCriteria()) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    ds = report.get("dataset", {})
    if ds.get("synthetic", True):
        reasons.append("dataset is synthetic or unspecified")
    if ds.get("n_participants", 0) < c.min_participants:
        reasons.append(f"needs >= {c.min_participants} participants")
    if ds.get("n_sessions", 0) < c.min_sessions_with_outcomes:
        reasons.append(f"needs >= {c.min_sessions_with_outcomes} sessions with outcomes")
    ev = report.get("evaluation", {})
    if c.require_temporal_validation and not ev.get("temporal_validation", False):
        reasons.append("temporal validation missing")
    if not ev.get("participant_separated", False):
        reasons.append("evaluation is not participant-separated")
    best = report.get("best", {})
    if best.get("brier_skill", -1.0) < c.min_brier_skill:
        reasons.append("no meaningful improvement over the base-rate model")
    if best.get("ece", 1.0) > c.max_ece:
        reasons.append("calibration error too high")
    if not report.get("ethics", {}).get("approval_reference"):
        reasons.append("missing ethics approval reference")
    if not report.get("sign_off", {}).get("approved_by"):
        reasons.append("missing human sign-off")
    return (not reasons, reasons)
