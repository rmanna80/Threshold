import type {
  Beverage,
  BeverageCategory,
  DataSource,
  DrinkEvent,
  EpochMs,
  Result,
  TzOffsetMin,
  UUID,
  ValidationIssue,
} from '@threshold/shared-types';
import { measureDrink, type DrinkMeasurementInput } from './alcohol';
import { newId } from './ids';

const NON_ALCOHOLIC: ReadonlySet<BeverageCategory> = new Set(['nonalcoholic', 'water']);

export interface BuildDrinkEventParams {
  sessionId: UUID;
  beverage: Pick<Beverage, 'id' | 'name' | 'category'> | { id: null; name: string; category: BeverageCategory };
  measurement: DrinkMeasurementInput;
  consumedAt: EpochMs;
  loggedAt: EpochMs;
  tzOffsetMin: TzOffsetMin;
  source: DataSource;
  deviceId: string;
  id?: UUID;
}

/** True when the record represents alcohol consumption (including unknown-strength drinks). */
export function isAlcoholicDrink(category: BeverageCategory, abvPercent: number | null, ethanol: number | null): boolean {
  if (NON_ALCOHOLIC.has(category)) return (ethanol ?? 0) > 0;
  if (abvPercent === 0) return false;
  return true;
}

export function buildDrinkEvent(params: BuildDrinkEventParams): Result<DrinkEvent> {
  if (params.consumedAt > params.loggedAt + 5 * 60_000) {
    return {
      ok: false,
      errors: [{ field: 'consumedAt', code: 'future_time', message: 'A drink cannot be logged in the future.' }],
    };
  }
  const measured = measureDrink(params.measurement);
  if (!measured.ok) return measured;
  const m = measured.value;
  const event: DrinkEvent = {
    id: params.id ?? newId(),
    sessionId: params.sessionId,
    beverageId: params.beverage.id,
    beverageName: params.beverage.name.trim() || 'Drink',
    category: params.beverage.category,
    servingInput: m.servingInput,
    servingMl: m.servingMl,
    fractionConsumed: m.fractionConsumed,
    abvPercent: m.abvPercent,
    ethanolGrams: m.ethanolGrams,
    standardDrinks: m.standardDrinks,
    standardDrinkGrams: m.standardDrinkGrams,
    isAlcoholic: isAlcoholicDrink(params.beverage.category, m.abvPercent, m.ethanolGrams),
    consumedAt: params.consumedAt,
    loggedAt: params.loggedAt,
    tzOffsetMin: params.tzOffsetMin,
    source: params.source,
    confirmation: m.confirmation,
    uncertainty: m.uncertainty,
    revision: 1,
    updatedAt: params.loggedAt,
    deletedAt: null,
    deviceId: params.deviceId,
  };
  return { ok: true, value: event, warnings: measured.warnings };
}

export interface EditDrinkParams {
  measurement?: DrinkMeasurementInput;
  consumedAt?: EpochMs;
  beverageName?: string;
  now: EpochMs;
  deviceId: string;
}

export function editDrinkEvent(event: DrinkEvent, edit: EditDrinkParams): Result<DrinkEvent> {
  if (event.deletedAt !== null) {
    return { ok: false, errors: [{ field: 'id', code: 'deleted', message: 'This drink was deleted.' }] };
  }
  let next: DrinkEvent = { ...event };
  const warnings: ValidationIssue[] = [];
  if (edit.measurement) {
    const measured = measureDrink(edit.measurement);
    if (!measured.ok) return measured;
    warnings.push(...measured.warnings);
    const m = measured.value;
    next = {
      ...next,
      servingInput: m.servingInput,
      servingMl: m.servingMl,
      fractionConsumed: m.fractionConsumed,
      abvPercent: m.abvPercent,
      ethanolGrams: m.ethanolGrams,
      standardDrinks: m.standardDrinks,
      standardDrinkGrams: m.standardDrinkGrams,
      // Editing is an explicit user action, so a detector-originated record becomes user-owned.
      confirmation: m.confirmation,
      uncertainty: m.uncertainty,
      isAlcoholic: isAlcoholicDrink(event.category, m.abvPercent, m.ethanolGrams),
    };
  }
  if (edit.consumedAt !== undefined) {
    if (edit.consumedAt > edit.now + 5 * 60_000) {
      return { ok: false, errors: [{ field: 'consumedAt', code: 'future_time', message: 'A drink cannot be in the future.' }] };
    }
    next.consumedAt = edit.consumedAt;
  }
  if (edit.beverageName !== undefined && edit.beverageName.trim()) next.beverageName = edit.beverageName.trim();
  next.revision = event.revision + 1;
  next.updatedAt = edit.now;
  next.deviceId = edit.deviceId;
  return { ok: true, value: next, warnings };
}

/** Soft delete (tombstone) so the deletion propagates through sync. */
export function deleteDrinkEvent(event: DrinkEvent, now: EpochMs, deviceId: string): DrinkEvent {
  return { ...event, deletedAt: now, revision: event.revision + 1, updatedAt: now, deviceId };
}

/** Only user-confirmed or user-estimated, non-deleted, alcoholic drinks count toward consumption. */
export function countsTowardConsumption(event: DrinkEvent): boolean {
  return event.deletedAt === null && event.isAlcoholic && event.confirmation !== 'detected_unconfirmed';
}
