# Safety

Threshold is a moderation and harm-reduction tool for adults. It is **not** a medical device, cannot
detect emergencies, and must never be used to decide whether someone is sober or can drive.

## Permanent rules

| Rule | How it is enforced |
| --- | --- |
| Never estimate or display BAC | No BAC code exists; the content guard blocks "BAC", "blood alcohol", "breath alcohol", "promille" |
| Never claim sobriety, impairment status or fitness to drive | Guard patterns `sobriety`, `driving`, `diagnosis` |
| Never define a safe amount, pace or limit | Guard pattern `safe_amount`; goals are labelled personal choices |
| Never guarantee outcomes (e.g. hangover prevention) | Guard patterns `guarantee`, `hangover_guarantee` |
| Never encourage drinking or count down to the next drink | Guard patterns `encourage_more`, `countdown`; reminders only suggest slowing down, water or stopping |
| Never imply anything reverses intoxication | Guard pattern `false_remedy` |
| Never rule out an emergency | Guard pattern `rule_out_emergency`; monitoring disclaimer on the emergency screen |
| Safety features are always free | Always-free entitlement list + route test (`ARCHITECTURE.md`) |
| Experimental features stay off until validated | Feature flags + model gates (`MODEL_VALIDATION.md`) |

The guard (`packages/core/src/safety.ts`) is applied to every intervention message, observation,
prediction message and outcome description (`assertSafeMessage` throws on a violation). Tests check
the whole message catalogue, prediction copy, and a scan of static UI copy
(`apps/mobile/tests/copySafety.test.ts`), where the only allowed matches are reviewed disclaimers
that state what Threshold does *not* do.

## Emergency information

The Emergency screen is reachable from Today, the active session and Profile, works offline and needs
no permissions. It lists critical signs of alcohol overdose following NIAAA public guidance, what to
do (call emergency services without waiting for every sign, stay with the person, place them on their
side, don't give food/coffee/alcohol or try to make them vomit), and a one-tap call to the regional
emergency number chosen from the user's country (US/CA/MX 911, UK 999, IE 112, AU 000, NZ 111, JP/KR
119, IN 112, BR 192, ZA 10177, EU 112, otherwise 112 with a note to confirm locally). Sources:
`research/alcohol-physiology.md`.

## Interventions

Reminders are based on the user's own goals and short-window pace. They suggest pausing, switching to
water or a non-alcoholic drink, or winding down. Frequency preferences, quiet mode, caps, cool-downs
and fatigue-aware gaps keep them from becoming noise; suppressed reminders are recorded with the
reason. Heart-rate notes mention alternative explanations and never interpret readings as
intoxication.

## Data that could mislead

* Unknown-strength drinks are counted but contribute no grams; totals say "plus N of unknown
  strength".
* Health readings show their age; missing data is "no data", never zero.
* Associations in Insights are labelled as associations with minimum sample sizes.
* Predictions are withheld unless validated, personalised with enough history and given adequate
  input; when shown they carry an interval and "not medical advice … never use it to decide whether
  to drive".
* Gesture prompts (disabled) could only ask whether to start a session; they never log a drink.

## Eligibility

Onboarding asks users to confirm they are of legal drinking age in their country (country-specific
ages in `packages/core/src/eligibility.ts`). This is self-attested and cannot be verified; the App
Store rating should be 17+.

## Research participants

Drinking gestures are recorded with water or non-alcoholic drinks. The app never asks anyone to drink
alcohol for research. Studies require ethics approval and their own safety procedures.

## Reviewing new features

1. Does it say anything about how much someone can drink, their sobriety, driving, or BAC? → stop.
2. Does every new string pass the guard and avoid implying precision the data does not have?
3. Does it work and stay free when offline, unauthorised or without a subscription if it is
   safety-related?
4. Is any model-driven output gated, calibrated and accompanied by uncertainty?
5. Update `THREAT_MODEL.md` (X-series) and this document.
