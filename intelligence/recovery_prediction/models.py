"""Model families for next-day recovery.

Every family receives the raw feature matrix with NaN for missing values and handles
missingness explicitly (median imputation + missing-indicator columns, or native NaN handling
for gradient boosting). The base-rate model is the reference every other model must beat.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, clone
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

BINARY_FAMILIES = ("base_rate", "logistic", "elastic_net", "gbdt")
REGRESSION_FAMILIES = ("mean_baseline", "ridge", "gbdt_regressor")


class BaseRateClassifier(ClassifierMixin, BaseEstimator):  # type: ignore[misc]
    """Predicts the training prevalence for everyone — the reference for Brier skill."""

    def fit(self, X: NDArray[np.float64], y: NDArray[np.int64]) -> BaseRateClassifier:
        self.classes_ = np.array([0, 1])
        self.rate_ = float(np.mean(y)) if len(y) else 0.5
        return self

    def predict_proba(self, X: NDArray[np.float64]) -> NDArray[np.float64]:
        p = np.full(len(X), self.rate_)
        return np.column_stack([1 - p, p])

    def predict(self, X: NDArray[np.float64]) -> NDArray[np.int64]:
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(np.int64)


class MeanRegressor(RegressorMixin, BaseEstimator):  # type: ignore[misc]
    def fit(self, X: NDArray[np.float64], y: NDArray[np.float64]) -> MeanRegressor:
        self.mean_ = float(np.mean(y)) if len(y) else 0.0
        return self

    def predict(self, X: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.full(len(X), self.mean_)


def _linear_prep() -> list[Any]:
    return [SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True), StandardScaler()]


def build_binary(family: str, seed: int = 0) -> Any:
    if family == "base_rate":
        return BaseRateClassifier()
    if family == "logistic":
        return make_pipeline(*_linear_prep(), LogisticRegression(C=1.0, max_iter=2000))
    if family == "elastic_net":
        return make_pipeline(*_linear_prep(), LogisticRegression(solver="saga", l1_ratio=0.5, C=0.5, max_iter=10000, random_state=seed))
    if family == "gbdt":
        return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, l2_regularization=1.0, random_state=seed)
    raise ValueError(f"unknown family {family!r}")


def build_regressor(family: str, seed: int = 0) -> Any:
    if family == "mean_baseline":
        return MeanRegressor()
    if family == "ridge":
        return make_pipeline(*_linear_prep(), Ridge(alpha=1.0))
    if family == "gbdt_regressor":
        return HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=200, l2_regularization=1.0, random_state=seed)
    raise ValueError(f"unknown family {family!r}")


class OrdinalFrankHall(BaseEstimator):  # type: ignore[misc]
    """Ordinal classifier (Frank & Hall, 2001): K−1 binary models for P(y > k).

    Band probabilities are differences of the cumulative estimates, clipped and renormalised so
    they stay a valid distribution even when the binary models disagree slightly.
    """

    def __init__(self, n_classes: int = 3, base: Any = None) -> None:
        self.n_classes = n_classes
        self.base = base

    def fit(self, X: NDArray[np.float64], y: NDArray[np.int64]) -> OrdinalFrankHall:
        base = self.base if self.base is not None else build_binary("logistic")
        self.models_: list[Any] = []
        for k in range(self.n_classes - 1):
            target = (y > k).astype(np.int64)
            m = BaseRateClassifier() if len(np.unique(target)) < 2 else clone(base)
            self.models_.append(m.fit(X, target))
        return self

    def predict_proba(self, X: NDArray[np.float64]) -> NDArray[np.float64]:
        gt = np.column_stack([m.predict_proba(X)[:, 1] for m in self.models_])  # P(y > k)
        gt = np.minimum.accumulate(gt, axis=1)  # enforce monotone cumulative probabilities
        cum = np.column_stack([np.ones(len(X)), gt, np.zeros(len(X))])
        probs = np.clip(cum[:, :-1] - cum[:, 1:], 0, 1)
        return probs / probs.sum(axis=1, keepdims=True)

    def predict(self, X: NDArray[np.float64]) -> NDArray[np.int64]:
        return np.argmax(self.predict_proba(X), axis=1).astype(np.int64)


def logistic_parts(model: Pipeline) -> dict[str, Any]:
    """Extract a fitted logistic pipeline as plain arrays (for the mobile JSON manifest)."""
    imputer, scaler, lr = model.steps[0][1], model.steps[1][1], model.steps[2][1]
    return {
        "impute_medians": imputer.statistics_.tolist(),
        "indicator_features": imputer.indicator_.features_.tolist() if imputer.indicator_ is not None else [],
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "coef": lr.coef_[0].tolist(),
        "intercept": float(lr.intercept_[0]),
    }
