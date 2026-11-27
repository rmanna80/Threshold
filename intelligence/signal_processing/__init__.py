"""Motion signal processing for wrist-worn IMUs (Apple Watch Core Motion device motion).

Conventions: inputs are (n, 3) arrays in device coordinates; acceleration in g, rotation rate in
rad/s, timestamps in seconds. See documentation/SENSOR_PROCESSING.md for derivations.
"""

from .features import FEATURE_NAMES, extract_features, frequency_features, time_features
from .orientation import KalmanTilt1D, complementary_tilt
from .preprocess import (
    butter_highpass,
    butter_lowpass,
    estimate_gravity,
    fill_gaps,
    jerk,
    magnitude,
    mirror_for_left_wrist,
    resample_uniform,
)
from .segmentation import detect_peaks, energy_segments, sliding_windows

__all__ = [
    "FEATURE_NAMES",
    "KalmanTilt1D",
    "butter_highpass",
    "butter_lowpass",
    "complementary_tilt",
    "detect_peaks",
    "energy_segments",
    "estimate_gravity",
    "extract_features",
    "fill_gaps",
    "frequency_features",
    "jerk",
    "magnitude",
    "mirror_for_left_wrist",
    "resample_uniform",
    "sliding_windows",
    "time_features",
]
