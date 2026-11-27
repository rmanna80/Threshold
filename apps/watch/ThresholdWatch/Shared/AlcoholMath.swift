import Foundation

/// Swift port of packages/core/src/alcohol.ts + units.ts. Verified against
/// packages/core/test-vectors/alcohol.json in ThresholdWatchCoreTests.
public enum AlcoholMath {
    public static let ethanolDensityGPerMl = 0.789
    public static let maxServingMl = 5000.0

    public static func millilitresPerUnit(_ unit: VolumeUnit) -> Double {
        switch unit {
        case .ml: return 1
        case .cl: return 10
        case .l: return 1000
        case .flOzUS: return 29.5735295625
        case .flOzImp: return 28.4130625
        }
    }

    public static func toMillilitres(_ v: VolumeInput) -> Double { v.value * millilitresPerUnit(v.unit) }

    /// ethanol_grams = volume_ml × (abv_percent / 100) × 0.789
    public static func ethanolGrams(volumeMl: Double, abvPercent: Double) -> Double {
        volumeMl * (abvPercent / 100) * ethanolDensityGPerMl
    }

    public struct Measurement: Equatable, Sendable {
        public let servingMl: Double
        public let consumedMl: Double
        public let ethanolGrams: Double?
        public let standardDrinks: Double?
        public let standardDrinkGrams: Double
        public let confirmation: Confirmation
        public let uncertainty: DrinkUncertainty
    }

    public enum MeasureError: String, Error, Equatable, Sendable {
        case invalidVolume = "invalid_volume"
        case invalidFraction = "invalid_fraction"
        case invalidAbv = "invalid_abv"
        case invalidDefinition = "invalid_definition"
        case implausibleVolume = "implausible_volume"
    }

    /// Deterministic measurement; never assumes a missing ABV (returns nil grams instead).
    public static func measure(serving: VolumeInput, fractionConsumed: Double, abvPercent: Double?, standardDrinkGrams: Double) -> Result<Measurement, MeasureError> {
        guard serving.value.isFinite, serving.value > 0 else { return .failure(.invalidVolume) }
        guard fractionConsumed.isFinite, fractionConsumed > 0, fractionConsumed <= 1 else { return .failure(.invalidFraction) }
        if let abv = abvPercent, !(abv.isFinite && abv >= 0 && abv <= 100) { return .failure(.invalidAbv) }
        guard standardDrinkGrams.isFinite, standardDrinkGrams > 0 else { return .failure(.invalidDefinition) }
        let servingMl = toMillilitres(serving)
        guard servingMl <= maxServingMl else { return .failure(.implausibleVolume) }
        let consumed = servingMl * fractionConsumed
        if let abv = abvPercent {
            let grams = ethanolGrams(volumeMl: consumed, abvPercent: abv)
            return .success(Measurement(
                servingMl: servingMl,
                consumedMl: consumed,
                ethanolGrams: grams,
                standardDrinks: grams / standardDrinkGrams,
                standardDrinkGrams: standardDrinkGrams,
                confirmation: .userConfirmed,
                uncertainty: DrinkUncertainty(abvKnown: true)
            ))
        }
        return .success(Measurement(
            servingMl: servingMl,
            consumedMl: consumed,
            ethanolGrams: nil,
            standardDrinks: nil,
            standardDrinkGrams: standardDrinkGrams,
            confirmation: .estimated,
            uncertainty: DrinkUncertainty(abvKnown: false, note: "Alcohol content unknown.")
        ))
    }

    public static func isAlcoholic(category: BeverageCategory, abvPercent: Double?, ethanolGrams: Double?) -> Bool {
        if category == .nonalcoholic || category == .water { return (ethanolGrams ?? 0) > 0 }
        if abvPercent == 0 { return false }
        return true
    }
}
