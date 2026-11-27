from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

# Must match ActivityLabel in packages/shared-types and the watch research recorder.
ACTIVITY_LABELS: tuple[str, ...] = (
    "drinking_like",
    "eating",
    "phone_use",
    "face_touch",
    "walking",
    "talking_gestures",
    "sitting",
    "exercise",
    "other",
)
DRINKING_LABEL = "drinking_like"


@dataclass
class Recording:
    """One labelled motion recording from the watch research recorder.

    samples: (n, 6) [user acceleration x/y/z in g, rotation rate x/y/z in rad/s]
    t: (n,) seconds (monotonic within the recording)
    """

    recording_id: str
    participant_id: str
    label: str
    t: NDArray[np.float64]
    samples: NDArray[np.float64]
    sampling_hz: float
    dominant_hand: str = "right"
    wrist: str = "left"
    crown: str = "right"
    device_model: str = "unknown"
    protocol_id: str = "unknown"
    beverage_contains_alcohol: bool | None = None
    data_quality: dict[str, float] = field(default_factory=dict)
    synthetic: bool = False

    def __post_init__(self) -> None:
        if self.label not in ACTIVITY_LABELS:
            raise ValueError(f"unknown activity label {self.label!r}")
        if self.samples.ndim != 2 or self.samples.shape[1] != 6:
            raise ValueError("samples must be (n, 6)")
        if len(self.t) != len(self.samples):
            raise ValueError("t and samples length differ")
