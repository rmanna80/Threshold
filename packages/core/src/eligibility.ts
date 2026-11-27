/**
 * Legal minimum drinking/purchase ages used for the onboarding eligibility confirmation.
 * Threshold never collects a date of birth (data minimisation): the user confirms they meet
 * the legal age for their country, and the app enforces an absolute floor of 18.
 *
 * Values reflect national purchase/consumption minimums as commonly published; where a country
 * has differing ages by beverage type, the higher age is used so the confirmation is conservative.
 */
export const ABSOLUTE_MINIMUM_AGE = 18;

const LEGAL_AGE_BY_COUNTRY: Readonly<Record<string, number>> = Object.freeze({
  US: 21,
  CA: 19, // 18 in AB, MB, QC — 19 is used as the conservative national value
  MX: 18,
  GB: 18,
  IE: 18,
  AU: 18,
  NZ: 18,
  DE: 18, // 16 for beer/wine; 18 for spirits — conservative
  AT: 18,
  FR: 18,
  ES: 18,
  IT: 18,
  NL: 18,
  BE: 18,
  SE: 20, // retail purchase 20
  NO: 20,
  FI: 18,
  DK: 18,
  JP: 20,
  KR: 19,
  IN: 25, // varies by state (18–25); conservative
  BR: 18,
  ZA: 18,
});

export function legalDrinkingAge(country: string): number {
  const age = LEGAL_AGE_BY_COUNTRY[country.toUpperCase()];
  return Math.max(age ?? ABSOLUTE_MINIMUM_AGE, ABSOLUTE_MINIMUM_AGE);
}

export function supportedEligibilityCountries(): string[] {
  return Object.keys(LEGAL_AGE_BY_COUNTRY).sort();
}
