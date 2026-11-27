# Threshold

Personalized physiological and behavioral intelligence for moderating alcohol consumption —
developed by **Comeback Technologies LLC**.

> **Monitor. Understand. Intervene. Recover. Learn.**
>
> Threshold helps adults drink less, pace themselves and understand next-day recovery. It never
> measures blood alcohol, never says whether someone is sober or safe to drive, never defines a
> "safe" amount to drink, and never encourages drinking. Safety features are free and are never
> behind a paywall.

## What is in this repository

| Path | What it is |
| --- | --- |
| `apps/mobile` | iPhone app — Expo SDK 58 / React Native 0.88, Expo Router, encrypted SQLite (SQLCipher), local notifications, HealthKit, WatchConnectivity and Apple Vision native modules |
| `apps/watch` | Native SwiftUI watchOS companion app (generated into the Xcode project by `@bacons/apple-targets`) and a Swift package with the platform-independent core logic |
| `packages/core` | Deterministic TypeScript engines: alcohol math, pace windows, interventions, safety guard, baselines, analytics, sync merge, session features, recovery-model gate, entitlements |
| `packages/shared-types`, `packages/validation`, `packages/design-system` | Domain types, zod schemas, design tokens |
| `packages/core/test-vectors` | JSON vectors shared by the TypeScript, Swift and Python implementations |
| `backend` | Optional FastAPI service: accounts, encrypted sync, export, deletion, consent-gated research uploads (PostgreSQL, Alembic) |
| `intelligence` | Python research pipelines: signal processing, gesture recognition, baselines/anomalies, recovery modelling, personalization, validation gates, model registry |
| `documentation` | Engineering, privacy, safety and science documentation |
| `research` | Literature notes with verified references |

## Quick start

```bash
nvm use                      # Node 22
npm ci
npm run verify               # type-check, lint and test all TypeScript workspaces

# Backend (optional)
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && pytest

# Intelligence (research)
cd intelligence && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev,boosting]" && pytest

# Watch core logic (macOS with Xcode 16+)
cd apps/watch && swift test
```

Running the iPhone and watch apps needs a development build on a Mac with Xcode — see
[DEVELOPMENT.md](documentation/DEVELOPMENT.md) and [WATCHOS_SETUP.md](documentation/WATCHOS_SETUP.md).

## Honest status

Legend: ✅ implemented & tested · 🧪 implemented, not executed in this repository's environment ·
🔬 experimental (behind a flag) · ⌚ requires physical hardware to verify · 📊 requires training
data · 🧾 requires validation · 🍎 platform-restricted · ⛔ not implemented

