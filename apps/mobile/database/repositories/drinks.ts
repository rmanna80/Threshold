import type { Beverage, DrinkEvent } from '@threshold/shared-types';
import { drinkEventSchema, parseWith } from '@threshold/validation';
import { bool, fromBool, parseJson, type SqlDatabase } from '../types';

interface DrinkRow {
  id: string;
  session_id: string;
  beverage_id: string | null;
  beverage_name: string;
  category: DrinkEvent['category'];
  serving_value: number;
  serving_unit: DrinkEvent['servingInput']['unit'];
  serving_ml: number;
  fraction_consumed: number;
  abv_percent: number | null;
  ethanol_grams: number | null;
  standard_drinks: number | null;
  standard_drink_grams: number;
  is_alcoholic: number;
  consumed_at: number;
  logged_at: number;
  tz_offset_min: number;
  source: DrinkEvent['source'];
  confirmation: DrinkEvent['confirmation'];
  uncertainty_json: string;
  revision: number;
  updated_at: number;
  deleted_at: number | null;
  device_id: string;
}

function toDrink(r: DrinkRow): DrinkEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    beverageId: r.beverage_id,
    beverageName: r.beverage_name,
    category: r.category,
    servingInput: { value: r.serving_value, unit: r.serving_unit },
    servingMl: r.serving_ml,
    fractionConsumed: r.fraction_consumed,
    abvPercent: r.abv_percent,
    ethanolGrams: r.ethanol_grams,
    standardDrinks: r.standard_drinks,
    standardDrinkGrams: r.standard_drink_grams,
    isAlcoholic: fromBool(r.is_alcoholic),
    consumedAt: r.consumed_at,
    loggedAt: r.logged_at,
    tzOffsetMin: r.tz_offset_min,
    source: r.source,
    confirmation: r.confirmation,
    uncertainty: parseJson(r.uncertainty_json, {
      abvKnown: r.abv_percent !== null,
      volumeKnown: true,
      standardDrinksLow: null,
      standardDrinksHigh: null,
      note: null,
    }),
    revision: r.revision,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    deviceId: r.device_id,
  };
}

export class DrinkRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Idempotent, revision-guarded upsert (duplicates and stale edits are ignored). */
  async upsert(drink: DrinkEvent): Promise<boolean> {
    const parsed = parseWith(drinkEventSchema, drink);
    if (!parsed.ok) throw new Error(`Invalid drink event: ${parsed.error}`);
    const d = parsed.value;
    const result = await this.db.runAsync(
      `INSERT INTO drink_events (id, session_id, beverage_id, beverage_name, category, serving_value, serving_unit,
         serving_ml, fraction_consumed, abv_percent, ethanol_grams, standard_drinks, standard_drink_grams, is_alcoholic,
         consumed_at, logged_at, tz_offset_min, source, confirmation, uncertainty_json, revision, updated_at, deleted_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         session_id = excluded.session_id, beverage_id = excluded.beverage_id, beverage_name = excluded.beverage_name,
         category = excluded.category, serving_value = excluded.serving_value, serving_unit = excluded.serving_unit,
         serving_ml = excluded.serving_ml, fraction_consumed = excluded.fraction_consumed, abv_percent = excluded.abv_percent,
         ethanol_grams = excluded.ethanol_grams, standard_drinks = excluded.standard_drinks,
         standard_drink_grams = excluded.standard_drink_grams, is_alcoholic = excluded.is_alcoholic,
         consumed_at = excluded.consumed_at, logged_at = excluded.logged_at, tz_offset_min = excluded.tz_offset_min,
         source = excluded.source, confirmation = excluded.confirmation, uncertainty_json = excluded.uncertainty_json,
         revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
         device_id = excluded.device_id
       WHERE excluded.revision > drink_events.revision
          OR (excluded.revision = drink_events.revision AND excluded.updated_at > drink_events.updated_at)`,
      [
        d.id,
        d.sessionId,
        d.beverageId,
        d.beverageName,
        d.category,
        d.servingInput.value,
        d.servingInput.unit,
        d.servingMl,
        d.fractionConsumed,
        d.abvPercent,
        d.ethanolGrams,
        d.standardDrinks,
        d.standardDrinkGrams,
        bool(d.isAlcoholic),
        d.consumedAt,
        d.loggedAt,
        d.tzOffsetMin,
        d.source,
        d.confirmation,
        JSON.stringify(d.uncertainty),
        d.revision,
        d.updatedAt,
        d.deletedAt,
        d.deviceId,
      ],
    );
    return result.changes > 0;
  }

  async getById(id: string): Promise<DrinkEvent | null> {
    const row = await this.db.getFirstAsync<DrinkRow>('SELECT * FROM drink_events WHERE id = ?', [id]);
    return row ? toDrink(row) : null;
  }

  async listForSession(sessionId: string, includeDeleted = false): Promise<DrinkEvent[]> {
    const rows = await this.db.getAllAsync<DrinkRow>(
      `SELECT * FROM drink_events WHERE session_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
       ORDER BY consumed_at ASC, id ASC`,
      [sessionId],
    );
    return rows.map(toDrink);
  }

  async listBetween(fromMs: number, toMs: number): Promise<DrinkEvent[]> {
    const rows = await this.db.getAllAsync<DrinkRow>(
      `SELECT * FROM drink_events WHERE deleted_at IS NULL AND consumed_at >= ? AND consumed_at < ? ORDER BY consumed_at ASC`,
      [fromMs, toMs],
    );
    return rows.map(toDrink);
  }

  async listAll(includeDeleted = false): Promise<DrinkEvent[]> {
    const rows = await this.db.getAllAsync<DrinkRow>(
      `SELECT * FROM drink_events ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY consumed_at ASC`,
    );
    return rows.map(toDrink);
  }
}

