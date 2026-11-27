# Standard drink definitions

Checked 2026-11-27. Implemented in `packages/core/src/standardDrinks.ts`; the user selects a region.

| Region | Grams of ethanol | Source (what it states) |
| --- | --- | --- |
| United States | 14 g | NIAAA, _What Is A Standard Drink?_ — a US standard drink contains 0.6 fl oz or 14 g of pure alcohol. https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink ; CDC, _About Standard Drink Sizes_ https://www.cdc.gov/alcohol/standard-drink-sizes/ |
| United Kingdom | 8 g (1 unit = 10 mL) | NHS, _Calculating alcohol units_ — one unit equals 10 mL or 8 g of pure alcohol. https://www.nhs.uk/live-well/alcohol-advice/calculating-alcohol-units/ |
| Australia | 10 g | NHMRC, _Australian guidelines to reduce health risks from drinking alcohol_ — a standard drink contains 10 g of pure alcohol; defined in the Australia New Zealand Food Standards Code. https://www.nhmrc.gov.au/health-advice/alcohol |
| New Zealand | 10 g | Australia New Zealand Food Standards Code (shared definition, per NHMRC above) |
| Canada | 13.45 g (17.05 mL) | Government of Canada — a standard drink is 17.05 mL or 13.45 g of pure alcohol. https://www.canada.ca/en/health-canada/services/substance-use/alcohol/low-risk-alcohol-drinking-guidelines.html |
| Ireland | 10 g | HSE, _Weekly low-risk alcohol guidelines_ — in Ireland a standard drink has 10 g of pure alcohol. https://www2.hse.ie/wellbeing/alcohol/improve-your-health/weekly-low-risk-alcohol-guidelines.html |
| Austria | 20 g | Kalinowski A, Humphreys K. Governmental standard drink definitions and low-risk alcohol consumption guidelines in 37 countries. _Addiction_ 2016;111(7):1293–1298. doi:10.1111/add.13341 — definitions range from 8 g (UK, Iceland) to 20 g (Austria) |
| Custom | 5–30 g | User-defined |

Notes:
* These are counting conventions, not physiological thresholds, and they differ by up to 2.5× between
  countries (Kalinowski & Humphreys 2016).
* Low-risk drinking guidance differs by country and changes over time (e.g. Canada's 2023 *Guidance on
  Alcohol and Health* replaced the 2011 limits with a continuum of risk). Threshold shows none of these
  as "safe" amounts; goals are the user's own.
