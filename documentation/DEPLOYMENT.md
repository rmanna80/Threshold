# Deployment

**Nothing has been deployed.** No servers, databases or app builds have been provisioned or
published from this repository, and none should be without explicit authorisation from Comeback
Technologies LLC, because doing so incurs costs and creates obligations (privacy policy, data
processing, support). This document is the runbook for when that authorisation exists.

## iPhone + watch app

1. Apple Developer Program membership; App IDs for the app (`com.comebacktechnologies.threshold`) and
   watch app (`…threshold.watchkitapp`) with HealthKit and the App Group
   `group.com.comebacktechnologies.threshold`.
2. Configure EAS (or Xcode archives): `eas build --platform ios --profile production` after adding an
   `eas.json` with production/preview profiles. Set `EXPO_PUBLIC_APP_ENV=production`, leave
   `EXPO_PUBLIC_RESEARCH_BUILD=0`, and set `EXPO_PUBLIC_API_URL` only if a backend is deployed.
3. Research builds use a separate profile with `EXPO_PUBLIC_RESEARCH_BUILD=1`, distributed through
   TestFlight internal testing to enrolled participants only.
4. Complete `APP_STORE_CHECKLIST.md` before submitting.

## Backend (only if cloud sync is offered)

Requirements: managed PostgreSQL 16 with encryption at rest and automated backups; Redis for rate
limiting; TLS-terminating load balancer; secret manager; log sink that respects the redaction.

```bash
docker build -t threshold-api backend/
# Release step (one-off job) — never at container start:
docker run --rm --env-file prod.env threshold-api alembic upgrade head
# Service:
docker run --env-file prod.env -e FORWARDED_ALLOW_IPS=<load balancer CIDR> -p 8000:8000 threshold-api
```

Required environment (`staging`/`production` refuse to start otherwise):

| Variable | Notes |
| --- | --- |
| `THRESHOLD_ENV` | `production` |
| `THRESHOLD_DATABASE_URL` | `postgresql+psycopg://…` with TLS (`sslmode=require`) |
| `THRESHOLD_JWT_SECRET` | ≥ 32 random bytes from the secret manager |
| `THRESHOLD_FIELD_ENCRYPTION_KEY` | Fernet key from the secret manager |
| `THRESHOLD_REDIS_URL` | Rate-limit store |
| `THRESHOLD_CORS_ORIGINS` | Usually empty (the app is native) |
| `THRESHOLD_RESEARCH_UPLOADS_ENABLED` | `false` unless an approved protocol requires it |
| `FORWARDED_ALLOW_IPS` | Load balancer addresses only — never `*` |

Operational checklist:

* Health check `GET /health`; alert on 5xx rate, latency, 429 spikes, auth failures.
* Backups tested by restoring into a staging database.
* Run `alembic upgrade head` as a release step; roll back by deploying the previous image and
  `alembic downgrade -1` only if the migration is reversible and data loss is acceptable.
* Rotate secrets on a schedule; rotating the JWT secret signs everyone out.
* Pen test before launch; enable GitHub branch protection requiring CI and security workflows.

## Models

A model reaches users only by being bundled in an app release after promotion (see
`MODEL_VALIDATION.md`): commit the exported manifest (and Core ML model for the watch) in the same
release that turns on the corresponding feature flag. Rolling back = shipping a build without the
manifest or with the flag off. `GET /v1/models` mirrors the registry for transparency only; the apps
do not download models.
