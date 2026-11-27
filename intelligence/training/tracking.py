"""Experiment tracking: MLflow when installed (and MLFLOW_TRACKING_URI set), otherwise JSON run
records under intelligence/artifacts/runs/. Either way every run records parameters, metrics,
dataset provenance and the code version."""

from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"


def _git_rev() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True, timeout=5).stdout.strip()  # noqa: S603,S607
    except Exception:  # noqa: BLE001
        return "unknown"


class Run:
    def __init__(self, experiment: str, out_dir: Path | None = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.experiment = experiment
        self.started = time.time()
        self.params: dict[str, Any] = {}
        self.metrics: dict[str, float] = {}
        self.tags: dict[str, str] = {"git": _git_rev()}
        self.out_dir = out_dir or ARTIFACTS / "runs"
        self._mlflow: Any = None
        if os.environ.get("MLFLOW_TRACKING_URI"):
            try:
                import mlflow

                mlflow.set_experiment(experiment)
                mlflow.start_run(run_name=self.id)
                self._mlflow = mlflow
            except ImportError:
                self._mlflow = None

    def log_params(self, **params: Any) -> None:
        self.params.update(params)
        if self._mlflow:
            self._mlflow.log_params({k: str(v) for k, v in params.items()})

    def log_metric(self, name: str, value: float) -> None:
        self.metrics[name] = float(value)
        if self._mlflow:
            self._mlflow.log_metric(name, float(value))

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value
        if self._mlflow:
            self._mlflow.set_tag(key, value)

    def finish(self) -> Path:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        path = self.out_dir / f"{self.experiment}-{self.id}.json"
        path.write_text(
            json.dumps(
                {
                    "id": self.id,
                    "experiment": self.experiment,
                    "started": self.started,
                    "ended": time.time(),
                    "params": self.params,
                    "metrics": self.metrics,
                    "tags": self.tags,
                },
                indent=2,
            )
        )
        if self._mlflow:
            self._mlflow.end_run()
        return path
