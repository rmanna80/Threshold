"""Recovery-model training and evaluation pipeline.

    python -m threshold_intelligence.training.recovery --data exports/ --out artifacts/recovery_report.json \
        [--manifest manifest.json] [--ethics-ref IRB-2027-014] [--severity-threshold 5]
    python -m threshold_intelligence.training.recovery --synthetic --out /tmp/report.json   # mechanics only

The report always starts as ``not_validated``. Promotion goes through training.registry.promote,
which applies the RecoveryCriteria gate (participants, sessions, temporal and participant-separated
validation, Brier skill over the base rate, calibration, ethics reference, sign-off).
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from ..recovery_prediction.dataset import DEFAULT_SEVERITY_THRESHOLD, RecoveryDataset, load_export_dir
from ..recovery_prediction.evaluate import evaluate
from ..recovery_prediction.features import SESSION_FEATURE_VERSION
from ..recovery_prediction.synthetic import synthetic_recovery_dataset
from .tracking import Run


def run(ds: RecoveryDataset, n_splits: int = 5, n_boot: int = 200, ethics_ref: str | None = None) -> dict[str, Any]:
    tracker = Run("recovery")
    labelled = ds.labelled()
    tracker.log_params(synthetic=ds.synthetic, n_sessions=len(ds), n_labelled=len(labelled), n_splits=n_splits)
    results = evaluate(ds, n_splits=n_splits, n_boot=n_boot)
    for f, r in results["participant_separated"].items():
        tracker.log_metric(f"{f}.brier_skill", r["brier_skill"])
    report = {
        "task": "recovery_risk",
        "generated_at": datetime.now(UTC).isoformat(),
        "feature_version": SESSION_FEATURE_VERSION,
        "outcome": {
            "binary": f"overallSeverity >= {ds.severity_threshold} (analysis choice, not a clinical cut-off)",
            "severity_threshold": ds.severity_threshold,
            "regression": "overallSeverity 0-10",
            "ordinal_band_edges": results["ordinal"]["band_edges"],
        },
        "dataset": {
            "synthetic": ds.synthetic,
            "n_sessions": int(len(labelled)),
            "n_sessions_total": int(len(ds)),
            "n_participants": int(len(np.unique(labelled.groups))),
            "prevalence": float(labelled.binary.mean()) if len(labelled) else None,
            "sources": ds.sources,
        },
        "evaluation": {"participant_separated": True, "temporal_validation": True, "n_splits": n_splits, "bootstrap": n_boot},
        **results,
        "ethics": {"approval_reference": ethics_ref},
        "validation_status": "not_validated",
        "warnings": ["SYNTHETIC DATA — results say nothing about real-world performance."] if ds.synthetic else [],
        "run_id": tracker.id,
    }
    tracker.set_tag("synthetic", str(ds.synthetic))
    tracker.finish()
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--data", type=Path, help="directory of Threshold JSON exports, one per participant")
    src.add_argument("--synthetic", action="store_true", help="synthetic data (pipeline test only)")
    ap.add_argument("--manifest", type=Path, help="JSON mapping export file name -> study code")
    ap.add_argument("--severity-threshold", type=int, default=DEFAULT_SEVERITY_THRESHOLD)
    ap.add_argument("--splits", type=int, default=5)
    ap.add_argument("--bootstrap", type=int, default=200)
    ap.add_argument("--ethics-ref", default=None)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    if args.synthetic:
        ds = synthetic_recovery_dataset()
    else:
        manifest = json.loads(args.manifest.read_text()) if args.manifest else None
        ds = load_export_dir(args.data, manifest, args.severity_threshold)
    report = run(ds, args.splits, args.bootstrap, args.ethics_ref)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=float))
    print(json.dumps({"best": report["best"], "synthetic": ds.synthetic}, default=float))  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
