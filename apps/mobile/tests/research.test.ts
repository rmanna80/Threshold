import { decodeInbound } from '../services/watch/protocol';
import { createHarness } from './support/harness';

const file = (id: string) => ({ id, uri: `file:///r/${id}.jsonl`, bytes: 1200, label: 'drinking_like', participantId: 'TH-0042', protocolId: 'gesture-v1', startedAt: 1 });

function lastContextPrefs(contexts: Record<string, unknown>[]) {
  const last = contexts.at(-1);
  if (!last) throw new Error('no context pushed');
  return (JSON.parse(String(last.json)) as { prefs: Record<string, unknown> }).prefs;
}

describe('gesture research enrolment', () => {
  it('is unavailable outside research builds and leaves the watch recorder hidden', async () => {
    const h = await createHarness({ researchEnabled: false });
    await expect(h.services.research.enroll('TH-0042', 'right')).rejects.toThrow(/not available/);
    expect(h.services.research.watchPrefs()).toBeNull();
  });

  it('rejects identifying or malformed participant codes', async () => {
    const h = await createHarness({ researchEnabled: true });
    await expect(h.services.research.enroll('jane@example.com', 'left')).rejects.toThrow(/study code/);
    await expect(h.services.research.enroll('ab', 'left')).rejects.toThrow(/study code/);
  });

  it('records consent, then exposes the recorder to the watch only once recording is enabled', async () => {
    const h = await createHarness({ researchEnabled: true });
    h.services.watchSync.start();
    await h.services.research.enroll(' TH-0042 ', 'left');
    const consents = await h.services.repos.settings.consentHistory();
    expect(consents.some((c) => c.type === 'research_recording' && c.granted)).toBe(true);
    expect(h.services.research.watchPrefs()).toBeNull();
    expect(h.research.accepting).toBe(false);

    await h.services.research.setRecordingEnabled(true);
    expect(h.research.accepting).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(lastContextPrefs(h.watch.contexts)).toMatchObject({ researchRecording: true, participantId: 'TH-0042', dominantHand: 'left' });
  });

  it('discards files that arrive while recording is off', async () => {
    const h = await createHarness({ researchEnabled: true });
    await h.services.research.enroll('TH-0042', 'right');
    h.research.receive(file('00000000-0000-4000-8000-000000000001'));
    expect(await h.services.research.list()).toHaveLength(0);
    await h.services.research.setRecordingEnabled(true);
    h.research.receive(file('00000000-0000-4000-8000-000000000002'));
    expect(await h.services.research.list()).toHaveLength(1);
  });

  it('withdrawal deletes every recording, stops accepting and records the revocation', async () => {
    const h = await createHarness({ researchEnabled: true });
    h.services.watchSync.start();
    await h.services.research.enroll('TH-0042', 'right');
    await h.services.research.setRecordingEnabled(true);
    h.research.receive(file('00000000-0000-4000-8000-000000000003'));
    await h.services.research.withdraw();
    expect(await h.services.research.list()).toHaveLength(0);
    expect(h.research.accepting).toBe(false);
    expect(h.services.research.watchPrefs()).toBeNull();
    const consents = await h.services.repos.settings.consentHistory();
    expect(consents.filter((c) => c.type === 'research_recording').map((c) => c.granted)).toEqual([true, false]);
    await new Promise((r) => setTimeout(r, 0));
    expect(lastContextPrefs(h.watch.contexts).researchRecording).toBeUndefined();
  });
});

describe('automatic detection gating', () => {
  it('never tells the watch to run gesture prompts while the feature flag is off', async () => {
    const h = await createHarness({ prefs: { automaticDetectionEnabled: true }, automaticDetectionAllowed: false });
    const ctx = await h.services.watchSync.buildContext();
    expect(ctx.prefs.automaticDetectionEnabled).toBe(false);
  });

  it('passes the user preference through when the flag allows it', async () => {
    const h = await createHarness({ prefs: { automaticDetectionEnabled: true }, automaticDetectionAllowed: true });
    const ctx = await h.services.watchSync.buildContext();
    expect(ctx.prefs.automaticDetectionEnabled).toBe(true);
  });

  it('still rejects unknown inbound message types from the watch', () => {
    expect(decodeInbound({ v: 1, id: 'abcdefgh', type: 'gesture_detected' }).ok).toBe(false);
  });
});
