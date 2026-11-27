from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from ..datasets.schema import ACTIVITY_LABELS, Recording
from ..signal_processing.features import FEATURE_NAMES, extract_features
from ..signal_processing.preprocess import butter_lowpass, fill_gaps, mirror_for_left_wrist
from ..signal_processing.segmentation import sliding_windows

DEFAULT_HZ = 50.0
WINDOW_S = 2.56  # 128 samples at 50 Hz
STEP_S = 1.28  # 50% overlap
#: offline_v1 — resample, bridge short gaps, zero-phase 12 Hz low-pass, wrist mirror (offline analysis).
#: device_v1  — resample, bridge short gaps, wrist mirror only. Reproducible on the watch, which sees
#:              raw ~50 Hz samples and cannot run a zero-phase filter; required for watch export.
PREPROCESSING_MODES = ("offline_v1", "device_v1")


@dataclass
class WindowedDataset:
    raw: NDArray[np.float64]  # (w, size, 6) normalised windows (for DTW / deep models)
    features: NDArray[np.float64]  # (w, f)
    labels: NDArray[np.int64]  # index into ACTIVITY_LABELS
    groups: NDArray[np.str_]  # participant id per window (for participant-separated splits)
    recording_ids: NDArray[np.str_]
    feature_names: list[str]
    synthetic: bool
    preprocessing: str = "offline_v1"

    def __len__(self) -> int:
        return len(self.labels)


def preprocess(rec: Recording, hz: float = DEFAULT_HZ, mode: str = "offline_v1") -> NDArray[np.float64]:
    """Resample → bridge short gaps (long gaps become NaN) → [low-pass at 12 Hz] → wrist mirror."""
    if mode not in PREPROCESSING_MODES:
        raise ValueError(f"unknown preprocessing mode {mode!r}")
    _, x, _ = fill_gaps(rec.t, rec.samples, hz)
    valid = ~np.isnan(x).any(axis=1)
    if mode == "offline_v1" and valid.sum() > 20:
        filtered = x.copy()
        filtered[valid] = butter_lowpass(x[valid], 12.0, hz)
        x = filtered
    return mirror_for_left_wrist(x, rec.wrist, rec.crown)


def window_recordings(
    recordings: list[Recording],
    hz: float = DEFAULT_HZ,
    window_s: float = WINDOW_S,
    step_s: float = STEP_S,
    preprocessing: str = "offline_v1",
) -> WindowedDataset:
    size, step = int(round(window_s * hz)), int(round(step_s * hz))
    raw, feats, labels, groups, rids = [], [], [], [], []
    for rec in recordings:
        wins = sliding_windows(preprocess(rec, hz, preprocessing), size, step)
        for w in wins:
            raw.append(w)
            feats.append([extract_features(w, hz)[n] for n in FEATURE_NAMES])
            labels.append(ACTIVITY_LABELS.index(rec.label))
            groups.append(rec.participant_id)
            rids.append(rec.recording_id)
    if not raw:
        raise ValueError("no valid windows produced")
    return WindowedDataset(
        raw=np.asarray(raw),
        features=np.asarray(feats, dtype=float),
        labels=np.asarray(labels, dtype=np.int64),
        groups=np.asarray(groups),
        recording_ids=np.asarray(rids),
        feature_names=list(FEATURE_NAMES),
        synthetic=any(r.synthetic for r in recordings),
        preprocessing=preprocessing,
    )
