"""File-backed model registry (intelligence/model_registry.json), mirrored to the backend's
model_versions table and bundled into the apps. A model's status only becomes `validated`
through `promote`, which runs the validation gate and requires a named approver."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..evaluation.validation import gate_gesture, gate_recovery

REGISTRY_PATH = Path(__file__).resolve().parents[1] / "model_registry.json"


class PromotionRefused(RuntimeError):
    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def load(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": 1, "models": []}
    return json.loads(path.read_text())


def save(registry: dict[str, Any], path: Path = REGISTRY_PATH) -> None:
    path.write_text(json.dumps(registry, indent=2) + "\n")


def register(model_id: str, version: str, task: str, report_path: str, path: Path = REGISTRY_PATH) -> dict[str, Any]:
    reg = load(path)
    if any(m["modelId"] == model_id and m["version"] == version for m in reg["models"]):
        raise ValueError(f"{model_id}@{version} already registered")
    entry = {
        "modelId": model_id,
        "version": version,
        "task": task,
        "status": "experimental",
        "report": report_path,
        "registeredAt": datetime.now(UTC).isoformat(),
    }
    reg["models"].append(entry)
    save(reg, path)
    return entry


def promote(model_id: str, version: str, report: dict[str, Any], approved_by: str, path: Path = REGISTRY_PATH) -> dict[str, Any]:
    if not approved_by.strip():
        raise PromotionRefused(["an approver is required"])
    report = {**report, "sign_off": {**report.get("sign_off", {}), "approved_by": approved_by}}
    task = report.get("task")
    passed, reasons = (
        gate_gesture(report)
        if task == "gesture_classification"
        else gate_recovery(report)
        if task == "recovery_risk"
        else (False, [f"unknown task {task!r}"])
    )
    if not passed:
        raise PromotionRefused(reasons)
    reg = load(path)
    for m in reg["models"]:
        if m["modelId"] == model_id and m["version"] == version:
            m.update(status="validated", validatedBy=approved_by, validatedAt=datetime.now(UTC).isoformat())
            save(reg, path)
            return m
    raise KeyError(f"{model_id}@{version} is not registered")


def validated(task: str, path: Path = REGISTRY_PATH) -> list[dict[str, Any]]:
    return [m for m in load(path)["models"] if m["task"] == task and m["status"] == "validated"]
