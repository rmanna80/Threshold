# API reference

The backend (`backend/`) is optional. The app works fully offline; the API exists for users who
enable cloud sync. JSON bodies use camelCase. Interactive OpenAPI docs are served at `/docs` outside
production. No server is deployed by this repository.

## Conventions

* **Auth:** `Authorization: Bearer <access token>` (JWT HS256, issuer `threshold-api`, default TTL 15
  minutes). Refresh tokens are opaque, stored hashed (SHA-256), rotated on every use; presenting an
  already-rotated token is treated as theft and revokes all of the user's refresh tokens.
* **Errors:** `{"detail": "…"}` with standard status codes. 401 (missing/invalid token), 403
  (forbidden), 404, 409 (registration conflict, generic message), 413 (body > 2 MB or too many
  envelopes), 422 (validation), 429 (rate limited, with `Retry-After`).
* **Rate limits:** per client IP; authentication routes are stricter (default 10/min) than others
  (default 120/min). Redis-backed when `THRESHOLD_REDIS_URL` is set.
* **Headers on every response:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, a restrictive CSP and, over HTTPS, HSTS.

## Meta

### `GET /health`
`200 {"status": "ok", "version": "0.1.0"}` — also checks database connectivity.

## Auth

### `POST /v1/auth/register`
Body `{ "email", "password" (10–128 chars), "deviceId" }` → `201 TokenResponse`.

### `POST /v1/auth/login`
Body `{ "email", "password", "deviceId" }` → `200 TokenResponse`; `401 "Invalid email or password"`.

### `POST /v1/auth/refresh`
Body `{ "refreshToken", "deviceId"? }` → `200 TokenResponse` (new refresh token; the old one is spent).

### `POST /v1/auth/logout` (auth)
Revokes all of the user's refresh tokens → `204`.

`TokenResponse`: `{ "accessToken", "refreshToken", "tokenType": "bearer", "expiresIn" }`.

## Sync

### `POST /v1/sync/push` (auth)

```json
{
  "deviceId": "…",
  "envelopes": [
    {
      "idempotencyKey": "drink_event:<uuid>:3:upsert",
      "entityType": "drink_event",
      "entityId": "<uuid>",
      "op": "upsert",
      "revision": 3,
      "clientUpdatedAt": 1764291600000,
      "deviceId": "…",
      "payload": { "…": "full record, camelCase" }
    }
  ]
}
```

`entityType` ∈ `drinking_session`, `drink_event`, `recovery_checkin`, `intervention_event`,
`consent_record`, `user_goals`, `user_preferences`. Max 500 envelopes per request (configurable).

Response `{ "acks": [{ "idempotencyKey", "status", "serverRevision", "reason"? }] }` where status is:

| Status | Meaning |
| --- | --- |
| `applied` | Stored |
| `duplicate` | Same idempotency key already processed (safe retry) |
| `stale` | Server has a newer version (revision, then `updatedAt`, then `deviceId`) |
| `rejected` | Invalid payload (schema, ownership, or inconsistent alcohol math — e.g. `standardDrinks` ≠ `ethanolGrams / standardDrinkGrams`) |
| `deferred` | Depends on a record not yet received (e.g. drink before its session); retry later |

### `GET /v1/sync/pull?cursor=<int>&limit=<1..1000>` (auth)
`{ "changes": [{ "seq", "entityType", "entityId", "op", "revision", "payload" }], "nextCursor", "hasMore" }`.
Only the caller's records are ever returned.

## Account

### `GET /v1/account/export` (auth)
All of the user's server-side data: `{ "schemaVersion": 1, "exportedAt", "data": {…} }`. Each export
is logged in `data_export_requests`.

### `DELETE /v1/account` (auth)
Body `{ "password" }` → `204`. Hard delete: the user row and every owned row (cascade). `403` if the
password confirmation fails. The app separately offers deletion of all local data.

## Models

### `GET /v1/models` (auth)
Non-retired model versions: `[{ "modelId", "version", "task", "status" }]`. Empty today.

## Research

### `POST /v1/research/uploads` (auth)
Disabled unless `THRESHOLD_RESEARCH_UPLOADS_ENABLED=true` (`404` otherwise) and the user's latest
`research_upload` consent is granted (`403` otherwise). Body `{ "protocolId", "samples": [1..100000] }`
→ `201 {"id"}`; stored encrypted. **The current app never calls this endpoint** — research
recordings stay on the phone and are shared by the participant manually.
