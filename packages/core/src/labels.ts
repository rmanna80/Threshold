import type { VolumeInput, VolumeUnit } from '@threshold/shared-types';

/**
 * Parses OCR text lines (from Apple Vision VNRecognizeTextRequest) into *candidate* beverage
 * fields. Every field carries the text it came from and a heuristic confidence; the UI must
 * always ask the user to confirm or edit before anything is logged.
 */
export interface ParsedField<T> {
  value: T;
  confidence: 'high' | 'medium' | 'low';
  sourceText: string;
}

export interface ParsedLabel {
  productName: ParsedField<string> | null;
  abvPercent: ParsedField<number> | null;
  serving: ParsedField<VolumeInput> | null;
  rawLines: string[];
}

const ALCOHOL_CONTEXT = /(alc|alcohol|abv|vol\b|by vol|proof)/i;
const PERCENT_RE = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/g;
const PROOF_RE = /(\d{2,3}(?:[.,]\d)?)\s?proof/i;

const VOLUME_PATTERNS: { re: RegExp; unit: VolumeUnit }[] = [
  { re: /(\d+(?:[.,]\d+)?)\s?(?:us\s)?fl\.?\s?oz\.?/i, unit: 'fl_oz_us' },
  { re: /(\d+(?:[.,]\d+)?)\s?ml\b/i, unit: 'ml' },
  { re: /(\d+(?:[.,]\d+)?)\s?cl\b/i, unit: 'cl' },
  { re: /(\d+(?:[.,]\d+)?)\s?(?:l|litre|liter)s?\b/i, unit: 'l' },
  { re: /(\d+(?:[.,]\d+)?)\s?oz\.?\b/i, unit: 'fl_oz_us' },
];

const BOILERPLATE = /(government warning|surgeon general|contains|brewed|imported|bottled|distilled|produced|product of|www\.|\.com|nutrition|ingredients|calories|serving|deposit|recycle|refund|pregnan|drive|machinery|health problems)/i;

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function parseAbv(lines: string[]): ParsedField<number> | null {
  const candidates: ParsedField<number>[] = [];
  for (const line of lines) {
    const proof = PROOF_RE.exec(line);
    if (proof?.[1]) {
      const p = toNumber(proof[1]);
      if (p > 0 && p <= 200) candidates.push({ value: p / 2, confidence: 'medium', sourceText: line });
    }
    for (const match of line.matchAll(PERCENT_RE)) {
      const value = toNumber(match[1] ?? '');
      if (!Number.isFinite(value) || value <= 0 || value > 80) continue;
      const hasContext = ALCOHOL_CONTEXT.test(line);
      candidates.push({ value, confidence: hasContext ? 'high' : 'low', sourceText: line });
    }
  }
  const rank = { high: 3, medium: 2, low: 1 } as const;
  candidates.sort((a, b) => rank[b.confidence] - rank[a.confidence]);
  return candidates[0] ?? null;
}

function parseServing(lines: string[]): ParsedField<VolumeInput> | null {
  for (const { re, unit } of VOLUME_PATTERNS) {
    for (const line of lines) {
      const match = re.exec(line);
      if (!match?.[1]) continue;
      const value = toNumber(match[1]);
      if (!Number.isFinite(value) || value <= 0) continue;
      // Plausibility windows per unit; implausible values are skipped, not clamped.
      const ml = unit === 'ml' ? value : unit === 'cl' ? value * 10 : unit === 'l' ? value * 1000 : value * 29.57;
      if (ml < 25 || ml > 5000) continue;
      const explicitFluid = /fl/i.test(line) || unit !== 'fl_oz_us';
      return { value: { value, unit }, confidence: explicitFluid ? 'high' : 'medium', sourceText: line };
    }
  }
  return null;
}

function parseName(lines: string[]): ParsedField<string> | null {
  const candidates = lines
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 40)
    .filter((l) => /[a-z]/i.test(l))
    .filter((l) => !/%|\bml\b|\boz\b|\bproof\b|\d{3,}/i.test(l))
    .filter((l) => !BOILERPLATE.test(l));
  const first = candidates[0];
  if (!first) return null;
  return { value: first.replace(/\s+/g, ' '), confidence: 'low', sourceText: first };
}

export function parseBeverageLabel(rawLines: string[]): ParsedLabel {
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  return {
    productName: parseName(lines),
    abvPercent: parseAbv(lines),
    serving: parseServing(lines),
    rawLines: lines,
  };
}
