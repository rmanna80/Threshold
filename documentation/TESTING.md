# Testing

## Suites

| Suite | Runner | Location | What it covers |
| --- | --- | --- | --- |
| Core engines | Vitest | `packages/core/tests` | Units, alcohol math, standard drinks, sessions, time/labels/goals, pace engine, interventions and safety guard, analytics, baselines, session features, recovery-model gate, entitlements |
| Validation / design system | Vitest | `packages/validation`, `packages/design-system` | Schemas; colour contrast ratios |
| Mobile | Jest (`jest-expo`) with sql.js | `apps/mobile/tests` | Migrations and repositories, session service, app store, interventions and reminders, watch sync, cloud sync against a fake server, health/analytics/export/deletion, research enrolment, recovery prediction service, route entitlements, crash scrubbing, static copy safety |
| Backend | pytest (SQLite or PostgreSQL) | `backend/tests` | Auth (Argon2id, rotation, reuse detection, rate limits, headers, body limits, config refusal), sync (idempotency, stale/deferred/rejected, cross-account isolation, alcohol-math check), export, deletion, research gating |
| Intelligence | pytest | `intelligence/tests` | Consumption parity, signal processing, gesture pipeline (leakage, metrics, DTW, abstention, export refusal, watch-format loader), baselines/anomalies, recovery features parity, recovery pipeline, partial pooling |
| Watch core | XCTest (`swift test`) | `apps/watch/Tests` | Alcohol math and pace vectors, protocol encoding (explicit nulls), conflict merge, intervention policy |

## Cross-language vectors

`packages/core/test-vectors/` is the contract between implementations:

| File | Checked by |
| --- | --- |
| `alcohol.json` | TypeScript, Swift, Python |
| `pace.json` (expected values from an independent naive O(n²) oracle) | TypeScript, Swift, Python |
| `session_features.json` (feature values + hand-computed assembly cases) | TypeScript, Python |
| `recovery_model.json` (scikit-learn probabilities and MAP offset; synthetic fixture) | TypeScript, Python |

Change a vector only together with every implementation, and explain why in the commit.

## Running

```bash
npm test                                         # all TypeScript suites
(cd backend && pytest)                           # SQLite
(cd backend && TEST_DATABASE_URL=postgresql+psycopg://… pytest)
(cd intelligence && pytest)
(cd apps/watch && swift test)                    # macOS
```

CI (`.github/workflows/ci.yml`) runs all of these, plus migration up/check/down on PostgreSQL, lint,
formatting and type checks.

## What automated tests cannot cover

These need people and devices; record results with device models and OS versions.

* **Device builds:** SQLCipher encryption active; Keychain behaviour after restore; HealthKit
  permissions (granted/denied/partial); Vision OCR on real labels; notification delivery and taps.
* **Watch:** the full checklist in `WATCHOS_SETUP.md` (offline logging, conflicts, haptics,
  termination, research transfer).
* **Accessibility:** VoiceOver order and labels on every screen, Dynamic Type at the largest sizes,
  colour contrast in both appearances, reduced motion.
* **Usability:** logging a drink in under 5 seconds on the watch and under 10 on the phone; morning
  check-in under 30 seconds.
* **Copy review:** a person reads every screen for implied claims the guard cannot catch.
* **Models:** prospective validation on newly recruited participants before any flag is enabled.

## Current results (this commit)

All suites above pass in the development environment except the Swift suite, which requires macOS
and runs in CI. The watch app and native modules have not been built in this environment.
