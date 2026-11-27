"""Export helpers for on-device inference.

Core ML (watch): sequence models are traced with torch.jit and converted with coremltools to an
ML Program with input `window` shaped [1, 6, 128] (float32) and output `probabilities`. This is the
contract implemented by apps/watch/ThresholdWatch/Intelligence/GestureDetector.swift.
ONNX: scikit-learn models via skl2onnx for server-side or cross-platform evaluation.

Exports refuse to run for reports that are not `validated` unless `allow_unvalidated=True`
(used for internal benchmarking builds only; such artifacts must never ship).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..gesture_detection.models import DependencyUnavailable

COREML_INPUT_NAME = "window"
COREML_OUTPUT_NAME = "probabilities"
WINDOW_SHAPE = (1, 6, 128)


class ExportRefused(RuntimeError):
    pass


def _check(report: dict[str, Any], allow_unvalidated: bool) -> None:
    if report.get("dataset", {}).get("synthetic", True):
        raise ExportRefused("refusing to export a model trained on synthetic data")
    if report.get("validation_status") != "validated" and not allow_unvalidated:
        raise ExportRefused("model is not validated; pass allow_unvalidated=True only for internal benchmarking")


def _check_device_parity(report: dict[str, Any]) -> None:
    if report.get("evaluation", {}).get("preprocessing") != "device_v1":
        raise ExportRefused("watch models must be trained with preprocessing='device_v1' so the watch can reproduce the input")


def write_watch_manifest(report: dict[str, Any], classes: list[str], threshold: float, model_id: str, version: str, out_dir: Path) -> Path:
    """Write gesture_model_manifest.json, read by GestureDetector.swift.

    The watch loads a bundled model only when this manifest says ``"status": "validated"``, and
    this function refuses to write one unless the report is validated, non-synthetic and trained
    with on-device-reproducible preprocessing.
    """
    _check(report, allow_unvalidated=False)
    _check_device_parity(report)
    if "drinking_like" not in classes:
        raise ExportRefused("class list must contain 'drinking_like'")
    if not 0.5 <= threshold < 1.0:
        raise ExportRefused("prompt threshold must be in [0.5, 1.0)")
    manifest = {
        "modelId": model_id,
        "version": version,
        "status": "validated",
        "classes": classes,
        "threshold": threshold,
        "preprocessing": "device_v1",
        "runId": str(report.get("run_id")),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "gesture_model_manifest.json"
    path.write_text(json.dumps(manifest, indent=2))
    return path


def export_coreml(torch_classifier: Any, report: dict[str, Any], out: Path, allow_unvalidated: bool = False) -> Path:
    _check(report, allow_unvalidated)
    _check_device_parity(report)
    try:
        import coremltools as ct
        import torch
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise DependencyUnavailable("coremltools and torch are required for Core ML export") from exc

    class Wrapped(torch.nn.Module):  # type: ignore[misc]
        def __init__(self, inner: Any, mean: Any, std: Any) -> None:
            super().__init__()
            self.inner = inner
            self.register_buffer("mean", torch.from_numpy(mean))
            self.register_buffer("std", torch.from_numpy(std))

        def forward(self, x: Any) -> Any:
            return torch.softmax(self.inner((x - self.mean) / self.std), dim=1)

    model = Wrapped(torch_classifier.model_, torch_classifier.mean_, torch_classifier.std_).eval()
    traced = torch.jit.trace(model, torch.zeros(WINDOW_SHAPE))
    mlmodel = ct.convert(
        traced,
        inputs=[ct.TensorType(name=COREML_INPUT_NAME, shape=WINDOW_SHAPE)],
        outputs=[ct.TensorType(name=COREML_OUTPUT_NAME)],
        minimum_deployment_target=ct.target.watchOS10,
        convert_to="mlprogram",
    )
    mlmodel.short_description = "Threshold drinking-like gesture classifier (research)"
    mlmodel.user_defined_metadata["validation_status"] = str(report.get("validation_status"))
    mlmodel.user_defined_metadata["run_id"] = str(report.get("run_id"))
    out.parent.mkdir(parents=True, exist_ok=True)
    mlmodel.save(str(out))
    return out


def export_onnx(sklearn_model: Any, n_features: int, report: dict[str, Any], out: Path, allow_unvalidated: bool = False) -> Path:
    _check(report, allow_unvalidated)
    try:
        from skl2onnx import to_onnx
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise DependencyUnavailable("skl2onnx is required for ONNX export") from exc
    import numpy as np

    onx = to_onnx(sklearn_model, np.zeros((1, n_features), dtype=np.float32))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(onx.SerializeToString())
    return out


def export_recovery_manifest(
    model: Any,
    report: dict[str, Any],
    model_id: str,
    version: str,
    out: Path,
    bootstrap_models: list[Any] | None = None,
    min_history: int = 5,
    prior_sigma: float | None = None,
) -> Path:
    """Write the JSON manifest the app evaluates on-device (apps/mobile/services/recovery).

    Only the ``logistic`` family is exportable (median imputation + missing indicators +
    standardisation + logistic regression), because the app reproduces it exactly in TypeScript.
    ``bootstrap_models`` (logistic pipelines refit on participant-bootstrap resamples) give the
    interval the app shows; without them the app shows no interval. ``prior_sigma`` (from the
    personalization evaluation) enables on-device partial pooling; without it the app uses the
    population estimate only.
    """
    from ..recovery_prediction.features import SESSION_FEATURE_NAMES, SESSION_FEATURE_VERSION
    from ..recovery_prediction.models import logistic_parts

    _check(report, allow_unvalidated=False)
    if report.get("task") != "recovery_risk" or report.get("feature_version") != SESSION_FEATURE_VERSION:
        raise ExportRefused("report is not a recovery report for the current feature version")
    manifest = {
        "modelId": model_id,
        "version": version,
        "status": "validated",
        "task": "recovery_risk",
        "featureVersion": SESSION_FEATURE_VERSION,
        "features": list(SESSION_FEATURE_NAMES),
        "outcome": report.get("outcome", {}).get("binary"),
        "severityThreshold": report.get("outcome", {}).get("severity_threshold", 5),
        "minHistory": min_history,
        "priorSigma": prior_sigma,
        "runId": str(report.get("run_id")),
        "model": logistic_parts(model),
        "bootstrap": [logistic_parts(m) for m in (bootstrap_models or [])],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2))
    return out
