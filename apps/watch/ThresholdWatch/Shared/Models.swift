import Foundation

// Swift mirrors of packages/shared-types. JSON uses camelCase keys, epoch-millisecond integers
// and explicit `null` for absent optional values (required by the phone's zod schemas), so the
// encoders below write nulls instead of omitting keys.

public typealias EpochMs = Int64

public enum VolumeUnit: String, Codable, Sendable, CaseIterable {
    case ml, cl, l
    case flOzUS = "fl_oz_us"
    case flOzImp = "fl_oz_imp"
}

public struct VolumeInput: Codable, Equatable, Sendable {
    public var value: Double
    public var unit: VolumeUnit
    public init(value: Double, unit: VolumeUnit) {
        self.value = value
        self.unit = unit
    }
}

public enum BeverageCategory: String, Codable, Sendable {
    case beer, wine, spirits, cocktail, cider, nonalcoholic, water, custom
    case hardSeltzer = "hard_seltzer"
    case mixedDrink = "mixed_drink"
}

public enum DataSource: String, Codable, Sendable {
    case manual, watch, imported
    case quickLog = "quick_log"
    case labelScan = "label_scan"
    case gestureAssisted = "gesture_assisted"
}

public enum Confirmation: String, Codable, Sendable {
    case estimated
    case userConfirmed = "user_confirmed"
    case detectedUnconfirmed = "detected_unconfirmed"
}

public struct DrinkUncertainty: Codable, Equatable, Sendable {
    public var abvKnown: Bool
    public var volumeKnown: Bool
    public var standardDrinksLow: Double?
    public var standardDrinksHigh: Double?
    public var note: String?

    public init(abvKnown: Bool, volumeKnown: Bool = true, standardDrinksLow: Double? = nil, standardDrinksHigh: Double? = nil, note: String? = nil) {
        self.abvKnown = abvKnown
        self.volumeKnown = volumeKnown
        self.standardDrinksLow = standardDrinksLow
        self.standardDrinksHigh = standardDrinksHigh
        self.note = note
    }

    enum CodingKeys: String, CodingKey { case abvKnown, volumeKnown, standardDrinksLow, standardDrinksHigh, note }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(abvKnown, forKey: .abvKnown)
        try c.encode(volumeKnown, forKey: .volumeKnown)
        try c.encode(standardDrinksLow, forKey: .standardDrinksLow)
        try c.encode(standardDrinksHigh, forKey: .standardDrinksHigh)
        try c.encode(note, forKey: .note)
    }
}

public struct DrinkEvent: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var sessionId: String
    public var beverageId: String?
    public var beverageName: String
    public var category: BeverageCategory
    public var servingInput: VolumeInput
    public var servingMl: Double
    public var fractionConsumed: Double
    public var abvPercent: Double?
    public var ethanolGrams: Double?
    public var standardDrinks: Double?
    public var standardDrinkGrams: Double
    public var isAlcoholic: Bool
    public var consumedAt: EpochMs
    public var loggedAt: EpochMs
    public var tzOffsetMin: Int
    public var source: DataSource
    public var confirmation: Confirmation
    public var uncertainty: DrinkUncertainty
    public var revision: Int
    public var updatedAt: EpochMs
    public var deletedAt: EpochMs?
    public var deviceId: String

    enum CodingKeys: String, CodingKey {
        case id, sessionId, beverageId, beverageName, category, servingInput, servingMl, fractionConsumed, abvPercent
        case ethanolGrams, standardDrinks, standardDrinkGrams, isAlcoholic, consumedAt, loggedAt, tzOffsetMin, source
        case confirmation, uncertainty, revision, updatedAt, deletedAt, deviceId
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(beverageId, forKey: .beverageId)
        try c.encode(beverageName, forKey: .beverageName)
        try c.encode(category, forKey: .category)
        try c.encode(servingInput, forKey: .servingInput)
        try c.encode(servingMl, forKey: .servingMl)
        try c.encode(fractionConsumed, forKey: .fractionConsumed)
        try c.encode(abvPercent, forKey: .abvPercent)
        try c.encode(ethanolGrams, forKey: .ethanolGrams)
        try c.encode(standardDrinks, forKey: .standardDrinks)
        try c.encode(standardDrinkGrams, forKey: .standardDrinkGrams)
        try c.encode(isAlcoholic, forKey: .isAlcoholic)
        try c.encode(consumedAt, forKey: .consumedAt)
        try c.encode(loggedAt, forKey: .loggedAt)
        try c.encode(tzOffsetMin, forKey: .tzOffsetMin)
        try c.encode(source, forKey: .source)
        try c.encode(confirmation, forKey: .confirmation)
        try c.encode(uncertainty, forKey: .uncertainty)
        try c.encode(revision, forKey: .revision)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(deviceId, forKey: .deviceId)
    }

    /// Mirrors `countsTowardConsumption` in packages/core/src/drinks.ts.
    public var countsTowardConsumption: Bool {
        deletedAt == nil && isAlcoholic && confirmation != .detectedUnconfirmed
    }
}

