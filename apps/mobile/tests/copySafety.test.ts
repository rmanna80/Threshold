import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkMessage } from '@threshold/core';

/**
 * Scans static UI copy for claims Threshold must never make (sobriety, driving, BAC, safe amounts,
 * guarantees, encouragement to drink, diagnoses). The only allowed matches are the explicit
 * disclaimers below, which say what Threshold does NOT do. Any new match fails this test and must
 * be rewritten or reviewed and added here deliberately.
 */
const ALLOWED_DISCLAIMERS: readonly { file: string; startsWith: string }[] = [
  { file: 'app/(onboarding)/habits.tsx', startsWith: 'Threshold does not use these to estimate blood alcohol.' },
  { file: 'app/(onboarding)/welcome.tsx', startsWith: '• It does not measure blood alcohol and cannot tell you whether you are sober.' },
  { file: 'app/(onboarding)/welcome.tsx', startsWith: '• It can never tell you whether it is safe to drive.' },
  { file: 'app/(onboarding)/welcome.tsx', startsWith: '• It does not define a safe amount to drink' },
  { file: 'app/(tabs)/session.tsx', startsWith: 'Threshold estimates nothing about blood alcohol' },
  { file: 'app/settings/about.tsx', startsWith: '• Threshold does not and cannot measure blood alcohol concentration.' },
  { file: 'app/settings/about.tsx', startsWith: '• It never determines whether you are sober or able to drive.' },
  { file: 'app/settings/about.tsx', startsWith: '• No pace or amount shown in Threshold is a safe limit.' },
  { file: 'features/session/PhysiologyCard.tsx', startsWith: 'Heart rate cannot show how much alcohol is in your body' },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('static copy safety', () => {
  it('contains no forbidden claims outside reviewed disclaimers', () => {
    const root = join(__dirname, '..');
    const violations: string[] = [];
    for (const dir of ['app', 'features', 'components']) {
      for (const f of files(join(root, dir))) {
        const rel = relative(root, f).split('\\').join('/');
        const src = readFileSync(f, 'utf8');
        const strings = [...src.matchAll(/'([^'\n]{12,})'|"([^"\n]{12,})"|`([^`]{12,})`|>\s*([^<>{}\n][^<>{}]{12,}?)\s*</g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim());
        for (const s of strings) {
          if (checkMessage(s).safe) continue;
          if (ALLOWED_DISCLAIMERS.some((a) => a.file === rel && s.startsWith(a.startsWith))) continue;
          violations.push(`${rel}: ${s.slice(0, 100)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
