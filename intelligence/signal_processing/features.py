"""Window feature extraction.

Time domain (per axis + magnitude): mean, std, RMS, variance, min, max, range, mean jerk
magnitude, peak-to-peak timing; cross-axis Pearson correlations.
Frequency domain (per channel): dominant frequency, spectral energy, spectral entropy and band
power in 0–1, 1–3, 3–6 and 6–12 Hz (drinking motions concentrate below ~3 Hz).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]

CHANNELS = ("ax", "ay", "az", "gx", "gy", "gz")
BANDS = ((0.0, 1.0), (1.0, 3.0), (3.0, 6.0), (6.0, 12.0))
_TIME_STATS = ("mean", "std", "rms", "var", "min", "max", "range")


def _corr(a: Array, b: Array) -> float:
    sa, sb = a.std(), b.std()
    if sa < 1e-12 or sb < 1e-12:
        return 0.0
    return float(np.mean((a - a.mean()) * (b - b.mean())) / (sa * sb))


def time_features(w: Array, fs_hz: float) -> dict[str, float]:
    """w: (size, 6) window [user accel xyz (g), rotation rate xyz (rad/s)]."""
    out: dict[str, float] = {}
    acc_mag = np.linalg.norm(w[:, 0:3], axis=1)
    gyro_mag = np.linalg.norm(w[:, 3:6], axis=1)
    cols = {**{c: w[:, i] for i, c in enumerate(CHANNELS)}, "acc_mag": acc_mag, "gyro_mag": gyro_mag}
    for name, v in cols.items():
        out[f"{name}_mean"] = float(v.mean())
        out[f"{name}_std"] = float(v.std())
        out[f"{name}_rms"] = float(np.sqrt(np.mean(v**2)))
        out[f"{name}_var"] = float(v.var())
        out[f"{name}_min"] = float(v.min())
        out[f"{name}_max"] = float(v.max())
        out[f"{name}_range"] = float(v.max() - v.min())
    jerk = np.diff(w[:, 0:3], axis=0) * fs_hz
    out["acc_jerk_mag_mean"] = float(np.linalg.norm(jerk, axis=1).mean()) if len(jerk) else 0.0
    out["acc_mag_argmax_frac"] = float(np.argmax(acc_mag) / max(1, len(acc_mag) - 1))
    for i, j in ((0, 1), (0, 2), (1, 2)):
        out[f"corr_a{'xyz'[i]}{'xyz'[j]}"] = _corr(w[:, i], w[:, j])
        out[f"corr_g{'xyz'[i]}{'xyz'[j]}"] = _corr(w[:, 3 + i], w[:, 3 + j])
    return out


def frequency_features(w: Array, fs_hz: float) -> dict[str, float]:
    out: dict[str, float] = {}
    n = len(w)
    freqs = np.fft.rfftfreq(n, d=1.0 / fs_hz)
    window = np.hanning(n)
    for i, c in enumerate(CHANNELS):
        x = w[:, i] - w[:, i].mean()
        power = np.abs(np.fft.rfft(x * window)) ** 2
        total = float(power[1:].sum())
        out[f"{c}_dom_freq"] = float(freqs[1:][np.argmax(power[1:])]) if total > 1e-12 else 0.0
        out[f"{c}_spec_energy"] = total / n
        p = power[1:] / total if total > 1e-12 else np.zeros_like(power[1:])
        nz = p[p > 0]
        out[f"{c}_spec_entropy"] = float(-(nz * np.log2(nz)).sum() / np.log2(len(p))) if len(p) > 1 and len(nz) else 0.0
        for lo, hi in BANDS:
            mask = (freqs >= lo) & (freqs < hi)
            mask[0] = False
            out[f"{c}_band_{lo:g}_{hi:g}"] = float(power[mask].sum() / total) if total > 1e-12 else 0.0
    return out


def extract_features(w: Array, fs_hz: float) -> dict[str, float]:
    w = np.asarray(w, dtype=float)
    if w.ndim != 2 or w.shape[1] != 6:
        raise ValueError(f"expected (size, 6) window, got {w.shape}")
    if np.isnan(w).any():
        raise ValueError("window contains NaN (invalid gap)")
    return {**time_features(w, fs_hz), **frequency_features(w, fs_hz)}


def _names() -> list[str]:
    return list(extract_features(np.random.default_rng(0).normal(size=(128, 6)), 50.0).keys())


FEATURE_NAMES: list[str] = _names()
