"""Generate packages/core/test-vectors/recovery_model.json.

The vector pins the arithmetic of the on-device logistic evaluator (median imputation, missing
indicators, standardisation, logistic link) against scikit-learn. The model inside it is fitted
on SYNTHETIC data, is labelled ``test_fixture`` and must never be shipped or interpreted.

    python intelligence/scripts/generate_recovery_model_vector.py
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
from threshold_intelligence.personalization import map_offset
from threshold_intelligence.recovery_prediction.features import SESSION_FEATURE_NAMES, SESSION_FEATURE_VERSION
from threshold_intelligence.recovery_prediction.models import build_binary, logistic_parts
from threshold_intelligence.recovery_prediction.synthetic import synthetic_recovery_dataset

OUT = Path(__file__).resolve().parents[2] / "packages" / "core" / "test-vectors" / "recovery_model.json"


def main() -> None:
    ds = synthetic_recovery_dataset(participants=12, sessions_per=12, seed=7).labelled()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = build_binary("logistic").fit(ds.X, ds.binary)
    all_p = model.predict_proba(ds.X)[:, 1]
    order = np.argsort(all_p)
    picks = [int(order[int(q * (len(order) - 1))]) for q in (0.05, 0.25, 0.45, 0.6, 0.8, 0.95)]
    rows = ds.X[picks].copy()
    rows[1, SESSION_FEATURE_NAMES.index("sleep_asleep_min")] = np.nan  # force a missing value
    probs = model.predict_proba(rows)[:, 1]
    cases = [
        {
            "values": {k: (None if np.isnan(v) else float(v)) for k, v in zip(SESSION_FEATURE_NAMES, row, strict=True)},
            "expectedProbability": float(p),
        }
        for row, p in zip(rows, probs, strict=True)
    ]
    manifest = {
        "modelId": "test-fixture",
        "version": "0",
        "status": "test_fixture",
        "task": "recovery_risk",
        "featureVersion": SESSION_FEATURE_VERSION,
        "features": list(SESSION_FEATURE_NAMES),
        "outcome": "SYNTHETIC — arithmetic test only",
        "severityThreshold": 5,
        "minHistory": 5,
        "priorSigma": 0.75,
        "runId": "none",
        "model": logistic_parts(model),
        "bootstrap": [],
    }
    logits = np.array([-1.2, 0.3, -0.4, 0.9, -2.0, 0.1])
    outcomes = np.array([1, 1, 0, 1, 0, 1])
    offset = {"logits": logits.tolist(), "outcomes": outcomes.tolist(), "sigma": 0.75, "expected": map_offset(logits, outcomes, 0.75)[0]}
    out = {"description": __doc__.strip().splitlines()[0], "manifest": manifest, "cases": cases, "mapOffset": offset}
    OUT.write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
