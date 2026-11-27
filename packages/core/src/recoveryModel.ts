import { SESSION_FEATURE_NAMES, SESSION_FEATURE_VERSION, type SessionFeatures } from './sessionFeatures';

/**
 * On-device recovery-model evaluation and the prediction gate.
 *
 * A model reaches the app only as a JSON manifest written by
 * intelligence/training/export.py::export_recovery_manifest, which refuses synthetic or
 * unvalidated reports. The app additionally refuses anything whose status is not "validated" or
 * whose feature version differs from the app's. No manifest ships today, so every prediction is
 * withheld with a reason — the app never shows a number without a validated model behind it.
 */

export interface LogisticParts {
  impute_medians: number[];
  indicator_features: number[];
  scaler_mean: number[];
  scaler_scale: number[];
  coef: number[];
  intercept: number;
}

export interface RecoveryModelManifest {
  modelId: string;
  version: string;
  status: string;
  task: 'recovery_risk';
  featureVersion: string;
  features: string[];
  outcome: string | null;
  severityThreshold: number;
  minHistory: number;
  /** Prior SD for on-device partial pooling; null disables personalization. */
  priorSigma: number | null;
  runId: string;
  model: LogisticParts;
  bootstrap: LogisticParts[];
}

export type WithheldReason =
  | 'feature_disabled'
  | 'no_validated_model'
  | 'feature_version_mismatch'
  | 'insufficient_personal_data'
  | 'low_input_quality'
  | 'no_drinks_logged';

export const WITHHELD_MESSAGES: Readonly<Record<WithheldReason, string>> = Object.freeze({
  feature_disabled: 'Recovery predictions are not available in this version of Threshold.',
  no_validated_model: 'No recovery model has passed validation yet, so Threshold does not make predictions.',
  feature_version_mismatch: 'The recovery model does not match this version of the app, so no prediction is shown.',
  insufficient_personal_data: 'Insufficient data for personalized prediction.',
  low_input_quality: 'Not enough information about this evening for a prediction.',
  no_drinks_logged: 'No alcoholic drinks were logged for this session.',
});

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function featureVector(manifest: Pick<RecoveryModelManifest, 'features'>, values: Readonly<Record<string, number | null>>): number[] {
  return manifest.features.map((k) => {
    const v = values[k];
    return v === null || v === undefined ? Number.NaN : v;
  });
}

/** Logit of P(outcome) for one feature vector — mirrors scikit-learn's pipeline exactly. */
export function logisticLogit(parts: LogisticParts, x: readonly number[]): number {
  const imputed = x.map((v, i) => (Number.isNaN(v) ? (parts.impute_medians[i] ?? 0) : v));
  const indicators = parts.indicator_features.map((i) => (Number.isNaN(x[i] ?? Number.NaN) ? 1 : 0));
  const full = [...imputed, ...indicators];
  if (full.length !== parts.coef.length) throw new Error('manifest/feature length mismatch');
  let z = parts.intercept;
  for (let i = 0; i < full.length; i++) {
    const scale = parts.scaler_scale[i] ?? 1;
    z += (((full[i] ?? 0) - (parts.scaler_mean[i] ?? 0)) / (scale === 0 ? 1 : scale)) * (parts.coef[i] ?? 0);
  }
  return z;
}

export function evaluateManifest(manifest: Pick<RecoveryModelManifest, 'features' | 'model'>, values: Readonly<Record<string, number | null>>): number {
  return sigmoid(logisticLogit(manifest.model, featureVector(manifest, values)));
}

/** MAP random-intercept offset under Normal(0, σ²) — twin of personalization.map_offset. */
export function mapOffset(logits: readonly number[], outcomes: readonly number[], sigma: number, iters = 25): number {
  let b = 0;
  for (let k = 0; k < iters; k++) {
    let grad = -b / (sigma * sigma);
    let h = 1 / (sigma * sigma);
    for (let i = 0; i < logits.length; i++) {
      const p = sigmoid((logits[i] ?? 0) + b);
      grad += (outcomes[i] ?? 0) - p;
      h += p * (1 - p);
    }
    const step = grad / h;
    b += step;
    if (Math.abs(step) < 1e-10) break;
  }
  return b;
}

export function isUsableManifest(m: RecoveryModelManifest | null): m is RecoveryModelManifest {
  return m !== null && m.status === 'validated' && m.task === 'recovery_risk';
}

export interface HistoryItem {
  values: Readonly<Record<string, number | null>>;
  severity: number;
}

export type RecoveryDecision =
  | { status: 'withheld'; reason: WithheldReason; message: string }
  | {
      status: 'shown';
      probability: number;
      /** 10th–90th percentile across bootstrap models (model uncertainty), or null. */
      interval: [number, number] | null;
      personalized: boolean;
      message: string;
      outcome: string | null;
    };

function withheld(reason: WithheldReason): RecoveryDecision {
  return { status: 'withheld', reason, message: WITHHELD_MESSAGES[reason] };
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

export function decideRecoveryPrediction(params: {
  enabled: boolean;
  manifest: RecoveryModelManifest | null;
  features: SessionFeatures;
  /** Earlier sessions of THIS user that have a check-in severity (feature values computed at the time). */
  history: readonly HistoryItem[];
}): RecoveryDecision {
  const { manifest, features } = params;
  if (!params.enabled) return withheld('feature_disabled');
  if (!isUsableManifest(manifest)) return withheld('no_validated_model');
  if (manifest.featureVersion !== SESSION_FEATURE_VERSION || features.version !== SESSION_FEATURE_VERSION || manifest.features.join() !== SESSION_FEATURE_NAMES.join()) {
    return withheld('feature_version_mismatch');
  }
  if (params.history.length < manifest.minHistory) return withheld('insufficient_personal_data');
  if (!features.availability.drinks) return withheld('no_drinks_logged');
  if (features.inputQuality === 'low') return withheld('low_input_quality');

  let offset = 0;
  if (manifest.priorSigma !== null && manifest.priorSigma > 0) {
    const logits = params.history.map((h) => logisticLogit(manifest.model, featureVector(manifest, h.values)));
    const ys = params.history.map((h) => (h.severity >= manifest.severityThreshold ? 1 : 0));
    offset = mapOffset(logits, ys, manifest.priorSigma);
  }
  const x = featureVector(manifest, features.values);
  const probability = sigmoid(logisticLogit(manifest.model, x) + offset);
  const boots = manifest.bootstrap.map((b) => sigmoid(logisticLogit(b, x) + offset)).sort((a, b) => a - b);
  const interval: [number, number] | null = boots.length >= 10 ? [quantile(boots, 0.1), quantile(boots, 0.9)] : null;
  return {
    status: 'shown',
    probability,
    interval,
    personalized: offset !== 0,
    outcome: manifest.outcome,
    message: 'A statistical estimate from a validated model, not a diagnosis. It can be wrong, and it says nothing about whether you are safe to drive.',
  };
}