public enum SessionStatus: String, Codable, Sendable { case active, paused, ended }
public enum SessionOrigin: String, Codable, Sendable {
    case phone, watch
    case autoPrompt = "auto_prompt"
}

public struct PauseInterval: Codable, Equatable, Sendable {
    public var startedAt: EpochMs
    public var endedAt: EpochMs?
    public init(startedAt: EpochMs, endedAt: EpochMs?) {
        self.startedAt = startedAt
        self.endedAt = endedAt
    }
    enum CodingKeys: String, CodingKey { case startedAt, endedAt }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(endedAt, forKey: .endedAt)
    }
}

public struct MeasurementSnapshot: Codable, Equatable, Sendable {
    public var value: Double
    public var unit: String
    public var measuredAt: EpochMs
    public var source: String
}

public struct SessionStartContext: Codable, Equatable, Sendable {
    public var restingHeartRateBpm: MeasurementSnapshot?
    public var hrvSdnnMs: MeasurementSnapshot?
    public var lastNightSleepMinutes: MeasurementSnapshot?
    public var healthDataAuthorized: Bool

    public static let empty = SessionStartContext(restingHeartRateBpm: nil, hrvSdnnMs: nil, lastNightSleepMinutes: nil, healthDataAuthorized: false)

    enum CodingKeys: String, CodingKey { case restingHeartRateBpm, hrvSdnnMs, lastNightSleepMinutes, healthDataAuthorized }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(restingHeartRateBpm, forKey: .restingHeartRateBpm)
        try c.encode(hrvSdnnMs, forKey: .hrvSdnnMs)
        try c.encode(lastNightSleepMinutes, forKey: .lastNightSleepMinutes)
        try c.encode(healthDataAuthorized, forKey: .healthDataAuthorized)
    }
}

public struct SessionGoalSnapshot: Codable, Equatable, Sendable {
    public var maxStandardDrinksPerSession: Double?
    public var paceGoalMinutesBetweenDrinks: Double?
    public init(maxStandardDrinksPerSession: Double?, paceGoalMinutesBetweenDrinks: Double?) {
        self.maxStandardDrinksPerSession = maxStandardDrinksPerSession
        self.paceGoalMinutesBetweenDrinks = paceGoalMinutesBetweenDrinks
    }
    enum CodingKeys: String, CodingKey { case maxStandardDrinksPerSession, paceGoalMinutesBetweenDrinks }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(maxStandardDrinksPerSession, forKey: .maxStandardDrinksPerSession)
        try c.encode(paceGoalMinutesBetweenDrinks, forKey: .paceGoalMinutesBetweenDrinks)
    }
}

public struct DrinkingSession: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var status: SessionStatus
    public var startedAt: EpochMs
    public var endedAt: EpochMs?
    public var tzOffsetMin: Int
    public var pauses: [PauseInterval]
    public var startContext: SessionStartContext
    public var goalSnapshot: SessionGoalSnapshot
    public var origin: SessionOrigin
    public var revision: Int
    public var updatedAt: EpochMs
    public var deletedAt: EpochMs?
    public var deviceId: String

    enum CodingKeys: String, CodingKey {
        case id, status, startedAt, endedAt, tzOffsetMin, pauses, startContext, goalSnapshot, origin, revision, updatedAt, deletedAt, deviceId
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(status, forKey: .status)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(endedAt, forKey: .endedAt)
        try c.encode(tzOffsetMin, forKey: .tzOffsetMin)
        try c.encode(pauses, forKey: .pauses)
        try c.encode(startContext, forKey: .startContext)
        try c.encode(goalSnapshot, forKey: .goalSnapshot)
        try c.encode(origin, forKey: .origin)
        try c.encode(revision, forKey: .revision)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(deviceId, forKey: .deviceId)
    }

    public var isOpen: Bool { status != .ended && deletedAt == nil }
}

// MARK: - Identifiers & time

public enum IDs {
    /// Lowercase UUID v4 (Foundation's UUID is random/v4).
    public static func new() -> String { UUID().uuidString.lowercased() }

    public static func isUUID(_ s: String?) -> Bool {
        guard let s else { return false }
        return UUID(uuidString: s) != nil
    }
}

public enum WallClock {
    public static func nowMs(_ date: Date = Date()) -> EpochMs { EpochMs((date.timeIntervalSince1970 * 1000).rounded()) }
    public static func tzOffsetMin(_ date: Date = Date(), timeZone: TimeZone = .current) -> Int { timeZone.secondsFromGMT(for: date) / 60 }
}
