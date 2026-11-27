from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from threshold_intelligence.evaluation.metrics import binary_ece, brier_skill_score, ranked_probability_score
from threshold_intelligence.evaluation.validation import gate_recovery
from threshold_intelligence.personalization import GaussianPartialPooling, LogisticPartialPooling, map_offset
from threshold_intelligence.recovery_prediction.dataset import dataset_from_rows, rows_from_export
from threshold_intelligence.recovery_prediction.evaluate import participant_separated, temporal_holdout
from threshold_intelligence.recovery_prediction.features import SESSION_FEATURE_NAMES
from threshold_intelligence.recovery_prediction.models import OrdinalFrankHall, build_binary
from threshold_intelligence.recovery_prediction.synthetic import synthetic_recovery_dataset
from threshold_intelligence.training import recovery
from threshold_intelligence.training.export import ExportRefused, export_recovery_manifest
from threshold_intelligence.training.tracking import Run

VECTOR = Path(__file__).resolve().parents[2] / "packages" / "core" / "test-vectors" / "recovery_model.json"


@pytest.fixture(scope="module")
def ds():  # type: ignore[no-untyped-def]
    return synthetic_recovery_dataset(participants=16, sessions_per=12, seed=3)


def test_metrics_reference_points() -> None:
    y = np.array([0, 1, 1, 0])
    p = np.array([0.5, 0.5, 0.5, 0.5])
    assert brier_skill_score(y, p, p) == 0.0
    assert brier_skill_score(y, y.astype(float), p) == 1.0
    assert binary_ece(np.array([0, 1]), np.array([0.0, 1.0])) == 0.0
    probs = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    assert ranked_probability_score(np.array([0, 2]), probs) == 0.0


