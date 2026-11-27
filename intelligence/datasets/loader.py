"""Loader for watch research recordings (JSON Lines).

Format written by apps/watch/ThresholdWatch/Sensors/ResearchRecording.swift:
  line 1: {"type":"header", "recordingId", "participantId", "protocolId", "label", "dominantHand",
           "wrist", "crown", "deviceModel", "samplingHz", "startedAt"}
  lines : {"t": seconds, "ax","ay","az" (g), "rx","ry","rz" (rad/s), ...}
  last  : {"type":"footer", "samples", "droppedEstimate", "endedAt"}
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .schema import Recording

_KEYS = ("ax", "ay", "az", "rx", "ry", "rz")


def load_recording(path: str | Path) -> Recording:
    header: dict[str, object] | None = None
    footer: dict[str, object] = {}
    rows: list[list[float]] = []
    times: list[float] = []
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            kind = obj.get("type")
            if kind == "header":
                header = obj
            elif kind == "footer":
                footer = obj
            else:
                try:
                    rows.append([float(obj[k]) for k in _KEYS])
                    times.append(float(obj["t"]))
                except (KeyError, TypeError, ValueError) as exc:
                    raise ValueError(f"{path}:{lineno}: malformed sample") from exc
    if header is None:
        raise ValueError(f"{path}: missing header")
    t = np.asarray(times, dtype=float)
    samples = np.asarray(rows, dtype=float).reshape(-1, 6)
    expected = float(header.get("samplingHz", 50))  # type: ignore[arg-type]
    duration = float(t[-1] - t[0]) if len(t) > 1 else 0.0
    quality = {
        "duration_s": duration,
        "effective_hz": (len(t) - 1) / duration if duration > 0 else 0.0,
        "expected_hz": expected,
        "dropped_estimate": float(footer.get("droppedEstimate", 0)),  # type: ignore[arg-type]
        "max_gap_s": float(np.max(np.diff(t))) if len(t) > 1 else 0.0,
    }
    return Recording(
        recording_id=str(header["recordingId"]),
        participant_id=str(header["participantId"]),
        label=str(header["label"]),
        t=t,
        samples=samples,
        sampling_hz=expected,
        dominant_hand=str(header.get("dominantHand", "right")),
        wrist=str(header.get("wrist", "left")),
        crown=str(header.get("crown", "right")),
        device_model=str(header.get("deviceModel", "unknown")),
        protocol_id=str(header.get("protocolId", "unknown")),
        data_quality=quality,
    )


def load_recordings(directory: str | Path) -> list[Recording]:
    return [load_recording(p) for p in sorted(Path(directory).glob("*.jsonl"))]
