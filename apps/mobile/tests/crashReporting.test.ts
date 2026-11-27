import { CrashReporter, scrubEvent, scrubStack, scrubText, toCrashEvent, type CrashTransport } from '../services/crashReporting';

class Capture implements CrashTransport {
  configured = true;
  events: unknown[] = [];
  async send(e: unknown) {
    this.events.push(e);
  }
}

describe('crash reporting', () => {
  it('scrubs identifiers and numbers from messages', () => {
    const s = scrubText('Invalid drink for jane@example.com: 3.2 standard drinks, 72 bpm, session 3f2b1c9e-1d2a-4b3c-9d8e-7f6a5b4c3d2e, Bearer abc.def');
    expect(s).not.toMatch(/jane|3\.2|72|3f2b1c9e|abc\.def/);
    expect(s).toContain('[email]');
    expect(s).toContain('[id]');
  });

  it('removes absolute paths from stack frames', () => {
    expect(scrubStack('at f (file:///private/var/containers/Bundle/App/X/main.jsbundle:1:2)')).toBe('at f (main.jsbundle:1:2)');
  });

  it('drops sensitive tags and breadcrumb messages', () => {
    const e = scrubEvent({
      name: 'Error',
      message: 'boom',
      stack: null,
      tags: { appVersion: '1.0.0', standardDrinks: '3', participantId: 'TH-1', screen: 'session' },
      breadcrumbs: [{ category: 'drink', message: 'logged 2 beers' }, { category: 'navigation', message: '/emergency' }],
      isFatal: false,
    });
    expect(e.tags).toEqual({ appVersion: '1.0.0', screen: 'session' });
    expect(e.breadcrumbs).toEqual([
      { category: 'app', message: '' },
      { category: 'navigation', message: '' },
    ]);
  });

  it('sends nothing without opt-in or without a configured transport', async () => {
    const t = new Capture();
    expect(await new CrashReporter(t, () => false).capture(new Error('x'))).toBe(false);
    expect(await new CrashReporter({ configured: false, send: async () => undefined }, () => true).capture(new Error('x'))).toBe(false);
    expect(t.events).toHaveLength(0);
    expect(await new CrashReporter(t, () => true).capture(new Error('user@example.com had 4 drinks'))).toBe(true);
    expect(JSON.stringify(t.events)).not.toMatch(/user@example|4 drinks/);
  });

  it('wraps non-errors', () => {
    expect(toCrashEvent('oops', true)).toMatchObject({ name: 'Error', message: 'oops', isFatal: true });
  });
});
