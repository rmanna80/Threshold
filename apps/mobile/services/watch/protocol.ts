import type { DrinkEvent, DrinkingSession, SessionGoalSnapshot, UserPreferences } from '@threshold/shared-types';
import { z } from '@threshold/validation';

/**
 * Phone ⇄ Watch protocol (version 1). WatchConnectivity dictionaries must contain only
 * property-list types (no null), so structured payloads travel as a JSON string under `json`.
 * The Swift side is apps/watch/ThresholdWatch/Connectivity/WatchProtocol.swift.
 */
export const WATCH_PROTOCOL_VERSION = 1;

export interface WatchBeverage {
  id: string;
  name: string;
  category: string;
  servingValue: number;
  servingUnit: string;
  abvPercent: number | null;
}

export interface WatchContext {
  generatedAt: number;
  phoneDeviceId: string;
  activeSession: DrinkingSession | null;
  drinks: DrinkEvent[];
  goals: SessionGoalSnapshot;
  prefs: {
    standardDrinkGrams: number;
    label: string;
    labelPlural: string;
    notificationFrequency: UserPreferences['notificationFrequency'];
    quietMode: boolean;
    unitSystem: UserPreferences['unitSystem'];
    automaticDetectionEnabled: boolean;
    /** Present only in research builds while an enrolled participant has recording switched on. */
    researchRecording?: true;
    participantId?: string;
    dominantHand?: 'left' | 'right';
  };
  beverages: WatchBeverage[];
}

export function encodeContext(ctx: WatchContext): Record<string, string | number> {
  return { v: WATCH_PROTOCOL_VERSION, json: JSON.stringify(ctx) };
}

const inboundSchema = z.object({
  v: z.number().int(),
  id: z.string().min(8).max(64),
  type: z.enum(['records', 'request_context']),
  sentAt: z.number().optional(),
  json: z.string().max(512_000).optional(),
});

const recordsSchema = z.object({
  sessions: z.array(z.unknown()).max(50).default([]),
  drinks: z.array(z.unknown()).max(500).default([]),
});

export type InboundWatchMessage =
  | { id: string; type: 'records'; sessions: unknown[]; drinks: unknown[] }
  | { id: string; type: 'request_context' };

export function decodeInbound(raw: Record<string, unknown>): { ok: true; message: InboundWatchMessage } | { ok: false; error: string; id: string | null } {
  const env = inboundSchema.safeParse(raw);
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!env.success) return { ok: false, error: 'invalid envelope', id };
  if (env.data.v !== WATCH_PROTOCOL_VERSION) return { ok: false, error: `unsupported protocol version ${env.data.v}`, id };
  if (env.data.type === 'request_context') return { ok: true, message: { id: env.data.id, type: 'request_context' } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.data.json ?? '{}');
  } catch {
    return { ok: false, error: 'invalid json', id };
  }
  const body = recordsSchema.safeParse(parsed);
  if (!body.success) return { ok: false, error: 'invalid records body', id };
  return { ok: true, message: { id: env.data.id, type: 'records', sessions: body.data.sessions, drinks: body.data.drinks } };
}
