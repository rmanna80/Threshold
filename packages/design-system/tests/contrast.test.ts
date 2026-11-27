import { describe, expect, it } from 'vitest';
import { colors, contrastRatio } from '../src';

describe('accessible contrast', () => {
  const surfaces = [colors.background, colors.surface, colors.surfaceRaised];
  it('primary and secondary text meet WCAG AA (4.5:1) on all surfaces', () => {
    for (const s of surfaces) {
      expect(contrastRatio(colors.textPrimary, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.textSecondary, s)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('tertiary text, accent, safety and goal colours meet 4.5:1 on the background', () => {
    for (const c of [colors.textTertiary, colors.accent, colors.safety, colors.goalComplete, colors.info]) {
      expect(contrastRatio(c, colors.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark text on the amber accent button meets AA', () => {
    expect(contrastRatio(colors.background, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
