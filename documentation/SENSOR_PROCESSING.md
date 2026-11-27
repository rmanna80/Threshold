# Sensor processing

This covers wrist motion for gesture research. Physiological signals from HealthKit are described in
`HEALTHKIT_INTEGRATION.md`.

## Capture (watch)

`apps/watch/ThresholdWatch/Sensors/MotionRecorder.swift` uses `CMMotionManager` device motion at
**50 Hz**, only while the app is in the foreground (no workout or extended-runtime sessions). Each
sample records Core Motion's timestamp, `userAcceleration` (g, gravity removed), `rotationRate`
(rad/s) and `gravity` (g).

`ResearchRecording.swift` writes JSON Lines:

```json
{"type":"header","recordingId":"…","participantId":"TH-0042","protocolId":"gesture-v1","label":"drinking_like",
 "dominantHand":"right","wrist":"left","crown":"right","deviceModel":"Watch","osVersion":"…","samplingHz":50,"startedAt":1764291600000}
{"t":1234.50,"ax":0.01,"ay":-0.02,"az":0.98,"rx":0.10,"ry":0.10,"rz":-0.05,"gx":0.0,"gy":-0.1,"gz":-0.99}
…
{"type":"footer","samples":3000,"droppedEstimate":2,"endedAt":1764291660000}
```

`droppedEstimate` counts gaps longer than 1.5 sample periods. The format is pinned by
`intelligence/tests/fixtures/watch_recording.jsonl`.

## Processing pipeline (`intelligence/signal_processing`)

| Step | Function | Detail |
| --- | --- | --- |
| Resample | `resample_uniform` | Linear interpolation onto an exact 50 Hz grid |
| Gap handling | `fill_gaps` | Gaps ≤ 200 ms are interpolated; longer gaps become NaN and windows crossing them are dropped |
| Filtering | `butter_lowpass` | 4th-order Butterworth, zero-phase (`sosfiltfilt`), 12 Hz cut-off — offline analysis only |
| Gravity | `estimate_gravity` | Low-pass (0.3 Hz) of total acceleration when Core Motion gravity is unavailable |
| Orientation | `accel_tilt`, `complementary_tilt`, `KalmanTilt1D` | Tilt from the accelerometer, fused with the gyroscope (complementary filter, α = 0.98) or a 2-state Kalman filter |
| Wrist normalisation | `mirror_for_left_wrist` | For left-wrist xor left-crown wear, negate x and y of both accelerometer and gyroscope (180° rotation about z) |
| Windows | `sliding_windows` | 2.56 s (128 samples) with 50 % overlap |
| Features | `extract_features` | 106 features: per-axis mean/std/RMS/variance/min/max/range, magnitude and jerk statistics, inter-axis correlations, and per-axis dominant frequency, spectral energy, spectral entropy and band energies (0–1, 1–3, 3–6, 6–12 Hz) |

Two preprocessing modes exist (`activity_classification/windowing.py`):

* `offline_v1` — includes the zero-phase low-pass; best for offline analysis.
* `device_v1` — resample, gap handling and wrist mirroring only. This is what the watch can reproduce
  exactly on raw samples; models exported to the watch **must** use it (the exporter refuses
  otherwise).

## Known uncertainties

* The wrist/crown sign convention is a geometric assumption and must be verified on hardware for
  each wear configuration before any model relies on it.
* Core Motion delivery can jitter or drop samples under load; the loader reports effective rate,
  dropped estimate and maximum gap for every recording.
* A drinking-like gesture is not evidence of alcohol: water, coffee and eating produce similar
  motion. This is why gesture output can only ever be a *prompt*, never a logged drink.
