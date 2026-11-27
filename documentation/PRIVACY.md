# Privacy

This document describes what the code does with personal data. It is engineering documentation,
**not a privacy policy and not legal advice**. Threshold does not claim compliance with HIPAA, GDPR,
CCPA or any other regime; a lawyer must review the product, the published privacy policy and the
App Store privacy labels before release.

## Principles in the code

1. **Local first.** Everything works without an account. Data lives in an encrypted database on the
   iPhone and a protected file on the watch.
2. **Opt-in for everything beyond core processing.** Core processing of alcohol and health-related
   data requires explicit consent during onboarding (`health_alcohol_data_processing`); Apple Health,
   notifications, motion, cloud sync, research participation, research recording and crash reporting
   are separate, optional consents with versioned, append-only history.
3. **Minimisation.** No location, contacts, photos library, microphone, advertising identifier,
   third-party analytics or ad SDKs. The camera is used only on the label-scanning screen and images
   are processed on device and not stored. Height/weight are optional and unused by any calculation
   that implies intoxication.
4. **No selling, no advertising use.** Health and alcohol data are never sold or used for
   advertising (also required by App Review guideline 5.1.3 for HealthKit data).
5. **Raw sensor data stays local.** Motion recordings exist only in research builds, stay on the
   phone, and leave it only when the participant shares a file. The app has no code path that uploads
   them; the backend's research endpoint is disabled by default and unused by the app.

## Data flows

| Data | Where it goes | Controls |
| --- | --- | --- |
| Logged drinks, sessions, check-ins, interventions, goals, preferences, consents | Device; optionally the user's cloud account | Cloud sync toggle (off by default; requires an API URL in the build and sign-in) |
| Apple Health copies, baselines, anomalies, session features, predictions | Device only | Turning Health off deletes local copies; delete-all |
| Health readings captured at session start (resting HR, HRV, last night's sleep, each with its time and source) | Stored inside the session record, so they travel with it if cloud sync is on | Same as sessions |
| Watch session state | Watch ↔ paired iPhone | Deleted with the app; records are deduplicated on the phone |
| Research recordings | Watch → paired iPhone; then wherever the participant shares them | Enrol/withdraw; per-file delete; withdrawal deletes all |
| Crash diagnostics | Nowhere in this build | Toggle hidden because no service is configured |

## User rights implemented

* **Access/portability:** Profile → Your data → Everything (JSON) or CSVs for drinks, sessions and
  check-ins. The cloud account has `GET /v1/account/export`.
* **Deletion:** "Delete all local data" erases every local table and research recordings; cloud
  account deletion (`DELETE /v1/account`) hard-deletes all server rows.
* **Withdrawal of consent:** each optional consent can be turned off in Permissions & consent; the
  effects (e.g. local Health copies deleted, research recordings deleted) happen immediately.
* **Rectification:** drinks, sessions and check-ins can be edited or deleted; deletions propagate as
  tombstones when syncing.

## Retention

* On device: until the user deletes it or removes the app.
* Server: until the user deletes the account. Tombstones are kept for synced deletions so other
  devices learn about them; they are removed with the account.
* Research files: until the participant deletes them or withdraws; copies shared with a study team
  are governed by that study's protocol.

## Research

Research participation requires a separate consent screen, a pseudonymous study code supplied by a
study team, and only collects wrist motion with labels, wear configuration and device model. Drinking
gestures are performed with water or non-alcoholic drinks; participants are never asked to drink
alcohol. Studies need ethics approval (the model gates require an approval reference).

## Children

The app asks users to confirm they are of legal drinking age for their country and is intended for a
17+ App Store rating. It is not designed for children and must not be marketed to them.

## Things to complete before release

* Publish a privacy policy matching this document and the App Store privacy "nutrition" labels.
* Complete the `PrivacyInfo.xcprivacy` review for every SDK in the final build.
* Decide the data controller, hosting region and processor agreements if cloud sync is offered.
* Data protection impact assessment for health-related processing.
