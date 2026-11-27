from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.signal import butter, sosfiltfilt

Array = NDArray[np.float64]


def resample_uniform(t: Array, x: Array, hz: float) -> tuple[Array, Array]:
    """Resample irregular timestamps onto a uniform grid by linear interpolation (per column).

    Timestamps must be strictly increasing after de-duplication; duplicate timestamps are dropped
    (first kept). Returns (t_uniform, x_uniform).
    """
    t = np.asarray(t, dtype=float)
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        x = x[:, None]
    if len(t) != len(x):
        raise ValueError("t and x must have the same length")
    if len(t) < 2:
        raise ValueError("need at least two samples to resample")
    order = np.argsort(t, kind="stable")
    t, x = t[order], x[order]
    keep = np.concatenate([[True], np.diff(t) > 0])
    t, x = t[keep], x[keep]
    grid = np.arange(t[0], t[-1] + 1e-12, 1.0 / hz)
    out = np.column_stack([np.interp(grid, t, x[:, k]) for k in range(x.shape[1])])
    return grid, out


def fill_gaps(t: Array, x: Array, hz: float, max_gap_s: float = 0.2) -> tuple[Array, Array, NDArray[np.bool_]]:
    """Resample to `hz`, linearly bridging gaps up to `max_gap_s`; longer gaps are marked invalid
    (NaN) so downstream windowing can discard them instead of trusting interpolated motion."""
    grid, y = resample_uniform(t, x, hz)
    t_sorted = np.sort(np.asarray(t, dtype=float))
    idx = np.searchsorted(t_sorted, grid, side="right")
    prev = t_sorted[np.clip(idx - 1, 0, len(t_sorted) - 1)]
    nxt = t_sorted[np.clip(idx, 0, len(t_sorted) - 1)]
    gap = nxt - prev
    invalid = gap > max_gap_s
    y = y.copy()
    y[invalid] = np.nan
    return grid, y, ~invalid


def _check_cutoff(cutoff_hz: float, fs_hz: float) -> None:
    if not 0 < cutoff_hz < fs_hz / 2:
        raise ValueError(f"cutoff {cutoff_hz} Hz must be in (0, Nyquist={fs_hz / 2} Hz)")


def butter_lowpass(x: Array, cutoff_hz: float, fs_hz: float, order: int = 4) -> Array:
    """Zero-phase Butterworth low-pass (second-order sections, forward–backward)."""
    _check_cutoff(cutoff_hz, fs_hz)
    sos = butter(order, cutoff_hz, btype="low", fs=fs_hz, output="sos")
    return np.asarray(sosfiltfilt(sos, np.asarray(x, dtype=float), axis=0))


def butter_highpass(x: Array, cutoff_hz: float, fs_hz: float, order: int = 4) -> Array:
    _check_cutoff(cutoff_hz, fs_hz)
    sos = butter(order, cutoff_hz, btype="high", fs=fs_hz, output="sos")
    return np.asarray(sosfiltfilt(sos, np.asarray(x, dtype=float), axis=0))


def estimate_gravity(total_acc: Array, fs_hz: float, cutoff_hz: float = 0.3) -> Array:
    """Gravity estimate from total acceleration via a low-pass filter. Core Motion's device motion
    already separates gravity; this is used for raw accelerometer streams (e.g. CMSensorRecorder)."""
    return butter_lowpass(total_acc, cutoff_hz, fs_hz, order=2)


def magnitude(x: Array) -> Array:
    return np.asarray(np.linalg.norm(np.asarray(x, dtype=float), axis=-1))


def jerk(x: Array, fs_hz: float) -> Array:
    """First time-derivative (units per second), same length as input (forward difference padded)."""
    x = np.asarray(x, dtype=float)
    d = np.diff(x, axis=0) * fs_hz
    return np.concatenate([d, d[-1:]], axis=0) if len(d) else np.zeros_like(x)


def mirror_for_left_wrist(x: Array, wrist: str, crown: str = "right") -> Array:
    """Normalise coordinates so left- and right-wrist recordings share one frame.

    Apple Watch's device frame flips relative to the forearm when worn on the opposite wrist or
    with the crown on the other side. We negate the x and y axes — a 180° rotation about z — for
    left-wrist / left-crown wear (exactly one of the two). Because it is a rotation, the same
    transform applies to the gyroscope: for 6-channel input [ax, ay, az, rx, ry, rz] columns
    0, 1, 3 and 4 are negated. GestureDetector.swift applies the identical transform on the watch.
    The sign convention must be verified on hardware for each wear configuration
    (see documentation/SENSOR_PROCESSING.md).
    """
    x = np.asarray(x, dtype=float).copy()
    flips = (wrist == "left") ^ (crown == "left")
    if flips:
        cols = [0, 1, 3, 4] if x.shape[1] >= 6 else [0, 1]
        x[:, cols] *= -1
    return x
