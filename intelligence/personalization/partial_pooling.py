"""Personalization by partial pooling (hierarchical shrinkage toward the population model).

Binary outcomes — random-intercept logistic adjustment:
    logit P(y=1 | x, user u) = f(x) + b_u,   b_u ~ Normal(0, σ²)
``f`` is a population model trained on OTHER people; each user's offset ``b_u`` is the MAP
estimate given their own labelled history, so a user with little data stays close to the
population (b_u ≈ 0) and moves away only as evidence accumulates. σ is chosen by maximising the
Laplace-approximated marginal likelihood over a grid.

Continuous outcomes — Gaussian random intercept (one-way random-effects / James–Stein):
    offset_u = n_u τ² / (n_u τ² + s²) · mean residual_u
with τ² and s² estimated by the method of moments.

Cold start: users with fewer than ``min_history`` labelled sessions get no offset and the app
says "Insufficient data for personalized prediction" instead of presenting a personal estimate.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

DEFAULT_MIN_HISTORY = 5
SIGMA_GRID = (0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0)


def _sigmoid(z: NDArray[np.float64]) -> NDArray[np.float64]:
    return 1.0 / (1.0 + np.exp(-z))


def map_offset(logit: NDArray[np.float64], y: NDArray[np.int64], sigma: float, iters: int = 25) -> tuple[float, float]:
    """MAP intercept offset and the negative Hessian at the optimum (Newton's method; concave)."""
    b = 0.0
    h = 1.0 / sigma**2
    for _ in range(iters):
        p = _sigmoid(logit + b)
        grad = float(np.sum(y - p)) - b / sigma**2
        h = float(np.sum(p * (1 - p))) + 1.0 / sigma**2
        step = grad / h
        b += step
        if abs(step) < 1e-10:
            break
    return b, h


def log_marginal(logit: NDArray[np.float64], y: NDArray[np.int64], sigma: float) -> float:
    b, h = map_offset(logit, y, sigma)
    p = np.clip(_sigmoid(logit + b), 1e-12, 1 - 1e-12)
    loglik = float(np.sum(y * np.log(p) + (1 - y) * np.log(1 - p)))
    log_prior = -0.5 * b**2 / sigma**2 - np.log(sigma) - 0.5 * np.log(2 * np.pi)
    return loglik + log_prior + 0.5 * np.log(2 * np.pi) - 0.5 * np.log(h)


@dataclass
class LogisticPartialPooling:
    min_history: int = DEFAULT_MIN_HISTORY
    sigma: float | None = None
    offsets: dict[str, float] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)

    def fit(self, logit: NDArray[np.float64], y: NDArray[np.int64], groups: NDArray[np.str_]) -> LogisticPartialPooling:
        uniq = [g for g in np.unique(groups)]
        by = {g: np.flatnonzero(groups == g) for g in uniq}
        if self.sigma is None:
            scores = [sum(log_marginal(logit[i], y[i], s) for i in by.values()) for s in SIGMA_GRID]
            self.sigma = float(SIGMA_GRID[int(np.argmax(scores))])
        self.offsets, self.counts = {}, {}
        for g, idx in by.items():
            self.counts[str(g)] = len(idx)
            if len(idx) >= self.min_history:
                self.offsets[str(g)] = map_offset(logit[idx], y[idx], self.sigma)[0]
        return self

    def personalized(self, group: str) -> bool:
        return group in self.offsets

    def adjust(self, logit: NDArray[np.float64], groups: Sequence[str]) -> NDArray[np.float64]:
        return np.asarray(logit) + np.asarray([self.offsets.get(str(g), 0.0) for g in groups])


@dataclass
class GaussianPartialPooling:
    min_history: int = DEFAULT_MIN_HISTORY
    tau2: float = 0.0
    s2: float = 1.0
    offsets: dict[str, float] = field(default_factory=dict)

    def fit(self, residual: NDArray[np.float64], groups: NDArray[np.str_]) -> GaussianPartialPooling:
        uniq = np.unique(groups)
        means, ns, within = [], [], []
        for g in uniq:
            r = residual[groups == g]
            means.append(r.mean())
            ns.append(len(r))
            if len(r) > 1:
                within.append(((r - r.mean()) ** 2).sum())
        n_arr = np.asarray(ns, dtype=float)
        dof = n_arr.sum() - len(uniq)
        self.s2 = float(sum(within) / dof) if dof > 0 else float(np.var(residual))
        # Method of moments for the between-user variance (truncated at 0).
        self.tau2 = max(0.0, float(np.var(means, ddof=1) - np.mean(self.s2 / n_arr))) if len(uniq) > 1 else 0.0
        self.offsets = {}
        for g, m, n in zip(uniq, means, ns, strict=True):
            if n >= self.min_history:
                w = n * self.tau2 / (n * self.tau2 + self.s2) if self.tau2 > 0 else 0.0
                self.offsets[str(g)] = float(w * m)
        return self

    def adjust(self, pred: NDArray[np.float64], groups: Sequence[str]) -> NDArray[np.float64]:
        return np.asarray(pred) + np.asarray([self.offsets.get(str(g), 0.0) for g in groups])
