# Scientific foundations

This document states what Threshold's behaviour is based on, and — just as important — what it does
not claim. Sources are listed in `research/` with links; only sources that were checked are cited.

## Alcohol quantity

* **Pure ethanol in a drink** = volume (mL) × ABV/100 × 0.789 g/mL (density of ethanol at about
  20 °C). Implemented identically in TypeScript, Swift and Python and checked by shared vectors.
* **Standard drinks are national conventions, not physiology.** Definitions differ widely between
  countries — from 8 g (UK unit) to 20 g (Austria) of ethanol (Kalinowski & Humphreys, 2016).
  Threshold ships the official definitions it could verify: US 14 g (NIAAA), UK 8 g (NHS), Australia
  10 g (NHMRC; the Australia New Zealand Food Standards Code), Canada 13.45 g (Health Canada / CCSA),
  Ireland 10 g (HSE), Austria 20 g, and a custom definition (5–30 g). The user chooses the region.
* **Unknown strength is unknown.** If ABV or volume is unknown, the drink is counted as a drink with
  no grams, and totals say how many drinks had unknown strength.

## What Threshold deliberately does not estimate

* **Blood or breath alcohol concentration.** BAC depends on body water, sex, food, absorption and
  elimination rates and timing that vary within and between people; consumer estimates are easily
  mistaken for permission to drive. Threshold never calculates or displays BAC.
* **Sobriety, impairment or fitness to drive.** Never claimed in any form.
* **"Safe" amounts.** Goals are personal targets chosen by the user. Health guidance from public
  agencies varies by country and over time (for example, Canada's 2023 guidance on alcohol and health
  changed its low-risk thresholds substantially), and Threshold does not present any amount as safe.
* **Hangover prevention.** Nothing in the app is presented as preventing a hangover.

## Pace

Pace reminders are based on the user's own goals and on short-window amounts (e.g. two or more
standard drinks within 30 minutes, three within 60). These thresholds are product rules that trigger
*reminders to slow down*; they are not clinical cut-offs or safety limits.

## Alcohol overdose information

The safety centre lists critical signs of alcohol overdose and what to do, following NIAAA public
guidance (mental confusion, difficulty remaining conscious or inability to wake, vomiting, seizures,
slow or irregular breathing, slow heart rate, clammy or pale/bluish skin, low body temperature) and
the instruction to call emergency services without waiting for all signs. Threshold states that it
cannot detect or rule out an emergency.

## Sleep and overnight physiology

* Laboratory studies summarised by Ebrahim et al. (2013) found that alcohol shortens sleep onset,
  consolidates the first half of the night and disrupts the second half, with dose-related REM effects.
* In a large real-world sample with beat-to-beat recordings, Pietilä et al. (2018) observed
  dose-dependent increases in heart rate and decreases in HRV during the first hours of sleep after
  drinking.
* These findings justify *looking at* sleep, resting heart rate and HRV around drinking. They do not
  justify attributing any one person's reading to alcohol: illness, exercise, stress, travel and
  measurement noise produce similar changes. Threshold therefore uses personal robust baselines
  (modified z-score, Iglewicz & Hoaglin) with maturity rules and describes deviations without
  assigning a cause.

## Next-day recovery

* "Hangover" is defined by the Alcohol Hangover Research Group as mental and physical symptoms after
  a single drinking episode, starting when blood alcohol approaches zero; the 2020 update notes that
  hangovers are not limited to heavy drinking (Verster et al., 2020).
* Threshold's check-in collects self-reported symptoms (0–10 scales) so users can see their own
  patterns. Outcome thresholds used in research (e.g. "moderate or worse") are analysis choices.
* Prediction models are evaluated on calibration as well as discrimination, because poorly calibrated
  risk estimates mislead (Van Calster et al., 2019).

## Wearable sensing

* Wrist inertial sensing can recognise eating moments in free-living settings with moderate accuracy
  (e.g. Thomaz et al., 2015, F-scores around 71–76 %), and hand-to-mouth drinking gestures resemble
  eating and other activities. A wrist motion model therefore cannot know whether alcohol was consumed.
* Transdermal alcohol sensors are a different technology (sweat ethanol) with variable lag and
  correlation with BAC (Brobbin et al., 2022 systematic review; Yu et al., 2022 meta-analysis). Apple
  Watch has no such sensor; Threshold does not use or simulate one. An external-device provider type
  exists in the data model only.

## Platform facts that shape behaviour

* HealthKit hides whether read access was granted; denied data looks like no data (Apple).
* watchOS keeps apps running in the background only for specific session types; Threshold does not
  repurpose them, so detection is foreground-only (Apple).
* App Review guideline 1.4.3 prohibits apps that encourage excessive alcohol consumption; Threshold's
  copy guard and design aim for the opposite.

## Limits of the evidence

Associations shown in Insights are computed from the user's own records, labelled as associations,
require minimum sample sizes, and come with the reminder that other factors may explain them. No
finding in Threshold is presented as causal.