def test_full_pipeline_on_synthetic_data_is_never_validated(ds, monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(Run, "finish", lambda self: tmp_path / "run.json")
    report = recovery.run(ds, n_splits=4, n_boot=20, ethics_ref="TEST")
    assert report["dataset"]["synthetic"] is True and report["warnings"]
    assert report["participant_separated"]["base_rate"]["brier_skill"] == pytest.approx(0.0, abs=0.05)
    assert set(report["participant_separated"]) == {"base_rate", "logistic", "elastic_net", "gbdt"}
    assert report["temporal"]["train_until"] <= report["temporal"]["test_from"]
    assert {"mean_baseline", "ridge", "gbdt_regressor"} <= set(report["regression"])
    assert 0 <= report["missing_data"]["outcome_missing_rate"] < 1
    assert report["validation_status"] == "not_validated"
    passed, reasons = gate_recovery(report)
    assert not passed and any("synthetic" in r for r in reasons)
    json.dumps(report, default=float)


def test_participant_separated_and_temporal_have_no_leakage(ds) -> None:  # type: ignore[no-untyped-def]
    lab = ds.labelled()
    out = participant_separated(lab, families=("base_rate", "logistic"), n_splits=4, n_boot=0)
    assert not np.isnan(out["oof"]["logistic"]).any()
    t = temporal_holdout(lab, families=("logistic",), n_boot=0)
    assert t["train_until"] <= t["test_from"]


def test_ordinal_probabilities_are_valid(ds) -> None:  # type: ignore[no-untyped-def]
    lab = ds.labelled()
    bands = np.digitize(lab.severity, (3, 5))
    probs = OrdinalFrankHall(3).fit(lab.X, bands).predict_proba(lab.X)
    assert np.allclose(probs.sum(axis=1), 1) and (probs >= 0).all()


def test_partial_pooling_shrinks_small_histories() -> None:
    logit = np.zeros(40)
    y = np.ones(40, dtype=np.int64)
    few = map_offset(logit[:3], y[:3], sigma=0.5)[0]
    many = map_offset(logit, y, sigma=0.5)[0]
    assert 0 < few < many  # more evidence → further from the population
    assert map_offset(logit, y, sigma=0.05)[0] < many  # tighter prior → more shrinkage
    groups = np.array(["a"] * 37 + ["b"] * 3)
    pool = LogisticPartialPooling(min_history=5).fit(logit, y, groups)
    assert pool.personalized("a") and not pool.personalized("b")  # cold start for b
    assert pool.adjust(np.zeros(1), ["b"])[0] == 0.0


def test_gaussian_pooling_without_between_user_variance_does_not_personalize() -> None:
    rng = np.random.default_rng(0)
    resid = rng.normal(0, 1, 200)
    groups = np.repeat([f"u{i}" for i in range(20)], 10)
    gp = GaussianPartialPooling().fit(resid, groups)
    assert all(abs(v) < 0.5 for v in gp.offsets.values())
    shifted = resid + np.repeat(np.linspace(-3, 3, 20), 10)
    gp2 = GaussianPartialPooling().fit(shifted, groups)
    assert gp2.tau2 > 1 and gp2.offsets["u0"] < -2


def test_rows_from_export_links_checkins_and_skips_deleted_sessions() -> None:
    s1 = {"id": "s1", "startedAt": 1_000_000_000_000, "endedAt": 1_000_010_000_000, "tzOffsetMin": 0, "deletedAt": None}
    s2 = {**s1, "id": "s2", "startedAt": 1_000_100_000_000, "endedAt": 1_000_110_000_000}
    s3 = {**s1, "id": "s3", "deletedAt": 1}
    drink = {
        "sessionId": "s1",
        "consumedAt": 1_000_001_000_000,
        "standardDrinks": 1.0,
        "isAlcoholic": True,
        "category": "beer",
        "confirmation": "user_confirmed",
        "deletedAt": None,
    }
    bundle = {
        "app": {"name": "Threshold"},
        "data": {
            "sessions": [s1, s2, s3],
            "drinks": [drink],
            "checkins": [{"sessionId": "s1", "overallSeverity": 6, "deletedAt": None, "updatedAt": 1}],
            "measurements": [],
        },
    }
    rows = rows_from_export(bundle, "TH-1")
    assert [r["session_id"] for r in rows] == ["s1", "s2"]
    assert rows[0]["severity"] == 6 and rows[1]["severity"] is None
    assert rows[1]["features"]["values"]["prior_7d_sessions"] is not None
    ds = dataset_from_rows(rows, synthetic=False)
    assert ds.has_outcome.tolist() == [True, False] and ds.binary[0] == 1


def test_recovery_export_refuses_synthetic_or_unvalidated(ds, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    lab = ds.labelled()
    model = build_binary("logistic").fit(lab.X, lab.binary)
    base = {"task": "recovery_risk", "feature_version": "sf-v1", "dataset": {"synthetic": False}, "validation_status": "validated"}
    for bad in (
        {**base, "dataset": {"synthetic": True}},
        {**base, "validation_status": "not_validated"},
        {**base, "feature_version": "old"},
    ):
        with pytest.raises(ExportRefused):
            export_recovery_manifest(model, bad, "recovery", "1", tmp_path / "m.json")
    path = export_recovery_manifest(model, base, "recovery", "1", tmp_path / "m.json", bootstrap_models=[model])
    manifest = json.loads(path.read_text())
    assert manifest["status"] == "validated" and len(manifest["bootstrap"]) == 1
    assert manifest["features"] == list(SESSION_FEATURE_NAMES)


def _manual_predict(manifest: dict, values: dict) -> float:  # type: ignore[type-arg]
    m = manifest["model"]
    x = np.array([np.nan if values[k] is None else values[k] for k in manifest["features"]], dtype=float)
    imputed = np.where(np.isnan(x), m["impute_medians"], x)
    indicators = np.isnan(x[m["indicator_features"]]).astype(float)
    z = (np.concatenate([imputed, indicators]) - m["scaler_mean"]) / m["scaler_scale"]
    return float(1 / (1 + np.exp(-(z @ np.array(m["coef"]) + m["intercept"]))))


def test_recovery_model_vector_matches_manual_arithmetic() -> None:
    """The same vector is evaluated by packages/core/src/recoveryModel.ts."""
    vec = json.loads(VECTOR.read_text())
    assert vec["manifest"]["status"] == "test_fixture"
    for case in vec["cases"]:
        assert _manual_predict(vec["manifest"], case["values"]) == pytest.approx(case["expectedProbability"], abs=1e-12)
