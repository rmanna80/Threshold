"""Exploratory anomaly detection relative to a person's own history.

Outputs describe *deviations*; they never diagnose intoxication or any condition. These methods
are research tools for analysing consented datasets; the app ships only the robust univariate
comparison (packages/core/src/baselines.ts).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from sklearn.covariance import MinCovDet
from sklearn.ensemble import IsolationForest


def mahalanobis_distances(
    reference: NDArray[np.float64], query: NDArray[np.float64], robust: bool = True, seed: int = 0
) -> NDArray[np.float64]:
    """Distances of `query` rows from the reference distribution (robust MCD covariance by default)."""
    reference = np.asarray(reference, dtype=float)
    if reference.shape[0] <= reference.shape[1] + 1:
        raise ValueError("need more reference rows than features to estimate covariance")
    if robust:
        est = MinCovDet(random_state=seed).fit(reference)
        return np.sqrt(est.mahalanobis(np.asarray(query, dtype=float)))
    mu = reference.mean(axis=0)
    inv = np.linalg.pinv(np.cov(reference, rowvar=False))
    d = np.asarray(query, dtype=float) - mu
    return np.sqrt(np.einsum("ij,jk,ik->i", d, inv, d))


def isolation_forest_scores(reference: NDArray[np.float64], query: NDArray[np.float64], seed: int = 0) -> NDArray[np.float64]:
    """Higher = more anomalous (negated sklearn score_samples)."""
    model = IsolationForest(n_estimators=200, random_state=seed).fit(np.asarray(reference, dtype=float))
    return -model.score_samples(np.asarray(query, dtype=float))


def cusum_change_points(x: NDArray[np.float64], target: float, k: float, h: float) -> list[int]:
    """Two-sided tabular CUSUM. `k` is the allowance (often 0.5σ), `h` the decision interval
    (often 4–5σ). Returns indices where an upward or downward shift is signalled (stats reset)."""
    pos = neg = 0.0
    out: list[int] = []
    for i, v in enumerate(np.asarray(x, dtype=float)):
        pos = max(0.0, pos + (v - target) - k)
        neg = max(0.0, neg + (target - v) - k)
        if pos > h or neg > h:
            out.append(i)
            pos = neg = 0.0
    return out
