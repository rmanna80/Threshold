"""Gesture model comparison pipeline.

    python -m threshold_intelligence.training.gesture --data DIR --out report.json
    python -m threshold_intelligence.training.gesture --synthetic --out report.json   # pipeline test only

Every family is evaluated with participant-separated K-fold cross-validation on out-of-fold
predictions. The report is a *candidate* selection; promotion requires the validation gate in
evaluation/validation.py plus human sign-off. Results on synthetic data are labelled as such.
"""

from __future__ import annotations

import argparse
import json
import pickle
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from ..activity_classification.windowing import PREPROCESSING_MODES, WindowedDataset, window_recordings
from ..datasets.loader import load_recordings
from ..datasets.schema import ACTIVITY_LABELS, DRINKING_LABEL
from ..datasets.synthetic import synthetic_recordings
from ..evaluation.metrics import (
    binary_metrics,
    brier_score,
    classification_summary,
    cluster_bootstrap_ci,
    expected_calibration_error,
    reliability_curve,
)
from ..evaluation.splits import participant_folds
from ..gesture_detection.abstain import UNKNOWN
from ..gesture_detection.models import MODEL_FAMILIES, DependencyUnavailable, build_model
from .tracking import Run

DEFAULT_FAMILIES = tuple(MODEL_FAMILIES)


def _inputs(ds: WindowedDataset, family: str) -> np.ndarray:
    return ds.features if MODEL_FAMILIES[family] == "features" else ds.raw


def evaluate_family(ds: WindowedDataset, family: str, n_splits: int = 5, abstain_threshold: float = 0.8, seed: int = 0) -> dict[str, Any]:
    classes = np.unique(ds.labels)
    index = {c: i for i, c in enumerate(classes)}
    y = np.array([index[v] for v in ds.labels])
    X = _inputs(ds, family)
    proba = np.zeros((len(y), len(classes)))
    try:
        for train, test in participant_folds(ds.groups, n_splits):
            model = build_model(family, n_classes=len(classes), seed=seed)
            model.fit(X[train], y[train])
            p = np.asarray(model.predict_proba(X[test]))
            # Models only know classes seen in training; scatter into the global class order.
            seen = np.asarray(getattr(model, "classes_", np.arange(p.shape[1])))
            full = np.zeros((len(test), len(classes)))
            full[:, seen] = p
            proba[test] = full
    except DependencyUnavailable as exc:
        return {"status": "not_run", "reason": str(exc)}

    top = np.argmax(proba, axis=1)
    conf = proba[np.arange(len(y)), top]
    pred = np.where(conf >= abstain_threshold, top, UNKNOWN)
    drink_idx = index.get(ACTIVITY_LABELS.index(DRINKING_LABEL))
    y_pos = y == drink_idx if drink_idx is not None else np.zeros(len(y), bool)
    pred_pos = pred == drink_idx if drink_idx is not None else np.zeros(len(y), bool)

    def recall_on(idx: np.ndarray) -> float:
        return binary_metrics(y_pos[idx], pred_pos[idx])["recall"]

    # Latency and size measured on a final model fit to all data.
    final = build_model(family, n_classes=len(classes), seed=seed).fit(X, y)
    sample = X[: min(64, len(X))]
    t0 = time.perf_counter()
    for row in sample:
        final.predict_proba(row[None, ...])
    latency_ms = (time.perf_counter() - t0) * 1000 / len(sample)
    return {
        "status": "ok",
        "input": MODEL_FAMILIES[family],
        "multiclass": classification_summary(y, pred, list(range(len(classes))), [ACTIVITY_LABELS[c] for c in classes]),
        "binary": binary_metrics(y_pos, pred_pos),
        "drinking_recall_ci": list(cluster_bootstrap_ci(ds.groups, recall_on, n_boot=200, seed=seed)),
        "brier": brier_score(y, proba, np.arange(len(classes))),
        "ece": expected_calibration_error(conf, top == y),
        "reliability_drinking": reliability_curve(proba[:, drink_idx], y_pos) if drink_idx is not None else [],
        "coverage": float(np.mean(pred != UNKNOWN)),
        "latency_ms_median": latency_ms,
        "model_size_bytes": len(pickle.dumps(final)),
    }


def select(families: dict[str, dict[str, Any]], max_fpr: float = 0.05) -> dict[str, Any]:
    ok = {k: v for k, v in families.items() if v.get("status") == "ok"}
    eligible = {k: v for k, v in ok.items() if v["binary"]["false_positive_rate"] <= max_fpr} or ok
    if not eligible:
        return {"family": None, "reason": "no family could be evaluated"}
    best = max(
        eligible,
        key=lambda k: (
            round(eligible[k]["binary"]["f1"], 3),
            -eligible[k]["ece"],
            -eligible[k]["latency_ms_median"],
            -eligible[k]["model_size_bytes"],
        ),
    )
    return {
        "family": best,
        "criteria": f"max drinking F1 subject to FPR <= {max_fpr}; ties by calibration, latency, size",
        "status": "candidate",
    }


def run(ds: WindowedDataset, families: tuple[str, ...] = DEFAULT_FAMILIES, n_splits: int = 5) -> dict[str, Any]:
    tracker = Run("gesture")
    tracker.log_params(families=",".join(families), n_splits=n_splits, synthetic=ds.synthetic, n_windows=len(ds))
    results = {f: evaluate_family(ds, f, n_splits=n_splits) for f in families}
    for f, r in results.items():
        if r.get("status") == "ok":
            tracker.log_metric(f"{f}.f1", r["binary"]["f1"])
            tracker.log_metric(f"{f}.fpr", r["binary"]["false_positive_rate"])
    counts = {ACTIVITY_LABELS[c]: int((ds.labels == c).sum()) for c in np.unique(ds.labels)}
    report = {
        "task": "gesture_classification",
        "generated_at": datetime.now(UTC).isoformat(),
        "dataset": {
            "synthetic": ds.synthetic,
            "n_windows": len(ds),
            "n_participants": int(len(np.unique(ds.groups))),
            "label_counts": counts,
        },
        "evaluation": {
            "participant_separated": True,
            "n_splits": n_splits,
            "window_s": 2.56,
            "step_s": 1.28,
            "abstain_threshold": 0.8,
            "preprocessing": ds.preprocessing,
        },
        "families": results,
        "selection": select(results),
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
    src.add_argument("--data", type=Path, help="directory of .jsonl recordings from the watch research recorder")
    src.add_argument("--synthetic", action="store_true", help="use synthetic waveforms (pipeline test only)")
    ap.add_argument("--families", default=",".join(DEFAULT_FAMILIES))
    ap.add_argument("--splits", type=int, default=5)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument(
        "--preprocessing", choices=PREPROCESSING_MODES, default="offline_v1", help="use device_v1 for models intended for the watch"
    )
    args = ap.parse_args(argv)
    recordings = synthetic_recordings() if args.synthetic else load_recordings(args.data)
    report = run(window_recordings(recordings, preprocessing=args.preprocessing), tuple(args.families.split(",")), args.splits)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(json.dumps({"selection": report["selection"], "synthetic": report["dataset"]["synthetic"]}))  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
