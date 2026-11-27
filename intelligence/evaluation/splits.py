from __future__ import annotations

from collections.abc import Iterator

import numpy as np
from numpy.typing import NDArray
from sklearn.model_selection import GroupKFold


class LeakageError(AssertionError):
    pass


def assert_no_leakage(train_groups: NDArray[np.str_], test_groups: NDArray[np.str_]) -> None:
    overlap = set(np.unique(train_groups)) & set(np.unique(test_groups))
    if overlap:
        raise LeakageError(f"participants present in both train and test: {sorted(overlap)[:5]}")


def participant_folds(groups: NDArray[np.str_], n_splits: int = 5) -> Iterator[tuple[NDArray[np.int64], NDArray[np.int64]]]:
    """Participant-separated K-fold: every participant's windows are entirely in train or test."""
    unique = np.unique(groups)
    if len(unique) < 2:
        raise ValueError("participant-separated evaluation needs at least two participants")
    k = min(n_splits, len(unique))
    for train, test in GroupKFold(n_splits=k).split(np.zeros(len(groups)), groups=groups):
        assert_no_leakage(groups[train], groups[test])
        yield train, test


def temporal_split(timestamps: NDArray[np.float64], test_fraction: float = 0.25) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    """Train on the earliest observations, test on the latest (no look-ahead)."""
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be in (0, 1)")
    order = np.argsort(timestamps, kind="stable")
    cut = int(round(len(order) * (1 - test_fraction)))
    return order[:cut], order[cut:]
