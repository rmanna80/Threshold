from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.signal import find_peaks

Array = NDArray[np.float64]


def sliding_windows(x: Array, size: int, step: int) -> Array:
    """(n, c) → (w, size, c) windows. Windows containing NaN (invalid gaps) are dropped."""
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        x = x[:, None]
    if size <= 0 or step <= 0:
        raise ValueError("size and step must be positive")
    if len(x) < size:
        return np.empty((0, size, x.shape[1]))
    starts = range(0, len(x) - size + 1, step)
    wins = np.stack([x[s : s + size] for s in starts])
    valid = ~np.isnan(wins).any(axis=(1, 2))
    return wins[valid]


def window_starts(n: int, size: int, step: int) -> list[int]:
    return list(range(0, max(0, n - size + 1), step))


def detect_peaks(
    signal: Array, fs_hz: float, min_height: float | None = None, min_separation_s: float = 0.5, prominence: float | None = None
) -> Array:
    idx, _ = find_peaks(
        np.asarray(signal, dtype=float), height=min_height, distance=max(1, int(min_separation_s * fs_hz)), prominence=prominence
    )
    return np.asarray(idx)


def energy_segments(
    signal_mag: Array, fs_hz: float, threshold: float, min_duration_s: float = 0.4, merge_gap_s: float = 0.3
) -> list[tuple[int, int]]:
    """Motion segmentation: contiguous regions where smoothed magnitude exceeds `threshold`.
    Short gaps are merged and short segments dropped. Returns [(start, end_exclusive)]."""
    s = np.asarray(signal_mag, dtype=float)
    k = max(1, int(0.2 * fs_hz))
    smooth = np.convolve(s, np.ones(k) / k, mode="same")
    active = smooth > threshold
    segs: list[tuple[int, int]] = []
    start = None
    for i, a in enumerate(active):
        if a and start is None:
            start = i
        elif not a and start is not None:
            segs.append((start, i))
            start = None
    if start is not None:
        segs.append((start, len(active)))
    merged: list[tuple[int, int]] = []
    for seg in segs:
        if merged and seg[0] - merged[-1][1] <= merge_gap_s * fs_hz:
            merged[-1] = (merged[-1][0], seg[1])
        else:
            merged.append(seg)
    return [g for g in merged if g[1] - g[0] >= min_duration_s * fs_hz]
