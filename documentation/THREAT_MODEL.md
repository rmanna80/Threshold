# Threat model (STRIDE)

Scope: the iPhone app, the watch app, the phone ⇄ watch channel, the optional backend, and the
research pipeline. Data handled is health- and alcohol-related and can be stigmatising, so
**disclosure** is the dominant risk; **misleading output** (a user acting on a wrong number) is
treated as a safety threat alongside classic security threats.

## Assets

1. Drink, session, check-in and intervention records (H)
2. Copies of Health data, baselines, features, predictions (H)
3. Research recordings and study codes (H)
4. Account credentials, tokens, device ids (P/T)
5. Model manifests and safety content (integrity-critical)

## Trust boundaries

* Device storage ↔ other apps / physical access
* iPhone ↔ Apple Watch (WatchConnectivity)
* App ↔ backend (internet)
* Backend ↔ database / Redis / operators
* Research team ↔ participant-shared files
* Build pipeline ↔ dependencies

## Threats and mitigations

| # | STRIDE | Threat | Mitigation | Residual risk / follow-up |
| --- | --- | --- | --- | --- |
| S1 | Spoofing | Stolen access token used against the API | 15-min JWT expiry, issuer/expiry required, HTTPS | Token theft from a compromised device remains possible |
| S2 | Spoofing | Stolen refresh token replayed | Rotation + reuse detection revokes all refresh tokens | Attacker wins the race if they use it first; user must log in again |
| S3 | Spoofing | Credential stuffing on login | Argon2id, auth rate limit, generic errors | No MFA or lockout; add WAF/bot protection before launch |
| S4 | Spoofing | Forged watch messages | WatchConnectivity is limited to the paired, signed companion app; payloads validated; ids deduplicated | Depends on platform pairing security |
| S5 | Spoofing | Spoofed client IP to evade rate limits | Proxy headers trusted only from `FORWARDED_ALLOW_IPS` | Must be configured correctly per deployment |
| T1 | Tampering | Modified drink payload (e.g. negative or inconsistent amounts) | zod/pydantic validation; server alcohol-math check; DB check constraints | — |
| T2 | Tampering | Overwriting newer data with old | Revision → updatedAt → deviceId rule on server, phone and watch | Clock skew affects only equal-revision ties |
| T3 | Tampering | Local DB edited on a jailbroken device | SQLCipher; key in Keychain | A jailbroken, unlocked device is out of scope |
| T4 | Tampering | Malicious or unvalidated model shipped | Export refuses synthetic/unvalidated; runtime status checks; registry promotion requires gate + approver | Signing of manifests is a roadmap item |
| T5 | Tampering | Supply-chain compromise | Lockfiles, `npm audit`, `pip-audit`, CodeQL, gitleaks | Pin GitHub Actions to SHAs before launch |
| R1 | Repudiation | User disputes consent | Append-only consent history with text version, synced and exported | — |
| R2 | Repudiation | Operator actions on the server | Structured logs, export audit table | Central audit log for admin actions not yet built (no admin API exists) |
| I1 | Information disclosure | Lost/stolen phone | iOS data protection + SQLCipher + Keychain `ThisDeviceOnly` | Unlocked device exposes the app like any other |
| I2 | Information disclosure | Backups | Keychain key not restorable to another device; research files excluded from backup | iCloud backup of the encrypted DB is unreadable without the key |
| I3 | Information disclosure | Server breach | Fernet-encrypted payloads; secrets from environment; cascade deletion | Plaintext query columns (times, standard-drink totals, consent types) remain; disk encryption required |
| I4 | Information disclosure | Logs and crash reports | Redacting JSON logger; crash scrubber; no crash service configured | Review any future SDK |
| I5 | Information disclosure | Notifications on lock screen | Neutral titles such as "Pace check"; notification text never includes amounts | Users can hide previews in iOS settings |
| I6 | Information disclosure | Exports shared by mistake | Exports created on demand, sent via share sheet, removed after | User-controlled |
| I7 | Information disclosure | Re-identification of research data | Pseudonymous study codes, no names/emails, minimal metadata, participant-initiated sharing | Motion data may be identifying; protocols must cover this |
| I8 | Information disclosure | Cross-account data access | Every query scoped by user id; tested | — |
| D1 | Denial of service | Large or many sync requests | 2 MB body limit, batch cap, page cap, rate limits | Volumetric attacks need upstream protection |
| D2 | Denial of service | Notification fatigue (user ignores everything) | Frequency preferences, caps, fatigue-aware gaps, quiet mode | Simulated in `intervention_engine/simulate.py`; needs real-world review |
| E1 | Elevation of privilege | Paywall blocking safety features | Always-free list; route classification test; billing disabled | — |
| E2 | Elevation of privilege | Accessing another user's records via ids | Ownership checks in sync; UUIDs; no enumeration endpoints | — |
| X1 | Safety (misleading output) | App implies sobriety, BAC, "safe" amounts or encourages drinking | `assertSafeMessage` guard with forbidden-claim patterns; tests over all catalog messages; no BAC code exists | New copy must be guarded and reviewed |
| X2 | Safety | User trusts a prediction or gesture prompt | Flags off; validated-model gates; cold-start withholding; uncertainty intervals; "not a diagnosis" text | Requires prospective validation before enabling |
| X3 | Safety | Emergency missed because the user relies on the app | Monitoring disclaimer; emergency screen always available offline and free | — |
| X4 | Safety | Minors using the app | Age/eligibility confirmation with country-specific legal drinking age; 17+ rating | Self-attested; cannot be verified |

## Review cadence

Revisit this model when adding a data type, an SDK, a server endpoint, a model, or any feature that
changes what users are told. Record decisions in `CHANGELOG.md`.
