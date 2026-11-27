from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]


def accel_tilt(acc: Array) -> tuple[Array, Array]:
    """Pitch and roll (radians) from the gravity direction in accelerometer data."""
    ax, ay, az = acc[:, 0], acc[:, 1], acc[:, 2]
    pitch = np.arctan2(-ax, np.sqrt(ay**2 + az**2))
    roll = np.arctan2(ay, az)
    return pitch, roll


def complementary_tilt(acc: Array, gyro: Array, fs_hz: float, alpha: float = 0.98) -> Array:
    """Complementary filter fusing integrated gyroscope rate (short-term) with accelerometer tilt
    (long-term): θ_t = α (θ_{t−1} + ω_t Δt) + (1 − α) θ_acc,t.  Returns (n, 2) [pitch, roll]."""
    if not 0 < alpha < 1:
        raise ValueError("alpha must be in (0, 1)")
    dt = 1.0 / fs_hz
    pitch_acc, roll_acc = accel_tilt(np.asarray(acc, dtype=float))
    out = np.zeros((len(acc), 2))
    if len(acc) == 0:
        return out
    out[0] = [pitch_acc[0], roll_acc[0]]
    for i in range(1, len(acc)):
        # gyro y ~ pitch rate, gyro x ~ roll rate in the device frame (small-angle approximation)
        p = alpha * (out[i - 1, 0] + gyro[i, 1] * dt) + (1 - alpha) * pitch_acc[i]
        r = alpha * (out[i - 1, 1] + gyro[i, 0] * dt) + (1 - alpha) * roll_acc[i]
        out[i] = [p, r]
    return out


@dataclass
class KalmanTilt1D:
    """Two-state (angle, gyro bias) Kalman filter for a single tilt axis.

    State x = [θ, b]; predict θ ← θ + (ω − b)Δt; measure θ_acc. q_* are process noise variances,
    r is the accelerometer measurement noise variance.
    """

    q_angle: float = 1e-3
    q_bias: float = 3e-3
    r_measure: float = 3e-2
    x: Array = field(default_factory=lambda: np.zeros(2))
    p: Array = field(default_factory=lambda: np.eye(2))

    def step(self, rate: float, measured_angle: float, dt: float) -> float:
        a = np.array([[1.0, -dt], [0.0, 1.0]])
        b = np.array([dt, 0.0])
        self.x = a @ self.x + b * rate
        q = np.array([[self.q_angle * dt, 0.0], [0.0, self.q_bias * dt]])
        self.p = a @ self.p @ a.T + q
        h = np.array([1.0, 0.0])
        s = float(h @ self.p @ h + self.r_measure)
        k = (self.p @ h) / s
        self.x = self.x + k * (measured_angle - float(h @ self.x))
        self.p = (np.eye(2) - np.outer(k, h)) @ self.p
        return float(self.x[0])

    def run(self, rates: Array, angles: Array, fs_hz: float) -> Array:
        dt = 1.0 / fs_hz
        self.x = np.array([float(angles[0]), 0.0])
        return np.array([self.step(float(w), float(m), dt) for w, m in zip(rates, angles, strict=True)])
