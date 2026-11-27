import { colors, minTouchTarget, motion, radii, spacing, typography } from '@threshold/design-system';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export { colors, minTouchTarget, motion, radii, spacing, typography };

/** Tracks the system Reduce Motion setting; animations must be skipped when true. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduced(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
