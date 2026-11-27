import type { SqlDatabase } from '../types';
import { BeverageRepository, DrinkRepository } from './drinks';
import { CheckinRepository, InterventionRepository } from './interventions';
import { AnomalyRepository, BaselineRepository, MeasurementRepository } from './measurements';
import { SessionRepository } from './sessions';
import { KvRepository, SettingsRepository } from './settings';
import { ProcessedMessageRepository, SyncQueueRepository } from './syncQueue';

export interface Repositories {
  settings: SettingsRepository;
  kv: KvRepository;
  sessions: SessionRepository;
  drinks: DrinkRepository;
  beverages: BeverageRepository;
  syncQueue: SyncQueueRepository;
  processedMessages: ProcessedMessageRepository;
  interventions: InterventionRepository;
  checkins: CheckinRepository;
  measurements: MeasurementRepository;
  baselines: BaselineRepository;
  anomalies: AnomalyRepository;
}

export function createRepositories(db: SqlDatabase): Repositories {
  return {
    settings: new SettingsRepository(db),
    kv: new KvRepository(db),
    sessions: new SessionRepository(db),
    drinks: new DrinkRepository(db),
    beverages: new BeverageRepository(db),
    syncQueue: new SyncQueueRepository(db),
    processedMessages: new ProcessedMessageRepository(db),
    interventions: new InterventionRepository(db),
    checkins: new CheckinRepository(db),
    measurements: new MeasurementRepository(db),
    baselines: new BaselineRepository(db),
    anomalies: new AnomalyRepository(db),
  };
}

export { MeasurementRepository, BaselineRepository, InterventionRepository, CheckinRepository, SessionRepository, DrinkRepository, BeverageRepository, SettingsRepository, KvRepository, SyncQueueRepository, ProcessedMessageRepository };
