# Threshold — Implementation Plan

This plan was written after verifying platform constraints (November 2026). It records the
decisions that shape the codebase and the acceptance criteria used to call each phase done.

## Verified platform constraints

| Area | Finding | Consequence for Threshold |
| --- | --- | --- |
| Expo | Expo SDK 58 is current (React Native 0.88, TypeScript ~6.0). Expo Go cannot load custom native code. | Development builds (`expo-dev-client`, `expo prebuild`) are required. All versions are pinned to SDK 58's `bundledNativeModules.json`. |
| watchOS app | A native watchOS target can be generated at prebuild with `@bacons/apple-targets` (`type: "watch"`), keeping Swift sources outside `ios/`. | Watch app lives in `apps/watch/ThresholdWatch` and is linked via the plugin (`root: ../watch`). |
| watchOS background | Apps run in the foreground except during workout, audio or location sessions, specific extended-runtime session types (self care, mindfulness, physical therapy, smart alarm) and short background refresh tasks. Apple DTS states that using a workout session to extend runtime in a non-workout app risks App Review rejection. | No continuous background motion monitoring. Gesture detection runs only while the watch app is in the foreground. `CMSensorRecorder` (retrospective accelerometer) is documented as a research option. Workout sessions are never used. |
| HealthKit | Read authorization status is hidden from apps; denied types return no samples. HR sampling frequency depends on hardware (newer models sample far more often; older models record background readings minutes apart). HRV is SDNN. | "No samples" is shown as *no data*, never zero. Every reading shows its age. Nothing is labelled real-time. |
| Encryption | `expo-sqlite` supports SQLCipher via config plugin (`useSQLCipher`). `withExclusiveTransactionAsync` opens a separate connection without the key. | Local DB encrypted with a Keychain-held key; only `withTransactionAsync` is used. |
| Notifications | Local notifications via `expo-notifications` work offline. | Interventions are local; no push server needed. |

## Architecture decisions

1. **Deterministic engines in a shared TypeScript package** (`packages/core`): alcohol math, pace
   windows, interventions, goals, baselines, safety guard, analytics, sync merge. Pure functions with
   injected time, tested with Vitest. Swift (watch) and Python (ML) ports are checked against the
   same JSON test vectors (`packages/core/test-vectors`).
2. **Offline-first mobile**: encrypted SQLite is the source of truth; optional cloud sync uses an
   outbox (`sync_queue`) with idempotency keys and revision-guarded upserts.
3. **Safety layer independent of ML**: a content guard rejects any user-facing string implying
   sobriety, driving safety, BAC, guaranteed outcomes or encouragement to drink, and predictions are
   withheld unless a model is registered as `validated`.
4. **Feature flags** isolate experimental capabilities (gesture-assisted logging, recovery
   prediction, subscriptions) — all off by default.

## Phases and acceptance criteria

| Phase | Acceptance criteria |
| --- | --- |
| 1 Foundation | Monorepo builds; strict TS type-check passes; alcohol math matches test vectors; encrypted DB + migrations; onboarding (eligibility, goals, habits, permissions, privacy/consent); preferences & goals persisted; session lifecycle and manual logging implemented with tests. |
| 2 Real-time moderation | Rolling 15/30/60/120-min and session windows; out-of-order/duplicate/edit handling; intervention engine with dedupe, rate limits, quiet mode, priority; active session dashboard; safety/emergency screen; history analytics; backend sync API with tests. |
| 3 Watch | Native SwiftUI watch app: start/end session, log full/partial drink, water, correct, recent beverages; WatchConnectivity with durable queue; haptic interventions; offline storage; Swift core tested against vectors. |
| 4 Biometrics | HealthKit provider (HR, resting HR, HRV, respiratory rate, sleep, wrist temp); robust baselines with maturity; descriptive deviation messages with freshness and alternatives; morning check-in < 30 s. |
| 5 Gesture research | Watch research recorder; signal processing + features with tests; participant-separated training/evaluation for 8 model families; calibration; Core ML export interface; no production claims. |
| 6 Recovery intelligence | Session feature generation (TS/Python parity); outcome collection; transparent models; calibration/Brier/AUROC; hierarchical personalization; model registry with validation gating; cold-start "Insufficient data" behaviour. |
| 7 Production readiness | STRIDE threat model; privacy controls; export (CSV/JSON) and deletion; entitlements architecture with billing disabled; CI workflows; full documentation set with an honest status matrix. |

## Status (2026-11-27)

All seven phases have been implemented and committed. What "implemented" means for each capability —
tested here, needing hardware, needing data, or deliberately disabled — is tracked in the status
matrix in the root `README.md`. Items that require people, devices, data or authorisation are listed
in `ROADMAP.md`.
