from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from sklearn.base import BaseEstimator, ClassifierMixin


def dtw_distance(a: NDArray[np.float64], b: NDArray[np.float64], band: int | None = None) -> float:
    """Multivariate dynamic time warping distance (Euclidean local cost) with an optional
    Sakoe–Chiba band of half-width `band` samples."""
    n, m = len(a), len(b)
    band = max(n, m) if band is None else max(band, abs(n - m))
    inf = np.inf
    prev = np.full(m + 1, inf)
    prev[0] = 0.0
    for i in range(1, n + 1):
        cur = np.full(m + 1, inf)
        lo, hi = max(1, i - band), min(m, i + band)
        for j in range(lo, hi + 1):
            cost = float(np.linalg.norm(a[i - 1] - b[j - 1]))
            cur[j] = cost + min(prev[j], cur[j - 1], prev[j - 1])
        prev = cur
    return float(prev[m])


class DTWKNNClassifier(ClassifierMixin, BaseEstimator):
    """k-nearest-neighbour classifier over DTW distance on downsampled, z-normalised windows.

    Probabilities are the (distance-weighted) class vote shares among the k neighbours.
    """

    def __init__(self, k: int = 3, band: int = 8, downsample: int = 4, max_templates_per_class: int = 60, random_state: int = 0) -> None:
        self.k = k
        self.band = band
        self.downsample = downsample
        self.max_templates_per_class = max_templates_per_class
        self.random_state = random_state

    def _prep(self, X: NDArray[np.float64]) -> NDArray[np.float64]:
        X = np.asarray(X, dtype=float)[:, :: self.downsample, :]
        mu = X.mean(axis=1, keepdims=True)
        sd = X.std(axis=1, keepdims=True) + 1e-6
        return (X - mu) / sd

    def fit(self, X: NDArray[np.float64], y: NDArray[np.int64]) -> DTWKNNClassifier:
        rng = np.random.default_rng(self.random_state)
        Xp = self._prep(X)
        keep: list[int] = []
        for c in np.unique(y):
            idx = np.flatnonzero(y == c)
            if len(idx) > self.max_templates_per_class:
                idx = rng.choice(idx, self.max_templates_per_class, replace=False)
            keep.extend(idx.tolist())
        self.templates_ = Xp[keep]
        self.template_labels_ = np.asarray(y)[keep]
        self.classes_ = np.unique(y)
        return self

    def predict_proba(self, X: NDArray[np.float64]) -> NDArray[np.float64]:
        Xp = self._prep(X)
        out = np.zeros((len(Xp), len(self.classes_)))
        for i, x in enumerate(Xp):
            d = np.array([dtw_distance(x, t, self.band) for t in self.templates_])
            nn = np.argsort(d)[: self.k]
            w = 1.0 / (d[nn] + 1e-9)
            for lab, wt in zip(self.template_labels_[nn], w, strict=True):
                out[i, np.searchsorted(self.classes_, lab)] += wt
            out[i] /= out[i].sum()
        return out

    def predict(self, X: NDArray[np.float64]) -> NDArray[np.int64]:
        return np.asarray(self.classes_[np.argmax(self.predict_proba(X), axis=1)])
