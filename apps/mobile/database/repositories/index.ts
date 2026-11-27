import type { SqlDatabase } from '../types';
import { BeverageRepository, DrinkRepository } from './drinks';
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
  };
}

export { SessionRepository, DrinkRepository, BeverageRepository, SettingsRepository, KvRepository, SyncQueueRepository, ProcessedMessageRepository };
