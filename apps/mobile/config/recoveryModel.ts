import type { RecoveryModelManifest } from '@threshold/core';

/**
 * The recovery model bundled with this build.
 *
 * `null`: no model has passed validation (see documentation/MODEL_VALIDATION.md), so the app
 * withholds every prediction and says why. A manifest may only be added here after
 * `training.registry.promote` has accepted its report and it was exported with
 * `training.export.export_recovery_manifest`; the app also re-checks `status === "validated"`.
 */
export const BUNDLED_RECOVERY_MODEL: RecoveryModelManifest | null = null;
