# Roadmap

Ordered by what unblocks real-world use. Items that need data, hardware, people or authorisation are
marked.

## Next: make the existing build real

1. **First device build** (Mac + Xcode): compile the watch target and native modules, fix compile
   errors, run the `WATCHOS_SETUP.md` and `TESTING.md` manual checklists. ⌚
2. **CI green on GitHub** for all workflows; pin third-party Actions to commit SHAs; enable branch
   protection and Dependabot/Renovate.
3. **Accessibility pass** with VoiceOver and Dynamic Type on device; fix findings.
4. **Copy review** of every screen and notification by someone outside engineering.
5. **Privacy policy, App Store labels and legal review** (`PRIVACY.md`, `APP_STORE_CHECKLIST.md`).

## Research (requires ethics approval, participants and funding)

6. **Gesture study:** protocol, consent materials, recruitment of ≥ 30 participants across wear
   configurations; verify the wrist/crown sign convention on hardware; train with `device_v1`;
   evaluate against `GestureCriteria`; prospective check. 📊 🧾
7. **Recovery study:** collect consented exports with check-ins (≥ 100 participants, ≥ 1,000 labelled
   sessions); evaluate against `RecoveryCriteria` including temporal validation and subgroup
   analysis; review outcome definitions with clinicians. 📊 🧾
8. **Notification burden study** using `intervention_engine/simulate.py` on consented logs.

## Product (after the above)

9. Optional cloud sync launch — only with a deployed, reviewed backend (`DEPLOYMENT.md`).
10. Widgets / complications for quick logging (foreground-safe; no background monitoring).
11. Localisation, including region-specific emergency information and standard-drink defaults.
12. External device provider (e.g. transdermal sensors) behind the existing `external_device`
    measurement type — only with validated devices and clear "not BAC" messaging.

## Engineering debt

* Signed model manifests; MultiFernet key rotation on the backend; MFA for cloud accounts.
* Certificate pinning decision for the API client.
* Migrate the watch to SwiftData if the JSON store becomes a bottleneck (measure first).
* Consider HealthKit background delivery for sleep to refresh features before the user opens the app.

## Not planned (by design)

* BAC estimation, sobriety or driving assessments, "safe limits", drinking games or social features
  that reward consumption, advertising, data sales, background motion monitoring via workout sessions.