| Capability | Status | Notes |
| --- | --- | --- |
| Alcohol math (volume × ABV × 0.789), regional standard drinks, unknown-strength drinks | ✅ | TS, Swift and Python checked against the same vectors (Swift runs in macOS CI) |
| Sessions, manual logging, edits, deletes, partial drinks | ✅ | |
| Pace engine (15/30/60/120-min windows, clusters, out-of-order/duplicate handling) | ✅ | |
| Interventions with dedupe, quiet mode, frequency preferences, fatigue-aware rate limits | ✅ | Local notifications; content passes a safety guard |
| Safety centre: poisoning signs, emergency numbers, disclaimers | ✅ | Content follows NIAAA guidance ([research](research/alcohol-physiology.md)) |
| Encrypted local database (SQLCipher) with migrations | ✅ logic / ⌚ encryption | Tests run on sql.js; SQLCipher itself needs a device build |
| Data export (JSON/CSV with formula-injection protection) and delete-all | ✅ | |
| Optional cloud sync (outbox, idempotency, revision merge) and backend API | ✅ | Tested on SQLite and PostgreSQL; no server is deployed |
| Analytics and insights (correlations described as associations only) | ✅ | |
| Apple Watch app (start/end, log full/partial/water, correct, haptics, offline queue) | 🧪 ⌚ | Swift is not compiled in this environment; core logic is covered by `swift test` in macOS CI |
| WatchConnectivity bridge (phone native module + watch manager) | 🧪 ⌚ | Phone-side sync logic is tested with an in-memory transport |
| HealthKit reading (HR, resting HR, HRV SDNN, respiratory rate, sleep, wrist temperature) | 🧪 ⌚ 🍎 | Provider is untested on hardware; read authorisation is hidden by iOS by design |
| Baselines (median/MAD, maturity, freshness) and descriptive deviations | ✅ | |
| Morning check-in and recovery reminders | ✅ | |
| Label scanning (Apple Vision OCR) | 🧪 ⌚ | Parser is tested; OCR needs a device |
| Gesture research recorder (watch → phone JSONL, consent, withdrawal) | 🧪 ⌚ 🔬 | Research builds only (`EXPO_PUBLIC_RESEARCH_BUILD=1`) |
| Gesture recognition models (classical, DTW, optional deep) | ✅ pipeline / 📊 🧾 | Only synthetic data exists; no model is trained on real people |
| Gesture prompts on the watch | 🔬 📊 🧾 ⛔ in this build | Disabled: no validated model ships; prompts would never log a drink |
| Session features (sf-v1), TS ⇄ Python parity | ✅ | |
| Recovery prediction pipeline (base rate, logistic, elastic net, GBDT, ordinal, regression) | ✅ pipeline / 📊 🧾 | Synthetic data only |
| On-device recovery prediction gate and personalization | ✅ / 🔬 | Flag off and no model bundled, so every prediction is withheld with a reason |
| Crash reporting | ✅ interface / ⛔ service | Scrubbing and opt-in implemented; no crash service is configured |
| Subscriptions / StoreKit | ⛔ (by design) | Entitlement architecture exists; billing disabled; safety routes provably never gated |
| CI (TypeScript, backend + PostgreSQL, intelligence, `swift test`, security scans) | ✅ defined | Workflows are committed; their first runs happen on GitHub |
| Deployment, App Store submission | ⛔ | Not performed — requires explicit authorisation ([DEPLOYMENT.md](documentation/DEPLOYMENT.md)) |
| BAC estimation, sobriety or driving assessments | ⛔ (never) | Out of scope permanently ([SAFETY.md](documentation/SAFETY.md)) |

Compliance: Threshold is **not** a medical device, and this repository makes **no** claim of HIPAA,
GDPR, FDA or other regulatory compliance. [PRIVACY.md](documentation/PRIVACY.md) describes what the
code does; legal review is still required.

## Documentation

[Architecture](documentation/ARCHITECTURE.md) ·
[Development](documentation/DEVELOPMENT.md) ·
[watchOS setup](documentation/WATCHOS_SETUP.md) ·
[HealthKit](documentation/HEALTHKIT_INTEGRATION.md) ·
[Sensor processing](documentation/SENSOR_PROCESSING.md) ·
[Machine learning](documentation/MACHINE_LEARNING.md) ·
[Model validation](documentation/MODEL_VALIDATION.md) ·
[Scientific foundations](documentation/SCIENTIFIC_FOUNDATIONS.md) ·
[Data dictionary](documentation/DATA_DICTIONARY.md) ·
[API reference](documentation/API_REFERENCE.md) ·
[Database schema](documentation/DATABASE_SCHEMA.md) ·
[Security](documentation/SECURITY.md) ·
[Threat model](documentation/THREAT_MODEL.md) ·
[Privacy](documentation/PRIVACY.md) ·
[Safety](documentation/SAFETY.md) ·
[Testing](documentation/TESTING.md) ·
[Deployment](documentation/DEPLOYMENT.md) ·
[App Store checklist](documentation/APP_STORE_CHECKLIST.md) ·
[Roadmap](documentation/ROADMAP.md) ·
[Changelog](documentation/CHANGELOG.md) ·
[Implementation plan](documentation/IMPLEMENTATION_PLAN.md)

## If you or someone else is in danger

Threshold cannot detect an emergency. If you think someone may have alcohol poisoning, call your
local emergency number (911 in the US and Canada, 999 or 112 in the UK, 000 in Australia).

© Comeback Technologies LLC. All rights reserved.
