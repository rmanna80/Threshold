# Architecture

Threshold is offline-first. The iPhone app's encrypted SQLite database is the source of truth; the
watch keeps its own durable copy of the open session; the backend is optional and only mirrors
records the user chose to sync.

```
┌──────────────── Apple Watch ────────────────┐        ┌──────────────── iPhone ───────────────────────────────┐
│ SwiftUI views                               │        │ Expo Router screens (React Native)                    │
│ WatchSessionModel (@Observable, MainActor)  │        │ zustand stores · TanStack Query                       │
│  ├ Shared/ (AlcoholMath, PaceEngine,        │        │ services/ (DI container)                              │
│  │  InterventionPolicy, SessionLogic,       │        │  ├ SessionService ─ Outbox ─ SyncService ─► backend    │
│  │  WatchProtocol) — tested with swift test │  WC    │  ├ InterventionService ─ NotificationGateway (local)  │
│  ├ WatchStore (JSON file, file protection)  │◄──────►│  ├ HealthService ─ HealthKitProvider (read-only)      │
│  ├ WatchConnectivityManager                 │ app    │  ├ WatchSyncService ─ ThresholdWatch native module    │
│  └ MotionCoordinator (foreground only)      │ ctx /  │  ├ ResearchService ─ research file store              │
│     ├ ResearchRecording (JSONL → phone)     │ user   │  ├ RecoveryPredictionService (features + gate)        │
│     └ GesturePromptEngine (needs validated  │ info / │  └ RecoveryReminderService                            │
│        Core ML model — none ships)          │ files  │ database/ (SQLCipher, migrations, repositories)       │
└─────────────────────────────────────────────┘        │ packages/core (deterministic engines, shared)         │
                                                       └───────────────────────────────────────────────────────┘
                                                                         │ HTTPS (optional)
                                                       ┌─────────────────▼─────────────────────────────────────┐
                                                       │ backend/ FastAPI · PostgreSQL · Redis (rate limits)    │
                                                       │ auth (Argon2id, JWT + rotating refresh) · sync · export │
                                                       │ account deletion · consent-gated research uploads       │
                                                       └─────────────────────────────────────────────────────────┘
intelligence/ (offline research): signal processing → gesture models; app exports → session features →
recovery models → evaluation & validation gates → model registry → export manifests (refused unless validated)
```

## Principles

1. **Deterministic engines live in `packages/core`.** Pure functions with injected time. The same
   behaviour is re-implemented where it must run natively (Swift on the watch, Python for research)
   and all three are checked against JSON vectors in `packages/core/test-vectors`.
2. **Unknown stays unknown.** A drink without a known strength is recorded and counted as a drink but
   contributes no grams; features are `null` rather than imputed; missing Health data shows "no data".
3. **Safety is independent of ML.** Safety content, emergency information and the content guard
   (`packages/core/src/safety.ts`) do not depend on any model, flag or entitlement.
4. **Claims require evidence.** Predictions and gesture prompts are gated on validated models
   (`MODEL_VALIDATION.md`). Feature flags (`apps/mobile/config/featureFlags.ts`) keep experimental
   capabilities off.
5. **Platform-specific code is injected.** `createServices()` receives the database, clock,
   notification gateway, health provider, watch transport, research store and API factory, so the
   same wiring runs on device and in Jest with sql.js and in-memory fakes.

## Mobile app

* **Routing:** Expo Router. `(onboarding)` (eligibility → goals → habits → permissions → privacy)
  and `(tabs)` (Today, Session, Insights, Recovery, Profile), plus modal routes for logging, editing,
  label scanning, check-in, emergency information and settings.
* **State:** `appStore` (preferences, goals, consents), `sessionStore` (open session, drinks,
  interventions), `draftStore` (drink being composed). Server-ish data uses TanStack Query with keys
  invalidated by service events.
* **Persistence:** `database/open.ts` opens `threshold.db` with a random 256-bit key stored in the
  Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Migrations are versioned in
  `database/migrations.ts`. Repositories are thin, typed SQL wrappers.
* **Sessions:** `SessionService` owns lifecycle and logging, writes an outbox entry for every change
  while cloud sync is enabled (enabling sync later backfills the local history) and notifies
  listeners (interventions, watch sync, reminders, feature computation, UI stores).
* **Interventions:** `proposeInterventions` → `applyPolicy` (dedupe → quiet mode → frequency
  preference → caps → fatigue-aware rate limit → priority). Delivered as local notifications and
  in-app cards; watch-origin drinks are evaluated on the watch and recorded on the phone.
* **Native modules:** `modules/threshold-watch` (WatchConnectivity with a durable inbox and research
  file receiver) and `modules/threshold-vision` (Apple Vision text recognition). Both are optional:
  when missing (Expo Go, tests) the app degrades to clearly labelled "unavailable" states.

## Watch app

The watch runs only in the foreground for Threshold's purposes (`HEALTHKIT_INTEGRATION.md`,
`WATCHOS_SETUP.md`). It can start/end an evening, log full or partial drinks and water, correct the
last drink, show pace, and deliver haptic reminders using the same policy as the phone. Records go
to the phone with `transferUserInfo` (queued by the system); the phone answers with its latest state
in the application context. Conflicts are resolved by revision, then `updatedAt`, then device id.

## Sync

Outbox entries carry an idempotency key `entityType:id:revision:op`. The server applies envelopes
in order and acknowledges each as `applied`, `duplicate`, `stale`, `rejected` or `deferred`; pull uses
a monotonic `sync_events.seq` cursor. Server-side, drink payloads are re-checked for consistent
alcohol math and every row is scoped to the authenticated user. See `API_REFERENCE.md`.

## Entitlements

`packages/core/src/entitlements.ts` lists always-free features (logging, sessions, pace,
interventions, goals, safety centre, emergency information, watch app, check-ins, basic insights,
export, deletion, privacy controls). `canUse()` returns true for these in every entitlement state,
including "store unreachable". `apps/mobile/config/routeFeatures.ts` classifies every screen and a
test walks `app/` to ensure safety routes map to always-free features. Billing is disabled
(`featureFlags.subscriptions = false`), so nothing is gated and no purchase UI exists. If billing is
ever enabled, a StoreKit 2 adapter must implement the entitlement state; see `APP_STORE_CHECKLIST.md`.

## Crash reporting

`services/crashReporting.ts` defines a transport interface, a scrubber (drops sensitive keys and
breadcrumb messages, redacts emails, tokens, ids and numbers, strips paths from stacks) and a
reporter that sends only with opt-in consent. The configured transport is a no-op, so no
diagnostics leave the device in this build.

## Research and models

`intelligence/` is an installable package (`threshold_intelligence`). Pipelines write reports that
always start `not_validated`; `training/registry.py::promote` applies validation gates; exports for
the watch (Core ML manifest) and the app (logistic JSON manifest) refuse synthetic or unvalidated
reports. See `MACHINE_LEARNING.md` and `MODEL_VALIDATION.md`.
