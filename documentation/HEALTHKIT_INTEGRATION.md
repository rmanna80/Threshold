# HealthKit integration

Threshold **reads** from Apple Health; it never writes. Access is optional and Threshold works fully
without it.

## Types read

| Kind (`MeasurementKind`) | HealthKit type | Context | Used for |
| --- | --- | --- | --- |
| `heart_rate` | `heartRate` | active/resting as tagged | Session physiology card (recent window only) |
| `resting_heart_rate` | `restingHeartRate` | resting | Baselines, overnight deviation |
| `hrv_sdnn` | `heartRateVariabilitySDNN` | resting | Baselines, overnight robust z |
| `respiratory_rate` | `respiratoryRate` | sleep | Baselines |
| `sleeping_wrist_temperature` | `appleSleepingWristTemperature` | sleep | Baselines (deviation, not absolute temperature) |
| `sleep_asleep` / `sleep_in_bed` / `sleep_awake` | `sleepAnalysis` | sleep | Sleep nights, recovery features |

Implementation: `apps/mobile/services/health/healthkitProvider.ts` (via
`@kingstinct/react-native-healthkit`), orchestration in `healthService.ts`.

## Honest data handling

* **Read authorisation is hidden by iOS.** Apple does not tell apps whether read access was granted;
  denied types simply return no samples, the same as an empty store. Threshold therefore shows
  "no data" (never zero) and explains that sharing may be off or nothing was recorded.
* **Nothing is real-time.** Every reading shows its age. Freshness: *current* ≤ 20 min, *recent*
  ≤ 2 h, otherwise *stale*. Heart-rate sampling frequency depends on the watch model and activity.
* **Baselines** use median and MAD over 28 days with maturity levels (`MATURITY_RULES` in
  `packages/core/src/baselines.ts`; e.g. resting HR: developing at 5 samples on 5 days, established at
  14 on 14). Samples during sessions and the following 12 h are excluded. Immature baselines are
  shown as "building your baseline" and produce no deviations.
* **Deviations are descriptive.** A robust z beyond ±2 is described in plain language with the
  measurement time and alternative explanations (illness, exercise, stress, travel, poor sleep). No
  deviation is attributed to alcohol, and no statement about intoxication is made.
* **Sleep** samples from multiple sources are merged per stage (union of intervals) so time is never
  double counted; nights are keyed by the local wake date.

## Consent and revocation

Turning Apple Health off in Threshold deletes Threshold's local copies of measurements and baselines.
To revoke iOS permission entirely, users go to the Health app's sharing settings; the app links to
iOS Settings and says so.

## Background sync

The app syncs the last 30 days on launch and when returning to the foreground (no HealthKit
background delivery is configured). After a sync, baselines and recent session features are
recomputed.

## Testing

`apps/mobile/tests/healthAnalyticsData.test.ts` uses a fake provider to test idempotent ingestion,
baselines, maturity, freshness and "no consent → no data". The HealthKit provider itself must be
verified on a device: grant some types and deny others, check "no data" states, sleep merging with
multiple sources, and that disabling Health in Threshold removes local copies.
