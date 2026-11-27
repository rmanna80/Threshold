from __future__ import annotations

import numpy as np
import pytest
from threshold_intelligence.signal_processing import (
    FEATURE_NAMES,
    KalmanTilt1D,
    butter_lowpass,
    complementary_tilt,
    detect_peaks,
    energy_segments,
    estimate_gravity,
    extract_features,
    fill_gaps,
    jerk,
    magnitude,
    mirror_for_left_wrist,
    resample_uniform,
    sliding_windows,
)

HZ = 50.0


def test_resample_handles_jitter_and_duplicates() -> None:
    t = np.array([0.0, 0.019, 0.04, 0.04, 0.061, 0.08])
    x = t * 10
    grid, y = resample_uniform(t, x, HZ)
    assert np.allclose(np.diff(grid), 1 / HZ)
    assert np.allclose(y[:, 0], grid * 10)


def test_fill_gaps_marks_long_gaps_invalid() -> None:
    t = np.concatenate([np.arange(0, 1, 0.02), np.arange(1.5, 2.5, 0.02)])
    _, y, valid = fill_gaps(t, np.ones((len(t), 6)), HZ, max_gap_s=0.2)
    assert not valid.all()
    assert np.isnan(y[~valid]).all()
    assert len(sliding_windows(y, 64, 32)) < len(sliding_windows(np.ones_like(y), 64, 32))


def test_butterworth_lowpass_attenuates_high_frequency() -> None:
    t = np.arange(0, 10, 1 / HZ)
    slow = np.sin(2 * np.pi * 1 * t)
    fast = 0.5 * np.sin(2 * np.pi * 20 * t)
    out = butter_lowpass(slow + fast, 5.0, HZ)
    assert np.std(out - slow) < 0.02
    with pytest.raises(ValueError):
        butter_lowpass(slow, 30.0, HZ)


def test_gravity_estimate_and_derivatives() -> None:
    t = np.arange(0, 6, 1 / HZ)
    acc = np.column_stack([0.2 * np.sin(2 * np.pi * 2 * t), np.zeros_like(t), np.ones_like(t)])
    g = estimate_gravity(acc, HZ)
    assert np.allclose(g[50:-50, 2], 1.0, atol=0.02)
    assert np.allclose(magnitude(np.array([[3.0, 4.0, 0.0]])), 5.0)
    assert jerk(np.array([[0.0], [1.0], [3.0]]), 1.0).ravel().tolist() == [1.0, 2.0, 2.0]


def test_left_wrist_mirroring() -> None:
    x = np.array([[1.0, 2.0, 3.0]])
    assert mirror_for_left_wrist(x, "left", "right").tolist() == [[-1.0, -2.0, 3.0]]
    assert mirror_for_left_wrist(x, "left", "left").tolist() == [[1.0, 2.0, 3.0]]
    six = np.array([[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]])
    # 180° rotation about z: accelerometer and gyroscope x/y both flip (matches GestureDetector.swift).
    assert mirror_for_left_wrist(six, "left", "right").tolist() == [[-1.0, -2.0, 3.0, -4.0, -5.0, 6.0]]


def test_orientation_filters_track_tilt() -> None:
    n = 500
    pitch = np.deg2rad(30)
    acc = np.tile([-np.sin(pitch), 0.0, np.cos(pitch)], (n, 1))
    gyro = np.zeros((n, 3))
    tilt = complementary_tilt(acc, gyro, HZ)
    assert tilt[-1, 0] == pytest.approx(pitch, abs=1e-3)
    k = KalmanTilt1D().run(np.zeros(n), np.full(n, pitch), HZ)
    assert k[-1] == pytest.approx(pitch, abs=1e-3)


def test_segmentation_and_peaks() -> None:
    sig = np.zeros(500)
    sig[100:180] = 1.0
    sig[300:340] = 1.0
    segs = energy_segments(sig, HZ, threshold=0.5)
    assert len(segs) == 2
    peaks = detect_peaks(np.sin(2 * np.pi * 1 * np.arange(0, 5, 1 / HZ)), HZ, min_height=0.5)
    assert len(peaks) == 5


def test_feature_extraction_is_deterministic_and_complete() -> None:
    rng = np.random.default_rng(1)
    w = rng.normal(size=(128, 6))
    f1, f2 = extract_features(w, HZ), extract_features(w.copy(), HZ)
    assert f1 == f2
    assert list(f1) == FEATURE_NAMES
    assert all(np.isfinite(v) for v in f1.values())
    t = np.arange(128) / HZ
    sine = np.zeros((128, 6))
    sine[:, 3] = np.sin(2 * np.pi * 2.0 * t)
    f = extract_features(sine, HZ)
    assert f["gx_dom_freq"] == pytest.approx(2.0, abs=0.4)
    assert f["gx_band_1_3"] > 0.8
    with pytest.raises(ValueError):
        extract_features(np.full((128, 6), np.nan), HZ)