interface BeverageRow {
  id: string;
  name: string;
  category: Beverage['category'];
  serving_value: number;
  serving_unit: Beverage['defaultServing']['unit'];
  abv_percent: number | null;
  is_custom: number;
  abv_varies: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  use_count: number;
}

function toBeverage(r: BeverageRow): Beverage {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    defaultServing: { value: r.serving_value, unit: r.serving_unit },
    abvPercent: r.abv_percent,
    isCustom: fromBool(r.is_custom),
    abvVaries: fromBool(r.abv_varies),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
  };
}

export class BeverageRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(b: Beverage): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO beverages (id, name, category, serving_value, serving_unit, abv_percent, is_custom, abv_varies,
         created_at, updated_at, last_used_at, use_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category,
         serving_value = excluded.serving_value, serving_unit = excluded.serving_unit, abv_percent = excluded.abv_percent,
         is_custom = excluded.is_custom, abv_varies = excluded.abv_varies, updated_at = excluded.updated_at`,
      [
        b.id,
        b.name,
        b.category,
        b.defaultServing.value,
        b.defaultServing.unit,
        b.abvPercent,
        bool(b.isCustom),
        bool(b.abvVaries),
        b.createdAt,
        b.updatedAt,
        b.lastUsedAt,
        b.useCount,
      ],
    );
  }

  async markUsed(id: string, at: number): Promise<void> {
    await this.db.runAsync('UPDATE beverages SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?', [at, id]);
  }

  async getById(id: string): Promise<Beverage | null> {
    const row = await this.db.getFirstAsync<BeverageRow>('SELECT * FROM beverages WHERE id = ?', [id]);
    return row ? toBeverage(row) : null;
  }

  async listRecent(limit = 8): Promise<Beverage[]> {
    const rows = await this.db.getAllAsync<BeverageRow>(
      'SELECT * FROM beverages WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT ?',
      [limit],
    );
    return rows.map(toBeverage);
  }

  async findByName(name: string, category: Beverage['category']): Promise<Beverage | null> {
    const row = await this.db.getFirstAsync<BeverageRow>('SELECT * FROM beverages WHERE name = ? AND category = ? LIMIT 1', [name.trim(), category]);
    return row ? toBeverage(row) : null;
  }

  async listCustom(): Promise<Beverage[]> {
    const rows = await this.db.getAllAsync<BeverageRow>('SELECT * FROM beverages WHERE is_custom = 1 ORDER BY name ASC');
    return rows.map(toBeverage);
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM beverages WHERE id = ?', [id]);
  }
}
