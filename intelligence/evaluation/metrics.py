from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support


def classification_summary(y_true: NDArray[np.int64], y_pred: NDArray[np.int64], labels: list[int], names: list[str]) -> dict[str, Any]:
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=labels, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=labels + ([-1] if (y_pred == -1).any() else []))
    return {
        "per_class": {
            names[i]: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i]), "support": int(s[i])} for i in range(len(labels))
        },
        "macro_f1": float(np.mean(f)),
        "confusion_matrix": cm.tolist(),
        "confusion_labels": [names[i] for i in range(len(labels))] + (["unknown"] if (y_pred == -1).any() else []),
        "abstained": int((y_pred == -1).sum()),
    }


def binary_metrics(y_true_pos: NDArray[np.bool_], y_pred_pos: NDArray[np.bool_]) -> dict[str, float]:
    """Drinking-like vs everything else. Abstentions count as negative predictions."""
    t = np.asarray(y_true_pos, dtype=bool)
    p = np.asarray(y_pred_pos, dtype=bool)
    tp = int((t & p).sum())
    fp = int((~t & p).sum())
    fn = int((t & ~p).sum())
    tn = int((~t & ~p).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "false_positive_rate": fp / (fp + tn) if fp + tn else 0.0,
        "false_negative_rate": fn / (fn + tp) if fn + tp else 0.0,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }


def brier_score(y_true: NDArray[np.int64], proba: NDArray[np.float64], classes: NDArray[np.int64]) -> float:
    """Multiclass Brier score: mean over samples of Σ_k (p_k − 1[y = k])²."""
    onehot = (np.asarray(y_true)[:, None] == np.asarray(classes)[None, :]).astype(float)
    return float(np.mean(np.sum((np.asarray(proba) - onehot) ** 2, axis=1)))


def expected_calibration_error(confidence: NDArray[np.float64], correct: NDArray[np.bool_], bins: int = 10) -> float:
    """ECE with equal-width confidence bins: Σ_b (n_b / N) |acc_b − conf_b|."""
    confidence = np.asarray(confidence, dtype=float)
    correct = np.asarray(correct, dtype=bool)
    if len(confidence) == 0:
        return 0.0
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (confidence > lo) & (confidence <= hi) if lo > 0 else (confidence >= lo) & (confidence <= hi)
        if m.any():
            ece += m.mean() * abs(correct[m].mean() - confidence[m].mean())
    return float(ece)


def reliability_curve(prob_pos: NDArray[np.float64], y_pos: NDArray[np.bool_], bins: int = 10) -> list[dict[str, float]]:
    prob_pos = np.asarray(prob_pos, dtype=float)
    y_pos = np.asarray(y_pos, dtype=bool)
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (prob_pos >= lo) & (prob_pos < hi if hi < 1 else prob_pos <= hi)
        if m.any():
            out.append(
                {
                    "bin_low": float(lo),
                    "bin_high": float(hi),
                    "mean_predicted": float(prob_pos[m].mean()),
                    "observed_rate": float(y_pos[m].mean()),
                    "count": int(m.sum()),
                }
            )
    return out


def cluster_bootstrap_ci(
    groups: NDArray[np.str_], metric: Callable[[NDArray[np.int64]], float], n_boot: int = 500, alpha: float = 0.05, seed: int = 0
) -> tuple[float, float]:
    """Participant-level (cluster) bootstrap CI: resample participants with replacement, so the
    interval reflects between-person variation rather than treating windows as independent."""
    rng = np.random.default_rng(seed)
    uniq = np.unique(groups)
    by_group = {g: np.flatnonzero(groups == g) for g in uniq}
    stats = []
    for _ in range(n_boot):
        chosen = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([by_group[g] for g in chosen])
        stats.append(metric(idx))
    lo, hi = np.quantile(stats, [alpha / 2, 1 - alpha / 2])
    return float(lo), float(hi)
