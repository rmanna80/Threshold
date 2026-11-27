# App Store checklist

Nothing has been submitted. Complete every item before a first submission.

## Positioning and review guidelines

- [ ] Description, screenshots and keywords present Threshold as a moderation/harm-reduction tool; no
      wording that encourages drinking (guideline 1.4.3 prohibits apps that encourage excessive
      alcohol consumption).
- [ ] No claim of measuring BAC, sobriety, fitness to drive or preventing hangovers anywhere in the
      listing (same rules as `SAFETY.md`).
- [ ] Health claims: none. If any accuracy statement is ever made, the methodology and data must be
      disclosed (guideline 1.4.1); today the app makes no accuracy claims.
- [ ] Age rating questionnaire answered for frequent/intense alcohol references → expected **17+**.
- [ ] Review notes explain: local-first operation, optional sign-in (provide a demo account if cloud
      sync is enabled), how to reach the Emergency screen, that HealthKit is read-only and optional,
      and that the watch app is foreground-only (no background modes are used).

## Privacy

- [ ] Privacy policy URL published and matching `PRIVACY.md`.
- [ ] App Privacy labels: Health & Fitness (drink logs, check-ins, Health copies) — linked to the
      user only if cloud sync is enabled; not used for tracking; no third-party advertising/analytics.
- [ ] HealthKit (guideline 5.1.3): data not used for advertising or sold; not stored in iCloud
      key-value storage; purpose strings accurate. `NSHealthShareUsageDescription` explains reading;
      `NSHealthUpdateUsageDescription` is declared but says Threshold does not write — confirm no
      write types are requested in the final build.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption` is currently `false`. Threshold uses SQLCipher
      for data at rest and HTTPS; confirm the correct classification with counsel before submission.
- [ ] Camera and motion purpose strings accurate; camera used only for label scanning.
- [ ] `PrivacyInfo.xcprivacy` (generated from `app.config.ts` `privacyManifests`) reviewed against
      every SDK in the final binary, including required-reason APIs (UserDefaults, file timestamps).
- [ ] Account deletion available in-app if accounts exist (Cloud sync → Delete account).

## Functionality

- [ ] Every feature in the build works on a reviewer's device without special hardware, or degrades
      with a clear explanation (no watch, no Health data, no camera permission).
- [ ] Research recorder **not** present in App Store builds (`EXPO_PUBLIC_RESEARCH_BUILD=0`).
- [ ] Experimental flags off (`recoveryPrediction`, `gestureAssistedLogging`,
      `automaticDetectionPrompt`), unless a validated model and copy review exist.
- [ ] No placeholder screens or "coming soon" features.
- [ ] Watch app installs from the iPhone app, works offline, and syncs on reconnection.

## Subscriptions (only if billing is ever enabled)

Billing is disabled in this codebase. Before enabling:

- [ ] Products configured in App Store Connect; StoreKit 2 adapter implementing `EntitlementState`
      (`free` / `plus` with expiry / `unknown` when the store is unreachable).
- [ ] A StoreKit Configuration file for local testing (products, renewal, refunds, family sharing).
- [ ] Paywall shows price, period, renewal terms, restore purchases, terms and privacy links.
- [ ] `apps/mobile/tests/entitlements.test.ts` still passes: every safety route maps to an
      always-free feature, and `canUse` returns true for safety features in every state.
- [ ] No safety, logging, emergency, export or deletion feature appears behind the paywall.

## Accessibility and quality

- [ ] VoiceOver, Dynamic Type, contrast (design-system contrast tests pass), reduced motion.
- [ ] Crash-free on the oldest supported devices (iOS 17, watchOS 10).
- [ ] All CI workflows green on the release commit; release notes in `CHANGELOG.md`.
