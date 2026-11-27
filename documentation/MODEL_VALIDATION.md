# Model validation

A model may influence what a user sees only after it is **validated**. Validation is a recorded
decision, not a metric: it requires an evaluation report that passes an automated gate *and* a named
human approver. Nothing in the repository is validated today.

## Lifecycle

```
train → report (status: not_validated) → register (status: experimental)
      → promote(report, approved_by) ── gate passes ──► status: validated ──► export manifest ──► bundle in app
                                     └─ gate fails ───► PromotionRefused(reasons)
```

* `intelligence/training/registry.py::register` adds an `experimental` entry to `model_registry.json`.
* `promote` runs `gate_gesture` or `gate_recovery` (`evaluation/validation.py`) on the report with the
  approver's sign-off and only then sets `validated`.
* Exporters (`training/export.py`) refuse synthetic or unvalidated reports; watch exports also require
  `device_v1` preprocessing; app exports require the current feature version.
* The apps re-check the manifest status at runtime (`CoreMLGestureClassifier.loadValidated`,
  `isUsableManifest`), and the corresponding feature flags must also be turned on.

## Gate criteria

These thresholds are **project policy for enabling a feature**, chosen before any data exists. They
are not claims about accuracy or safety, and the study team should review them (and may tighten them)
when a protocol is approved.

### Gesture (`GestureCriteria`)

| Criterion | Requirement |
| --- | --- |
| Data | Real (non-synthetic) recordings; ≥ 30 participants; ≥ 2,000 drinking-like windows |
| Evaluation | Participant-separated (no person in both train and test) |
| Recall | Lower bound of the participant-cluster bootstrap 95 % CI for drinking-like recall ≥ 0.80 |
| False positives | False-positive rate ≤ 5 % |
| Calibration | Expected calibration error ≤ 0.10 |
| Latency | Median inference ≤ 50 ms per window |
| Governance | Ethics approval reference; named approver |

### Recovery (`RecoveryCriteria`)

| Criterion | Requirement |
| --- | --- |
| Data | Real data; ≥ 100 participants; ≥ 1,000 sessions with a check-in outcome |
| Evaluation | Participant-separated **and** temporal validation |
| Skill | Brier skill score vs the base rate ≥ 0.05 for the selected family |
| Calibration | Calibration error ≤ 0.10 |
| Governance | Ethics approval reference; named approver |

## What every report must contain

* Dataset description: synthetic flag, participants, sessions/windows, label or outcome counts,
  sources; outcome definitions (analysis choices) and preprocessing mode.
* Per-family metrics with confidence intervals; the reference model (base rate) alongside.
* Calibration (ECE and reliability curve), not only discrimination.
* Missing-data analysis (recovery): availability rates, outcome missingness and whether drinking
  features differ between sessions with and without check-ins, performance by input quality.
* Personalization comparison (recovery): population vs partially pooled on later sessions; how many
  users were cold-start.
* Warnings (e.g. synthetic data), run id, and later the sign-off block.

## Additional checks before turning a flag on

1. **External / prospective check.** Re-evaluate on participants recruited after the model was
   frozen.
2. **Subgroups.** Report performance by wrist/crown configuration, dominant hand, device model and,
   where collected with consent, age band and sex. A model that fails for a subgroup is not shipped
   for that subgroup.
3. **Copy review.** Every user-facing string goes through `assertSafeMessage` and human review
   (`SAFETY.md`).
4. **Monitoring plan.** `model_predictions` logs every decision on device; any aggregate monitoring
   requires separate consent.
5. **Rollback.** Removing the manifest from the bundle (or turning the flag off) withdraws the
   feature; the app then shows the withheld reason.

## Current state

| Task | Data | Report | Registry | Flag |
| --- | --- | --- | --- | --- |
| Gesture | Synthetic only | Pipeline tested; marked synthetic | Empty | `automaticDetectionPrompt = false`, `gestureAssistedLogging = false` |
| Recovery | Synthetic only | Pipeline tested; marked synthetic | Empty | `recoveryPrediction = false` |
