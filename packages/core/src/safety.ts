/**
 * Safety layer — independent of any machine-learning component.
 *
 * 1. A content guard that every generated, user-facing message (interventions, insights,
 *    observations, predictions) must pass. It blocks claims Threshold must never make.
 * 2. Static, educational emergency information (signs of alcohol poisoning, what to do) and
 *    regional emergency numbers. This content is always free and never depends on sensors.
 */

export interface ForbiddenClaim {
  id: string;
  pattern: RegExp;
  reason: string;
}

export const FORBIDDEN_CLAIMS: readonly ForbiddenClaim[] = Object.freeze([
  { id: 'sobriety', pattern: /\bsober(ed|ing)?\b|\bsobriety\b/i, reason: 'Threshold cannot determine sobriety.' },
  { id: 'driving', pattern: /\b(safe|ok|okay|fine|good|clear(ed)?|able|fit)\s+(to|for)\s+driv(e|ing)\b|\byou\s+can\s+(now\s+)?drive\b/i, reason: 'Threshold must never assess fitness to drive.' },
  { id: 'bac', pattern: /\bBAC\b|\bblood[-\s]alcohol\b|\bbreath[-\s]alcohol\b|\bpromille\b/i, reason: 'Standard wearables cannot measure blood alcohol.' },
  { id: 'hangover_guarantee', pattern: /hangover[-\s]free|(prevent|avoid|stop)s?\s+(a\s+|any\s+)?hangovers?|won'?t\s+(get|have)\s+a\s+hangover|no\s+hangover/i, reason: 'Hangover prevention cannot be guaranteed.' },
  { id: 'guarantee', pattern: /\bguarantee(d|s)?\b/i, reason: 'No outcome can be guaranteed.' },
  { id: 'safe_amount', pattern: /\bsafe\s+(amount|limit|level|number|threshold|to\s+drink|pace|rate)\b|\bsafely\s+drink\b|\bwithin\s+(a\s+)?safe\b/i, reason: 'There is no guaranteed safe amount of alcohol.' },
  { id: 'encourage_more', pattern: /\b(have|grab|order|enjoy|pour)\s+(another|one\s+more|a\s+second|more)\b|\bdrink\s+more\b|\bkeep\s+drinking\b|\bnext\s+drink\s+(in|at)\b|\byou\s+can\s+(now\s+)?(have|drink)\b|\bready\s+for\s+(another|your\s+next)\b/i, reason: 'Threshold must never encourage drinking.' },
  { id: 'countdown', pattern: /\b(cleared|allowed|permitted)\s+to\b|\buntil\s+(your\s+)?next\s+drink\b|\btime\s+(until|to)\s+(your\s+)?next\b/i, reason: 'No countdowns to the next drink.' },
  { id: 'false_remedy', pattern: /\b(water|food|coffee|caffeine|rest|sleep|exercise|a\s+shower)\b[^.]{0,40}\b(sober|cancel(s)?\s+out|reverse(s)?|speed(s)?\s+up|eliminat(e|es|ion)|flush(es)?|neutrali[sz]e(s)?)\b/i, reason: 'Nothing reverses intoxication or speeds alcohol elimination.' },
  { id: 'diagnosis', pattern: /\b(you\s+are|you're)\s+(drunk|intoxicated|impaired|fine|ok|okay)\b|\bproves?\b|\bdiagnos(e|is|ed)\b/i, reason: 'Physiological signals cannot diagnose intoxication or wellness.' },
  { id: 'rule_out_emergency', pattern: /\b(not|no)\s+(an?\s+)?(emergency|alcohol\s+poisoning)\b|\bno\s+need\s+(to|for)\s+(call|help|emergency)/i, reason: 'Biometrics cannot rule out an emergency.' },
]);

export interface GuardResult {
  safe: boolean;
  violations: { id: string; reason: string; match: string }[];
}

export function checkMessage(text: string): GuardResult {
  const violations: GuardResult['violations'] = [];
  for (const claim of FORBIDDEN_CLAIMS) {
    const m = claim.pattern.exec(text);
    if (m) violations.push({ id: claim.id, reason: claim.reason, match: m[0] });
  }
  return { safe: violations.length === 0, violations };
}

export function isSafeMessage(text: string): boolean {
  return checkMessage(text).safe;
}

export class UnsafeMessageError extends Error {
  constructor(public readonly violations: GuardResult['violations']) {
    super(`Blocked unsafe message: ${violations.map((v) => v.id).join(', ')}`);
    this.name = 'UnsafeMessageError';
  }
}

export function assertSafeMessage(text: string): string {
  const r = checkMessage(text);
  if (!r.safe) throw new UnsafeMessageError(r.violations);
  return text;
}

// ---------------------------------------------------------------------------
// Emergency information (educational; see research/alcohol-physiology.md for sources)
// ---------------------------------------------------------------------------

/** Critical signs of alcohol overdose/poisoning, following NIAAA public guidance. */
export const ALCOHOL_POISONING_SIGNS: readonly string[] = Object.freeze([
  'Cannot be woken up, or is unresponsive',
  'Slow breathing (fewer than 8 breaths a minute) or irregular breathing (10 seconds or more between breaths)',
  'Seizures',
  'Vomiting while not fully awake or with reduced consciousness',
  'Mental confusion or stupor',
  'Pale, blue-tinged or clammy skin, or low body temperature',
  'Slow heart rate, or difficulty remaining conscious',
]);

export const EMERGENCY_ACTIONS: readonly string[] = Object.freeze([
  'Call your local emergency number immediately if you suspect alcohol poisoning — don’t wait for every sign.',
  'Do not leave the person alone.',
  'If they are lying down, turn them on their side to help prevent choking if they vomit.',
  'Do not give them food, coffee or more alcohol, and don’t try to make them vomit or “sleep it off”.',
  'Follow the instructions of the emergency dispatcher.',
]);

export const MONITORING_DISCLAIMER =
  'Threshold cannot detect or rule out alcohol poisoning or any other emergency. Watch and phone sensors are not medical devices. If you are worried about someone, call for help.';

export interface EmergencyNumber {
  country: string;
  name: string;
  primary: string;
  notes: string;
}

/** Numbers verified against national emergency services references; '112' works on most GSM phones in Europe. */
export const EMERGENCY_NUMBERS: Readonly<Record<string, EmergencyNumber>> = Object.freeze({
  US: { country: 'US', name: 'United States', primary: '911', notes: 'Police, fire and ambulance.' },
  CA: { country: 'CA', name: 'Canada', primary: '911', notes: 'Police, fire and ambulance.' },
  MX: { country: 'MX', name: 'Mexico', primary: '911', notes: 'National emergency number.' },
  GB: { country: 'GB', name: 'United Kingdom', primary: '999', notes: '112 also works.' },
  IE: { country: 'IE', name: 'Ireland', primary: '112', notes: '999 also works.' },
  AU: { country: 'AU', name: 'Australia', primary: '000', notes: '112 also works from mobile phones.' },
  NZ: { country: 'NZ', name: 'New Zealand', primary: '111', notes: 'Police, fire and ambulance.' },
  JP: { country: 'JP', name: 'Japan', primary: '119', notes: 'Ambulance and fire. Police: 110.' },
  KR: { country: 'KR', name: 'South Korea', primary: '119', notes: 'Ambulance and fire. Police: 112.' },
  IN: { country: 'IN', name: 'India', primary: '112', notes: 'National emergency number; 108 is the ambulance line in many states.' },
  BR: { country: 'BR', name: 'Brazil', primary: '192', notes: 'SAMU ambulance. Fire: 193, police: 190.' },
  ZA: { country: 'ZA', name: 'South Africa', primary: '10177', notes: 'Ambulance. From a mobile phone, 112.' },
  EU: { country: 'EU', name: 'European Union', primary: '112', notes: 'Works throughout the EU.' },
});

const EU_MEMBERS = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

export function emergencyNumberFor(country: string | null | undefined): EmergencyNumber {
  const c = (country ?? '').toUpperCase();
  const direct = EMERGENCY_NUMBERS[c];
  if (direct) return direct;
  if (EU_MEMBERS.has(c)) return { ...(EMERGENCY_NUMBERS.EU as EmergencyNumber), country: c };
  return {
    country: c || 'UNKNOWN',
    name: 'Your location',
    primary: '112',
    notes: '112 is widely supported on mobile networks, but confirm your local emergency number.',
  };
}
