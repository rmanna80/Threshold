# watchOS setup

## How the watch target is built

The watch app's Swift sources live in `apps/watch/ThresholdWatch`. During `expo prebuild`, the
`@bacons/apple-targets` config plugin (configured in `apps/mobile/app.config.ts` with
`root: '../watch', match: 'ThresholdWatch'`) generates a watchOS target inside the iOS Xcode project
using `apps/watch/ThresholdWatch/expo-target.config.js`:

* type `watch`, bundle identifier `<app id>.watchkitapp`, deployment target watchOS 10.0
* frameworks: SwiftUI, WatchConnectivity, UserNotifications, CoreMotion, HealthKit, CoreML
* `Info.plist`: `WKApplication`, `WKCompanionAppBundleIdentifier`, motion and Health usage strings

`apps/watch/Package.swift` builds only `ThresholdWatch/Shared` as the `ThresholdWatchCore` library so
the pure logic can be tested with `swift test` (also run in CI on `macos-15`).

## Build and run

1. Set `APPLE_TEAM_ID` in `.env`; make sure the App Group `group.com.comebacktechnologies.threshold` and
   HealthKit capabilities exist for both bundle ids in the developer portal.
2. `cd apps/mobile && npx expo prebuild --platform ios`
3. Open `ios/Threshold.xcworkspace`, select the **ThresholdWatch** scheme and a paired watch (or a
   watch simulator paired with an iPhone simulator), then Run. Install the iPhone app as well — the
   watch app is a companion and expects the phone to provide goals and preferences.

## What the watch does (and does not do)

* Start/end an evening, log a full or partial drink (recent beverages from the phone), log water,
  correct or delete the last drink, see pace and session totals, receive haptic reminders.
* Works offline: state is saved to a protected JSON file (`WatchStore`) and records queue for the
  phone with `transferUserInfo`; the sync status line shows "Offline · saved on watch" until delivered.
* Uses the same intervention policy as the phone (`Shared/InterventionPolicy.swift`).
* **Foreground only.** watchOS keeps apps running in the background only for specific session types
  (workout, audio, location, and extended-runtime sessions for self care, mindfulness, physical therapy
  and smart alarm). Threshold does not use any of them for monitoring drinking, because doing so would
  misuse those modes. Motion capture and any gesture prompts run only while the app is open.
* Never estimates intoxication, never says someone is fine to drive.

## Research recorder (internal builds)

Visible only when the phone sends `researchRecording: true` in the watch context, which requires a
research build, an enrolled participant (consent + study code) and the recorder switch on. The
participant picks a label and performs the activity with the app open. The recording is written as
JSONL (header, 50 Hz samples, footer) and sent with `transferFile`; the phone stores it only while
the recorder is on and deletes everything on withdrawal. Drinking gestures use water or non-alcoholic
drinks.

## Physical-device testing checklist

Simulators cannot exercise sensors, haptics, real WatchConnectivity timing or file protection. On a
paired iPhone + Apple Watch:

| Area | Test |
| --- | --- |
| Pairing | Install both apps; Profile → Apple Watch shows paired/installed/reachable |
| Context | Change goals on the phone; the watch reflects them within seconds while reachable |
| Offline logging | Airplane mode on the phone; start an evening and log 3 drinks on the watch; reconnect; all 3 appear once on the phone |
| Conflicts | Edit the same drink on both devices while disconnected; reconnect; the higher revision wins on both |
| Concurrent sessions | Start an evening on both devices while disconnected; reconnect; one open session remains |
| Haptics | Log drinks quickly with "standard" frequency; a pace reminder taps once; no repeats within the cool-down |
| Notifications | Lock the watch; reminders arrive as local notifications if permitted |
| Termination | Force-quit the watch app mid-session; reopen; session and queued records persist |
| Research | Research build only: record each label, confirm files arrive on the phone and are deleted from the watch after transfer; withdraw and confirm deletion |
| Motion permission | First recorder start shows the Motion & Fitness prompt; denying shows the "not available" note |
| Accessibility | VoiceOver labels on Start/Log buttons; Dynamic Type at the largest size |

Record device models and OS versions with any results — sampling rates and behaviour differ by model.

## Known limitations

* The Swift sources outside `Shared/` have not been compiled in this repository's environment; the
  first Xcode build may surface compile errors that need fixing.
* Gesture prompts are disabled: no validated Core ML model is bundled.
* WatchConnectivity delivery timing is controlled by the system; there is no guarantee of immediacy.
