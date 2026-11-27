# Machine learning

Everything in this document is **research infrastructure**. No model has been trained on data from
real people, none is validated, and none ships in the apps. The pipelines run end to end on clearly
labelled synthetic data so their mechanics are tested; those results say nothing about real-world
performance.

Package: `intelligence/` (installed as `threshold_intelligence`).

## 1. Gesture recognition (drinking-like wrist movement)

**Purpose.** Possibly, in future, prompt "Possible drinking activity detected. Would you like to start
an evening session?" while the watch app is open. A prompt never logs a drink, never estimates
quantity and cannot tell what is in the glass.

**Data.** Labelled recordings from consenting participants via the research recorder
(`SENSOR_PROCESSING.md`). Labels: `drinking_like`, `eating`, `phone_use`, `face_touch`, `walking`,
`talking_gestures`, `sitting`, `exercise`, `other`. Drinking gestures are recorded with water or
non-alcoholic drinks.

**Pipeline** (`training/gesture.py`): load recordings → preprocess (`offline_v1` or `device_v1`) →
2.56 s windows (50 % overlap) → features (106) or raw windows → evaluate each family with
participant-separated GroupKFold → metrics → selection → report.

| Family | Input | Notes |
| --- | --- | --- |
| `logistic_regression` | features | standardised, L2 |
| `random_forest` | features | 200 trees, balanced class weights |
| `svm` | features | RBF, probability outputs |
| `xgboost` | features | optional `boosting` extra; wrapped for contiguous labels |
| `dtw_knn` | raw | dynamic time warping k-NN (Sakoe–Chiba band) |
| `cnn1d`, `tcn`, `gru` | raw `[batch, 6, 128]` | optional `deep` extra (PyTorch); report `not_run` when torch is absent |

**Abstention.** `AbstainingClassifier` returns `UNKNOWN` (−1) when the top probability is below 0.8,
so uncertain windows are not forced into a class; coverage is reported.

**Selection.** Highest drinking-like F1 among families whose false-positive rate is ≤ 5 %, ties broken
by calibration error, latency and model size. Selection produces a *candidate*, never a validated model.

**Export.** `training/export.py::export_coreml` traces a deep model to Core ML (`window [1,6,128]` →
`probabilities`) and `write_watch_manifest` writes `gesture_model_manifest.json`. Both refuse
synthetic, unvalidated or non-`device_v1` reports. On the watch, `CoreMLGestureClassifier.loadValidated()`
loads a model only if the manifest says `validated` with `device_v1` preprocessing, and
`GesturePromptEngine` requires two confident windows ≥ 10 s apart within 3 minutes plus a 30-minute
cool-down before prompting.

## 2. Next-day recovery modelling

**Purpose.** Possibly, in future, show a calibrated estimate of the chance of a harder morning, with
uncertainty — only after validation, only with enough personal history, and never as a
"safe amount".

**Features.** Spec `sf-v1` (`packages/core/src/sessionFeatures.ts` ⇄
`intelligence/recovery_prediction/features.py`, exact parity via
`packages/core/test-vectors/session_features.json`): drink counts, unknown-strength share, known
standard drinks, durations, peak 30/60-minute amounts, timing, weekend night, spirits share, prior
7-day context, sleep after the session, overnight resting-HR delta and HRV robust z. All are known
before the morning check-in, so no outcome information leaks into inputs. Missing values stay null.

**Outcomes** (analysis choices recorded in each report, not clinical cut-offs): `overallSeverity`
0–10 (regression), `moderate_or_worse` = severity ≥ threshold (default 5; binary), and three ordinal
bands (`< 3`, `3 … threshold−1`, `≥ threshold`).

**Data.** Threshold JSON exports shared by consenting participants, one file per participant,
identified by a study code (`recovery_prediction/dataset.py`).

**Models** (`recovery_prediction/models.py`):

| Task | Families |
| --- | --- |
| Binary | `base_rate` (reference), `logistic` (median imputation + missing indicators + standardisation, L2), `elastic_net`, `gbdt` (histogram gradient boosting, native NaN handling) |
| Regression | `mean_baseline` (reference), `ridge`, `gbdt_regressor` |
| Ordinal | Frank & Hall cumulative binary models with monotone correction |

**Evaluation** (`recovery_prediction/evaluate.py`): participant-separated K-fold; temporal holdout
(train on earlier sessions, test on later, with a look-ahead assertion); Brier score and Brier skill
against the base rate; calibration error and reliability curves; AUROC and AUPRC; MAE; ranked
probability score; participant-cluster bootstrap confidence intervals; missing-data analysis.

**Personalization** (`personalization/partial_pooling.py`): random-intercept logistic partial pooling.
The population model (trained on *other* people) gives a logit; each person's offset is the MAP
estimate under a Normal(0, σ²) prior, with σ chosen by Laplace-approximated marginal likelihood. People
with fewer than 5 labelled sessions get no offset (cold start). Severity uses Gaussian shrinkage of
residuals (method-of-moments variance components). Evaluation learns offsets from each person's
earlier half of sessions and scores the later half.

**On-device inference.** Only the `logistic` family is exportable
(`export_recovery_manifest`), because the app reproduces it exactly
(`packages/core/src/recoveryModel.ts`, parity vector `recovery_model.json`). The app's gate withholds a
prediction — and logs why — when the flag is off, no validated manifest is bundled, feature versions
differ, the user has fewer labelled sessions than `minHistory` ("Insufficient data for personalized
prediction."), no drinks were logged, or input quality is low. When shown, the interval is the
10th–90th percentile across bootstrap models.

## 3. Baselines and anomalies

`baseline_engine/robust.py` mirrors the app's robust statistics; `anomaly.py` adds research methods
(Mahalanobis distance with Minimum Covariance Determinant, isolation forest, CUSUM). The app only uses
robust z with maturity rules and describes deviations without attributing causes.

## 4. Intervention simulation

`intervention_engine/simulate.py` replays drink logs (synthetic in tests; consented logs in research)
through a simplified Python port of the pace rules under each frequency preference and counts the
prompts that would be delivered, so notification burden can be studied without sending anyone extra
notifications. Changes to live policy still go through review and the TypeScript tests.

## Experiment tracking and registry

`training/tracking.py` logs to MLflow when installed and `MLFLOW_TRACKING_URI` is set, otherwise to
JSON files under `intelligence/artifacts/runs/` (git-ignored). `model_registry.json` lists registered
models; it is empty. See `MODEL_VALIDATION.md` for promotion.

## Reproducing

```bash
python -m threshold_intelligence.training.gesture --data recordings/ --preprocessing device_v1 --out artifacts/gesture.json
python -m threshold_intelligence.training.recovery --data exports/ --manifest study_codes.json \
    --ethics-ref <approval id> --out artifacts/recovery.json
```

Never commit participant data or trained weights; `.gitignore` excludes `intelligence/artifacts/`,
`intelligence/datasets/raw/`, `intelligence/datasets/participants/` and model file formats.
