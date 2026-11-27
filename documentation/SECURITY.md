# Security

This describes the controls that exist in the code. It is not a certification; an independent
security review and penetration test are recommended before any public release. Threat analysis is
in `THREAT_MODEL.md`. To report a vulnerability, see the repository's root `SECURITY.md`.

## iPhone app

| Control | Implementation |
| --- | --- |
| Data at rest | Entire SQLite database encrypted with SQLCipher; random 256-bit key in the Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). If encryption is unavailable (e.g. a build without SQLCipher) Profile says so instead of implying protection |
| Secrets | No secrets in the bundle; only `EXPO_PUBLIC_*` configuration. API tokens in the Keychain via `expo-secure-store` |
| Transport | HTTPS required for the API outside development (`ApiClient` rejects `http://`); 15 s timeouts; 401 triggers a single refresh attempt |
| Input validation | zod schemas for everything persisted or received (watch messages, sync pulls); malformed watch messages are dropped |
| Exports | Created in the cache directory, shared via the system sheet, deleted afterwards; CSV formula-injection protection |
| Notifications | Local only; a tapped notification can open only an allow-listed screen (check-in or session) |
| Identifiers | Install-scoped random device id; no hardware identifiers, no advertising identifiers, no third-party analytics SDKs |
| Crash reporting | Interface only, no service configured; any future transport receives scrubbed events and only with opt-in |
| Research files | Accepted only while the participant's recorder is on; stored with file protection, excluded from backup; deleted on withdrawal |

## Apple Watch app

State and the outbox are stored in a JSON file with `completeUntilFirstUserAuthentication`
protection. WatchConnectivity payloads are versioned and JSON-encoded; the phone validates every
message and records processed ids so replays change nothing. Research recordings are deleted from the
watch once delivered.

## Backend

| Control | Implementation |
| --- | --- |
| Passwords | Argon2id (`argon2-cffi`), automatic rehash when parameters change |
| Sessions | Short-lived JWT access tokens (HS256, issuer and expiry required); rotating opaque refresh tokens stored as SHA-256 hashes; reuse detection revokes all of the user's refresh tokens; logout revokes all |
| Configuration | `staging`/`production` refuse to start with the default JWT secret, a short secret, or no field-encryption key |
| Field encryption | Synced payloads and research uploads stored as Fernet-encrypted JSON |
| Authorisation | Every query scoped to the authenticated user; sync rejects records owned by another account (tested) |
| Integrity | Server recomputes alcohol math consistency for drink payloads; revision rules prevent overwriting newer data |
| Abuse controls | Per-IP rate limits (stricter on auth), 2 MB body limit, batch size limit, pull page limit |
| Headers | nosniff, frame denial, no-referrer, no-store, restrictive CSP, HSTS over HTTPS; `/docs` disabled in production |
| Proxy trust | Uvicorn trusts `X-Forwarded-*` only from `FORWARDED_ALLOW_IPS` (default 127.0.0.1); never set it to `*` |
| Logging | JSON logs with redaction of tokens, passwords, emails and payload fields |
| Container | Non-root user, slim image, health check; migrations run as a separate release step |
| Deletion | Hard delete with cascade; password re-confirmation required |

## Supply chain and CI

* Lockfile-based installs (`npm ci`); Python dependencies pinned with lower bounds in `pyproject.toml`.
* `.github/workflows/security.yml`: gitleaks secret scan (full history), `npm audit` (production,
  critical), `pip-audit` for backend and intelligence dependencies, `bandit` on the backend.
* `.github/workflows/codeql.yml`: CodeQL for JavaScript/TypeScript and Python.
* Dependabot or Renovate should be enabled on the GitHub repository (repository setting, not code).

## Secrets management

Never commit `.env`. In deployment, inject `THRESHOLD_JWT_SECRET` (≥ 32 random bytes),
`THRESHOLD_FIELD_ENCRYPTION_KEY` (Fernet key) and database/Redis credentials from a secret manager.
Rotating the JWT secret logs everyone out; rotating the Fernet key requires re-encrypting payloads
(MultiFernet support is a roadmap item).

## Known gaps

* No certificate pinning in the app (relies on ATS and system trust).
* Rate limiting is per IP; distributed or credential-stuffing attacks need an upstream WAF.
* No account lockout or MFA on the optional cloud account.
* Field-encryption key rotation is not automated.
* The Swift code and native modules have not been compiled or reviewed on device in this environment.
