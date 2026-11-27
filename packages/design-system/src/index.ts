/**
 * Threshold design tokens.
 *
 * Principles: calm, scientific, dark-first. Amber is the brand accent; green is reserved for
 * *completed moderation goals* (e.g. an alcohol-free day achieved) and is never used as a
 * "safe to keep drinking" indicator during a session. Red is reserved for genuine safety content.
 */

export const palette = {
  charcoal950: '#0B0C0E',
  charcoal900: '#121418',
  charcoal850: '#171A1F',
  charcoal800: '#1D2127',
  charcoal700: '#272C34',
  charcoal600: '#363C46',
  slate400: '#8A93A3',
  slate300: '#A9B1BE',
  offWhite: '#F2EFE9',
  offWhiteMuted: '#CFCBC3',
  amber500: '#D9A55B',
  amber400: '#E4B977',
  amber700: '#9C7238',
  amberTint: 'rgba(217, 165, 91, 0.14)',
  green500: '#7FAE8C',
  greenTint: 'rgba(127, 174, 140, 0.14)',
  red500: '#E06C5E',
  red600: '#C9544A',
  redTint: 'rgba(224, 108, 94, 0.14)',
  blue400: '#7FA3C9',
  blueTint: 'rgba(127, 163, 201, 0.14)',
} as const;

export const colors = {
  background: palette.charcoal950,
  surface: palette.charcoal900,
  surfaceRaised: palette.charcoal850,
  surfaceHighlight: palette.charcoal800,
  border: palette.charcoal700,
  borderStrong: palette.charcoal600,
  textPrimary: palette.offWhite,
  textSecondary: palette.offWhiteMuted,
  textTertiary: palette.slate400,
  accent: palette.amber500,
  accentPressed: palette.amber700,
  accentTint: palette.amberTint,
  /** Only for completed moderation goals. */
  goalComplete: palette.green500,
  goalCompleteTint: palette.greenTint,
  /** Only for safety-critical information. */
  safety: palette.red500,
  safetyTint: palette.redTint,
  /** Neutral informational (physiology, water). */
  info: palette.blue400,
  infoTint: palette.blueTint,
  /** Data provenance chips. */
  observed: palette.offWhiteMuted,
  estimated: palette.amber400,
  missing: palette.slate400,
  experimental: palette.blue400,
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radii = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

export const typography = {
  display: { fontSize: 44, lineHeight: 50, fontWeight: '600' as const, letterSpacing: -0.5 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '600' as const, letterSpacing: -0.3 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.3 },
  numeric: { fontSize: 34, lineHeight: 40, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const },
} as const;

export const motion = {
  /** Durations in ms. Respect reduce-motion: callers must skip animation when it is enabled. */
  fast: 150,
  standard: 250,
  slow: 400,
} as const;

export const minTouchTarget = 44;

export type ColorToken = keyof typeof colors;

/** WCAG relative luminance contrast ratio for two #RRGGBB colours. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m?.[1]) throw new Error(`Expected #RRGGBB, got ${hex}`);
    const n = parseInt(m[1], 16);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const [a, b] = [lum(hexA), lum(hexB)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
