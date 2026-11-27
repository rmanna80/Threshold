"""Pipeline-mechanics tests on SYNTHETIC data. These verify code paths (splits, leakage checks,
metrics, abstention, selection, gating) — they say nothing about real-world accuracy."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from threshold_intelligence.activity_classification import window_recordings
from threshold_intelligence.datasets import load_recording, synthetic_recordings
from threshold_intelligence.evaluation import (
    LeakageError,
    assert_no_leakage,
    binary_metrics,
    brier_score,
    expected_calibration_error,
    participant_folds,
    temporal_split,
)
from threshold_intelligence.evaluation.validation import gate_gesture
from threshold_intelligence.gesture_detection import AbstainingClassifier, DTWKNNClassifier, dtw_distance
from threshold_intelligence.training import gesture as pipeline
from threshold_intelligence.training import registry


@pytest.fixture(scope="module")
def dataset():  # type: ignore[no-untyped-def]
    return window_recordings(synthetic_recordings(participants=4, per_label=2, seconds=8))


def test_windowing_shapes_and_groups(dataset) -> None:  # type: ignore[no-untyped-def]
    assert dataset.raw.shape[1:] == (128, 6)
    assert dataset.features.shape == (len(dataset), len(dataset.feature_names))
    assert dataset.synthetic is True
    assert len(np.unique(dataset.groups)) == 4


def test_participant_folds_never_leak(dataset) -> None:  # type: ignore[no-untyped-def]
    for train, test in participant_folds(dataset.groups, 4):
        assert not set(dataset.groups[train]) & set(dataset.groups[test])
    with pytest.raises(LeakageError):
        assert_no_leakage(np.array(["a", "b"]), np.array(["b"]))
    with pytest.raises(ValueError):
        list(participant_folds(np.array(["only"] * 5)))


def test_temporal_split_has_no_lookahead() -> None:
    ts = np.array([5.0, 1.0, 3.0, 2.0, 4.0])
    train, test = temporal_split(ts, 0.4)
    assert ts[train].max() < ts[test].min()


def test_metrics() -> None:
    m = binary_metrics(np.array([1, 1, 0, 0], bool), np.array([1, 0, 1, 0], bool))
    assert m["precision"] == 0.5 and m["recall"] == 0.5 and m["false_positive_rate"] == 0.5
    assert brier_score(np.array([0, 1]), np.array([[1.0, 0.0], [0.0, 1.0]]), np.array([0, 1])) == 0.0
    assert expected_calibration_error(np.array([0.9, 0.9]), np.array([True, False])) == pytest.approx(0.4)


def test_dtw() -> None:
    a = np.sin(np.linspace(0, 6, 40))[:, None]
    b = np.sin(np.linspace(0.3, 6.3, 40))[:, None]
    assert dtw_distance(a, a) == 0.0
    assert dtw_distance(a, b) < np.linalg.norm(a - b) * 40
    X = np.stack([np.tile(a, (1, 6)), np.tile(-a, (1, 6))] * 3)
    y = np.array([0, 1] * 3)
    clf = DTWKNNClassifier(k=1, downsample=1).fit(X, y)
    assert clf.predict(X).tolist() == y.tolist()


def test_abstention_returns_unknown_below_threshold() -> None:
    class Fixed:
        classes_ = np.array([0, 1])

        def predict_proba(self, X):  # type: ignore[no-untyped-def]
            return np.array([[0.55, 0.45], [0.95, 0.05]])

    clf = AbstainingClassifier(Fixed(), threshold=0.8)
    assert clf.predict(np.zeros((2, 1))).tolist() == [-1, 0]
    assert clf.coverage(np.zeros((2, 1))) == 0.5


def test_full_pipeline_on_synthetic_data_is_labelled_and_never_validated(dataset, tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(pipeline.Run, "finish", lambda self: tmp_path / "run.json")
    report = pipeline.run(dataset, families=("logistic_regression", "random_forest", "xgboost", "cnn1d"), n_splits=4)
    assert report["dataset"]["synthetic"] is True
    assert report["warnings"]
    lr = report["families"]["logistic_regression"]
    assert lr["status"] == "ok"
    assert 0 <= lr["binary"]["false_positive_rate"] <= 1
    assert len(lr["drinking_recall_ci"]) == 2
    assert report["families"]["cnn1d"]["status"] in ("ok", "not_run")
    assert report["selection"]["status"] == "candidate"
    assert report["validation_status"] == "not_validated"
    passed, reasons = gate_gesture(report)
    assert not passed
    assert any("synthetic" in r for r in reasons)
    json.dumps(report)  # report is serialisable


def test_registry_refuses_promotion_without_evidence(tmp_path: Path) -> None:
    path = tmp_path / "registry.json"
    registry.register("gesture-cnn", "0.0.1", "gesture_classification", "report.json", path=path)
    with pytest.raises(registry.PromotionRefused) as err:
        registry.promote(
            "gesture-cnn", "0.0.1", {"task": "gesture_classification", "dataset": {"synthetic": True}}, approved_by="Reviewer", path=path
        )
    assert err.value.reasons
    with pytest.raises(registry.PromotionRefused):
        registry.promote("gesture-cnn", "0.0.1", {"task": "gesture_classification"}, approved_by=" ", path=path)
    assert registry.validated("gesture_classification", path=path) == []


def test_recording_loader(tmp_path: Path) -> None:
    lines = [
        json.dumps(
            {
                "type": "header",
                "recordingId": "r1",
                "participantId": "p1",
                "label": "drinking_like",
                "samplingHz": 50,
                "wrist": "left",
                "crown": "right",
            }
        )
    ]
    lines += [json.dumps({"t": i / 50, "ax": 0.0, "ay": 0.0, "az": 0.0, "rx": 0.1, "ry": 0.0, "rz": 0.0}) for i in range(200)]
    lines.append(json.dumps({"type": "footer", "samples": 200, "droppedEstimate": 0}))
    p = tmp_path / "r1.jsonl"
    p.write_text("\n".join(lines))
    rec = load_recording(p)
    assert rec.samples.shape == (200, 6)
    assert rec.data_quality["effective_hz"] == pytest.approx(50.0)
    bad = tmp_path / "bad.jsonl"
    bad.write_text(lines[0] + "\n" + json.dumps({"t": 0}))
    with pytest.raises(ValueError):
        load_recording(bad)


def test_loads_recording_in_exact_watch_format() -> None:
    """Pins the JSONL format written by ResearchRecording.swift (extra gravity keys ignored)."""
    rec = load_recording(Path(__file__).parent / "fixtures" / "watch_recording.jsonl")
    assert rec.participant_id == "TH-0042"
    assert rec.label == "drinking_like"
    assert rec.samples.shape == (11, 6)
    assert rec.wrist == "left" and rec.crown == "right"
    assert rec.data_quality["dropped_estimate"] == 1.0
    assert rec.data_quality["max_gap_s"] > 0.03


def test_watch_manifest_requires_validated_real_device_parity_report(tmp_path: Path) -> None:
    from threshold_intelligence.training.export import ExportRefused, write_watch_manifest

    ok = {"dataset": {"synthetic": False}, "validation_status": "validated", "evaluation": {"preprocessing": "device_v1"}, "run_id": "r1"}
    classes = ["drinking_like", "eating", "other"]
    bad_reports = [
        {**ok, "dataset": {"synthetic": True}},
        {**ok, "validation_status": "not_validated"},
        {**ok, "evaluation": {"preprocessing": "offline_v1"}},
    ]
    for report in bad_reports:
        with pytest.raises(ExportRefused):
            write_watch_manifest(report, classes, 0.8, "gesture", "1", tmp_path)
    with pytest.raises(ExportRefused):
        write_watch_manifest(ok, ["eating", "other"], 0.8, "gesture", "1", tmp_path)
    path = write_watch_manifest(ok, classes, 0.8, "gesture", "1", tmp_path)
    manifest = json.loads(path.read_text())
    assert manifest["status"] == "validated" and manifest["preprocessing"] == "device_v1"


def test_device_preprocessing_skips_zero_phase_filter(dataset) -> None:  # type: ignore[no-untyped-def]
    from threshold_intelligence.activity_classification.windowing import preprocess

    rec = synthetic_recordings(participants=1, per_label=1)[0]
    offline = preprocess(rec, mode="offline_v1")
    device = preprocess(rec, mode="device_v1")
    assert offline.shape == device.shape
    assert not np.allclose(offline, device)
