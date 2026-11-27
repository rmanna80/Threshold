# Alcohol, sleep and overnight physiology

Checked 2026-11-27.

**Ebrahim IO, Shapiro CM, Williams AJ, Fenwick PB. Alcohol and sleep I: effects on normal sleep.
_Alcohol Clin Exp Res_ 2013;37(4):539–549. doi:10.1111/acer.12006.** https://pubmed.ncbi.nlm.nih.gov/23347102/
* Review of studies in healthy volunteers: at all doses alcohol shortens sleep-onset latency,
  consolidates the first half of sleep and increases sleep disruption in the second half; REM effects in
  the first half are dose-related; the first REM period is delayed at all doses.
* Used for: showing sleep after sessions and including sleep in recovery features. Not used to
  attribute any individual night to alcohol.

**Pietilä J, Helander E, Korhonen I, Myllymäki T, Kujala UM, Lindholm H. Acute effect of alcohol
intake on cardiovascular autonomic regulation during the first hours of sleep in a large real-world
sample of Finnish employees: observational study. _JMIR Ment Health_ 2018;5(1):e23.
doi:10.2196/mental.9519.** https://mental.jmir.org/2018/1/e23
* Within-person analysis of beat-to-beat recordings: alcohol intake was associated with higher heart
  rate and lower HRV during the first three hours of sleep in a dose-dependent manner (reported mean HR
  increases of about 1.4, 4.0 and 8.7 bpm for low, moderate and high intake).
* Used for: including overnight resting-HR delta and HRV in features and describing deviations.
  Threshold uses Apple's SDNN rather than RMSSD and does not reproduce the study's recovery index.

**Iglewicz B, Hoaglin DC. _How to Detect and Handle Outliers_. ASQC Quality Press, 1993.**
(summarised in the NIST/SEMATECH e-Handbook, https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm)
* Modified z-score M = 0.6745 (x − median) / MAD.
* Used for: robust deviation scores against personal baselines. Threshold describes |z| ≥ 2 as
  "higher/lower than your usual range" — a display rule chosen for the app, not the 3.5 outlier label
  the authors recommend for outlier detection, and never a diagnosis.

Platform facts (Apple):
* HealthKit does not tell apps whether read access was denied; denied queries look like an empty store.
  https://support.apple.com/guide/security/sec88be9900f/web ;
  https://developer.apple.com/documentation/healthkit/hkauthorizationstatus
