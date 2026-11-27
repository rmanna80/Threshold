"""SYNTHETIC motion data for exercising pipeline mechanics in tests ONLY.

These signals are hand-crafted waveforms, not human data. Any model, metric or report produced
from them is flagged `synthetic=True` and the model registry refuses to validate it. Never use
synthetic results to make claims about real-world gesture recognition performance.
"""

from __future__ import annotations

import numpy as np

from .schema import Recording

SYNTHETIC_MARKER = "SYNTHETIC"


def _waveform(label: str, n: int, hz: float, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(n) / hz
    x = rng.normal(0, 0.02, size=(n, 6))
    if label == "drinking_like":
        # raise (~1 s), hold/tilt (~1.5 s), lower (~1 s): slow, large rotation about one axis
        period = rng.uniform(3.0, 4.5)
        phase = 2 * np.pi * t / period
        x[:, 3] += 1.6 * np.sin(phase)  # wrist rotation
        x[:, 1] += 0.25 * np.sin(phase + 0.4)
        x[:, 2] += 0.15 * np.cos(phase)
    elif label == "walking":
        f = rng.uniform(1.7, 2.1)
        x[:, 0] += 0.35 * np.sin(2 * np.pi * f * t)
        x[:, 2] += 0.25 * np.sin(4 * np.pi * f * t)
        x[:, 4] += 0.6 * np.sin(2 * np.pi * f * t)
    elif label == "eating":
        f = rng.uniform(0.5, 0.8)
        x[:, 3] += 0.8 * np.sin(2 * np.pi * f * t)
        x[:, 0] += 0.1 * np.sin(2 * np.pi * 3 * f * t)
    elif label == "phone_use":
        x[:, 5] += 0.1 * np.sin(2 * np.pi * 0.3 * t)
    elif label == "exercise":
        f = rng.uniform(2.5, 3.5)
        x[:, :3] += 0.8 * np.sin(2 * np.pi * f * t)[:, None]
        x[:, 3:] += 2.0 * np.sin(2 * np.pi * f * t + 1)[:, None]
    else:  # sitting / talking / face_touch / other
        x[:, 3:] += rng.normal(0, 0.1, size=(n, 3))
    return x


def synthetic_recordings(
    participants: int = 6,
    per_label: int = 3,
    labels: tuple[str, ...] = ("drinking_like", "walking", "eating", "phone_use", "sitting"),
    seconds: float = 12.0,
    hz: float = 50.0,
    seed: int = 7,
) -> list[Recording]:
    rng = np.random.default_rng(seed)
    out: list[Recording] = []
    n = int(seconds * hz)
    for p in range(participants):
        gain = rng.uniform(0.8, 1.2)  # per-participant variation
        for label in labels:
            for k in range(per_label):
                out.append(
                    Recording(
                        recording_id=f"{SYNTHETIC_MARKER}-{p}-{label}-{k}",
                        participant_id=f"{SYNTHETIC_MARKER}-P{p:02d}",
                        label=label,
                        t=np.arange(n) / hz,
                        samples=_waveform(label, n, hz, rng) * gain,
                        sampling_hz=hz,
                        protocol_id=SYNTHETIC_MARKER,
                        synthetic=True,
                    )
                )
    return out
