# Changelog

All notable changes. Versions are not yet released; entries follow the development phases.

## [Unreleased] — Phase 7: production readiness (2026-11-27)

### Added
- Entitlements model (`packages/core/src/entitlements.ts`) with an always-free list covering every
  safety and core feature; route classification (`apps/mobile/config/routeFeatures.ts`) and a test
  that walks every screen. Billing remains disabled.
- Crash-reporting interface with scrubbing and opt-in; no service configured (toggle hidden).
- Static UI copy safety scan with an explicit allow-list of reviewed disclaimers.
- Emergency information link on the Today tab.
- Health data refresh when the app returns to the foreground (at most every 15 minutes).
- GitHub Actions: CI (TypeScript, backend on PostgreSQL with migration up/check/down, intelligence,
  `swift test` on macOS), security (gitleaks, npm audit, pip-audit, bandit), CodeQL.
- Documentation set (architecture, development, watchOS, HealthKit, sensors, ML, validation, science,
  data dictionary, API, schema, security, STRIDE threat model, privacy, safety, testing, deployment,
  App Store checklist, roadmap) and `research/` notes with verified references.

### Changed
- Recovery prediction copy: plain-language outcome ("a morning you rate N/10 or worse overall") and
  a guarded disclaimer; both pass `assertSafeMessage` at runtime and in tests.
- Backend container trusts proxy headers only from `FORWARDED_ALLOW_IPS` (was `*`).
- Backend sources formatted with `ruff format`.

## Phase 6 — recovery modelling (2026-11-27)
- Session features `sf-v1` in TypeScript and Python with exact parity vectors; sleep-night selection
  and overnight physiology rules shared.
- Research pipeline: datasets from app exports, base-rate/logistic/elastic-net/GBDT/ordinal/regression
  models, participant-separated and temporal evaluation, calibration, CIs, missing-data analysis,
  partial-pooling personalization, export manifest with refusal rules.
- App: features stored per session, prediction gate with cold start, every decision logged; flag off,
  no model bundled.

## Phase 5 — gesture research (2026-11-27)
- Signal processing, 106 features, model zoo with abstention, participant-separated evaluation,
  validation gates, registry, Core ML/ONNX export refusals.
- Watch research recorder (foreground 50 Hz Core Motion → JSONL → phone), phone receiver, research
  settings with consent and withdrawal; gesture detector interface that requires a validated model.
- `research_recording` consent type.

## Phase 4 — biometrics and morning recovery (2026-11-27)
- HealthKit provider (read-only), baselines with maturity and freshness, descriptive deviations,
  sleep aggregation, physiology card, morning check-in and reminders, analytics and export/deletion.

## Phase 3 — watchOS companion (2026-11-27)
- SwiftUI watch app with offline store, WatchConnectivity protocol, shared core logic tested against
  vectors, haptic interventions.

## Phase 2 — real-time moderation (2026-11-27)
- Pace engine, intervention engine with policy layer, safety guard and emergency information,
  analytics, optional backend (auth, sync, export, deletion).

## Phase 1 — foundation (2026-11-26)
- Monorepo, alcohol engine with regional standard drinks, encrypted local database, onboarding,
  sessions and manual logging.
