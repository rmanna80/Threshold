# Development

## Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 22 (`.nvmrc`; engines ≥ 20.19) | TypeScript workspaces, Expo |
| npm | 10+ | Workspaces |
| Xcode | 16 or later on macOS | iOS/watchOS builds, `swift test` |
| Python | 3.12+ (CI uses 3.13) | `backend/`, `intelligence/` |
| PostgreSQL | 16 (optional) | Backend tests against Postgres; `docker compose` provides one |
| Apple Developer account | — | Running on devices, HealthKit and App Group entitlements |

## Repository layout

npm workspaces: `apps/mobile`, `packages/*`. Packages export TypeScript source (`main: src/index.ts`),
so there is no build step between packages; Metro and Vitest consume the sources directly.

## Everyday commands

```bash
npm ci
npm run typecheck        # tsc in every workspace
npm run lint             # eslint (React Compiler and hooks rules for the app)
npm test                 # vitest (packages) + jest-expo (mobile, sql.js in-memory DB)
npm run verify           # all three
```

Package tests: `npx vitest run` inside `packages/core`. Mobile tests: `npx jest` inside `apps/mobile`.

## Running the app

Threshold uses native modules (SQLCipher, HealthKit, WatchConnectivity, Vision, the watch target), so
**Expo Go cannot run it**. Use a development build:

```bash
cp .env.example .env            # fill APPLE_TEAM_ID; leave EXPO_PUBLIC_API_URL empty for a local-only app
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios --device       # or open ios/Threshold.xcworkspace in Xcode
npm start                       # Metro for the dev client
```

`expo prebuild` regenerates `apps/mobile/ios/` (git-ignored) including the watch target from
`apps/watch/ThresholdWatch` — see `WATCHOS_SETUP.md`.

### Environment variables

Only `EXPO_PUBLIC_*` values are bundled into the app, so they must never hold secrets.

| Variable | Effect |
| --- | --- |
| `EXPO_PUBLIC_APP_ENV` | `development` / `staging` / `production` |
| `EXPO_PUBLIC_API_URL` | Optional sync API (HTTPS required outside development). Empty → no cloud features |
| `EXPO_PUBLIC_RESEARCH_BUILD` | `1` enables the gesture research recorder screens (internal builds only) |
| `APPLE_TEAM_ID` | Signing team for the app and watch targets |

### Feature flags

`apps/mobile/config/featureFlags.ts`:

| Flag | Default | Meaning |
| --- | --- | --- |
| `gestureAssistedLogging` | `false` | Gesture-assisted logging (needs a validated model) |
| `gestureResearchMode` | `EXPO_PUBLIC_RESEARCH_BUILD` | Research recorder |
| `recoveryPrediction` | `false` | Recovery predictions (needs a validated model) |
| `cloudSync` | API URL set | Cloud sync UI |
| `subscriptions` | `false` | Billing (disabled) |
| `labelScanning` | `true` | Vision label scanning (degrades if the module is missing) |
| `automaticDetectionPrompt` | `false` | Watch gesture prompts |

## Backend

```bash
docker compose up -d db redis
docker compose run --rm migrate            # alembic upgrade head
docker compose up api                      # http://localhost:8000/docs (non-production only)
```

Or locally: `cd backend && pip install -e ".[dev]" && alembic upgrade head && uvicorn app.main:app --reload`.
Tests use SQLite by default; set `TEST_DATABASE_URL=postgresql+psycopg://…` to run them on Postgres.
Lint and types: `ruff check . && ruff format --check . && mypy app`.

## Intelligence

```bash
cd intelligence
pip install -e ".[dev,boosting]"          # add ,deep for torch models, ,export for Core ML/ONNX
pytest && ruff check . && mypy .
python -m threshold_intelligence.training.gesture --synthetic --out /tmp/gesture.json
python -m threshold_intelligence.training.recovery --synthetic --out /tmp/recovery.json
```

Synthetic runs exercise mechanics only; their reports are marked synthetic and can never be
promoted (see `MODEL_VALIDATION.md`).

## Watch core

```bash
cd apps/watch && swift test     # macOS; runs the Shared/ logic against packages/core/test-vectors
```

The views, connectivity, storage and sensor code compile only inside the Xcode watch target.

## Conventions

* TypeScript strict mode with `noUncheckedIndexedAccess`; no `any` in app code.
* All user-facing copy that could make a claim passes `assertSafeMessage` (see `SAFETY.md`).
* New screens must be added to `apps/mobile/config/routeFeatures.ts` (a test enforces it).
* New persisted user data must be added to export (`collectExport`) and deletion
  (`USER_DATA_TABLES`), and documented in `DATA_DICTIONARY.md`.
* Commits: one phase or feature per commit; never commit `.env`, keys or participant data
  (`.gitignore` excludes ML artifacts and raw data directories).
