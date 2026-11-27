# Wearable sensing

Checked 2026-11-27.

## Wrist inertial sensing of intake gestures

**Thomaz E, Essa I, Abowd GD. A practical approach for recognizing eating moments with wrist-mounted
inertial sensing. _Proc UbiComp_ 2015:1029–1040. doi:10.1145/2750858.2807545.**
https://pmc.ncbi.nlm.nih.gov/articles/PMC5839104/
* Smartwatch accelerometry recognised eating moments in free-living studies with F-scores of 76.1 %
  (7 participants, 1 day) and 71.3 % (1 participant, 31 days) after training on 20 participants in a
  semi-controlled setting.
* Relevance: hand-to-mouth motion is detectable but confusable; it says nothing about *what* is
  consumed. Threshold's gesture output could only ever prompt the user, never log a drink, and requires
  participant-separated validation on its own data before use.

## Transdermal alcohol sensors (not used by Threshold)

**Brobbin E, Deluca P, Hemrage S, Drummond C. Accuracy of wearable transdermal alcohol sensors:
systematic review. _J Med Internet Res_ 2022;24(4):e35178. doi:10.2196/35178.**
https://www.jmir.org/2022/4/e35178
* 32 studies; transdermal readings generally correlated positively with breath/blood alcohol and
  self-report, with inconsistent procedures across studies and device malfunction rates up to 16–38 %
  for one prototype.

**Yu J, Fairbairn CE, Gurrieri L, Caumiant EP. Validating transdermal alcohol biosensors: a
meta-analysis of associations between blood/breath-based measures and transdermal alcohol sensor
output. _Addiction_ 2022;117(11):2805–2815. doi:10.1111/add.15953.** https://pubmed.ncbi.nlm.nih.gov/35603913
* Correlations and lag times vary widely; wrist-worn devices had roughly half the lag of ankle-worn
  devices under mostly laboratory conditions.

**Fairbairn CE, Kang D. Temporal dynamics of transdermal alcohol concentration measured via
new-generation wrist-worn biosensor (2019; PMID 31469451).** https://pmc.ncbi.nlm.nih.gov/articles/PMC6779481/
* Laboratory study of lag between BAC and a wrist-worn transdermal prototype.

Relevance: Apple Watch has no transdermal sensor. Threshold does not simulate one; the data model has
an `external_device` provider type reserved for possible future integrations, which would still never
be presented as BAC.

## Platform constraints (Apple)

* watchOS apps primarily run in the foreground; extended runtime sessions exist only for specific
  types (self care, mindfulness, physical therapy, smart alarm) and must start from the foreground.
  https://developer.apple.com/documentation/watchkit/background-execution ;
  https://developer.apple.com/documentation/watchkit/using-extended-runtime-sessions
  → Threshold captures motion only while the app is open.
* App Review guideline 1.4.3: apps that encourage excessive consumption of alcohol are not permitted.
  https://developer.apple.com/app-store/review/guidelines/
