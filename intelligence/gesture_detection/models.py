"""Model zoo for gesture recognition. Feature-based models consume engineered window features;
sequence models (DTW-kNN, 1D-CNN, TCN, GRU) consume raw normalised windows (size × 6).

Selection is made from measured evaluation results (participant-separated F1/FPR, calibration,
latency, size) — never by preference. Optional dependencies (xgboost, torch) are reported as
unavailable rather than silently replaced.
"""

from __future__ import annotations

from typing import Any

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from .dtw import DTWKNNClassifier

MODEL_FAMILIES: dict[str, str] = {
    "logistic_regression": "features",
    "random_forest": "features",
    "svm": "features",
    "xgboost": "features",
    "dtw_knn": "raw",
    "cnn1d": "raw",
    "tcn": "raw",
    "gru": "raw",
}


class DependencyUnavailable(RuntimeError):
    pass


class ContiguousLabels:
    """Maps arbitrary integer labels to 0..k-1 for estimators (e.g. XGBoost) that require it,
    while exposing the original label values as `classes_`."""

    def __init__(self, base: Any) -> None:
        self.base = base

    def fit(self, X: Any, y: Any) -> ContiguousLabels:
        import numpy as np

        self.classes_ = np.unique(y)
        self.base.fit(X, np.searchsorted(self.classes_, y))
        return self

    def predict_proba(self, X: Any) -> Any:
        return self.base.predict_proba(X)

    def predict(self, X: Any) -> Any:
        import numpy as np

        return self.classes_[np.argmax(self.predict_proba(X), axis=1)]


def build_model(name: str, n_classes: int, seed: int = 0) -> Any:
    if name == "logistic_regression":
        return make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0, random_state=seed))
    if name == "random_forest":
        return RandomForestClassifier(n_estimators=200, min_samples_leaf=2, n_jobs=-1, random_state=seed, class_weight="balanced")
    if name == "svm":
        return make_pipeline(StandardScaler(), SVC(C=3.0, kernel="rbf", probability=True, random_state=seed, class_weight="balanced"))
    if name == "xgboost":
        try:
            from xgboost import XGBClassifier
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise DependencyUnavailable("xgboost is not installed") from exc
        return ContiguousLabels(
            XGBClassifier(
                n_estimators=200, max_depth=4, learning_rate=0.1, subsample=0.9, eval_metric="mlogloss", random_state=seed, n_jobs=2
            )
        )
    if name == "dtw_knn":
        return DTWKNNClassifier(k=3, band=8, downsample=4, random_state=seed)
    if name in ("cnn1d", "tcn", "gru"):
        from .deep import build_deep_model

        return build_deep_model(name, n_classes=n_classes, seed=seed)
    raise ValueError(f"unknown model family {name!r}")
