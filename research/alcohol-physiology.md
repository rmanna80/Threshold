# Alcohol overdose information and why Threshold does not estimate BAC

Checked 2026-11-27.

## Overdose signs and actions (used in `packages/core/src/safety.ts` and the Emergency screen)

**National Institute on Alcohol Abuse and Alcoholism (NIAAA). _Understanding the Dangers of Alcohol
Overdose_ (fact sheet).** https://pubs.niaaa.nih.gov/publications/AlcoholOverdoseFactsheet/Overdosefact.pdf

Supports:
* An overdose occurs when so much alcohol is in the bloodstream that brain areas controlling basic
  life-support functions (breathing, heart rate, temperature control) begin to shut down.
* Signs include mental confusion, difficulty remaining conscious, vomiting, seizures, slow heart
  rate, slow or irregular breathing (fewer than eight breaths per minute, or 10 seconds or more
  between breaths), clammy skin, extremely low body temperature (possibly pale or bluish skin) and
  dulled responses such as no gag reflex.
* Call emergency services immediately; do not wait for all symptoms; a person who has passed out can
  die; "cold showers, hot coffee, and walking" do not reverse alcohol overdose.
* Blood alcohol can continue to rise after drinking stops.

Threshold's list paraphrases these signs, adds standard first-aid actions (stay with the person, put
them on their side), and states that the app cannot detect or rule out an emergency.

## Why BAC is not estimated

Blood alcohol depends on body composition, sex, food, absorption and elimination rates and timing,
which vary within and between people; the NIAAA fact sheet itself notes that BAC can keep rising after
the last drink. A number on a phone is easily read as permission to drive. Consumer wearables
(including Apple Watch) have no alcohol sensor. Threshold therefore never computes BAC; the content
guard blocks BAC language. (Transdermal sensors are a separate technology — see
`wearable-sensing.md`.)

## Physical constant

Ethanol density ≈ 0.789 g/mL at 20 °C (standard reference value), used to convert volume × ABV to
grams.
