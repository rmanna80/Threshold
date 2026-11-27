import Foundation

/// Swift port of packages/core/src/pace.ts (PaceTracker.snapshot). Verified against
/// packages/core/test-vectors/pace.json. Thresholds trigger reminders only — never "safe" limits.
public struct PaceThresholds: Sendable {
    public var rapidStandardDrinksIn30Min = 2.0
    public var rapidStandardDrinksIn60Min = 3.0
    public var rapidDrinkCountIn30Min = 3
    public var concentratedStandardDrinksIn120Min = 4.0
    public var clusterGapMinutes = 20.0
    public var clockSkewToleranceMs: EpochMs = 5 * 60_000
    public init() {}
}

public struct PaceEvent: Equatable, Sendable {
    public var id: String
    public var consumedAt: EpochMs
    public var standardDrinks: Double?
    public var revision: Int
    public var updatedAt: EpochMs
    public var counts: Bool

    public init(id: String, consumedAt: EpochMs, standardDrinks: Double?, revision: Int, updatedAt: EpochMs, counts: Bool) {
        self.id = id
        self.consumedAt = consumedAt
        self.standardDrinks = standardDrinks
        self.revision = revision
        self.updatedAt = updatedAt
        self.counts = counts
    }

    public init(_ d: DrinkEvent) {
        self.init(id: d.id, consumedAt: d.consumedAt, standardDrinks: d.standardDrinks, revision: d.revision, updatedAt: d.updatedAt, counts: d.countsTowardConsumption)
    }
}

public struct WindowStats: Equatable, Sendable {
    public var drinkCount: Int
    public var unknownStrengthCount: Int
    public var standardDrinks: Double
}

public struct PaceSnapshot: Equatable, Sendable {
    public var totalDrinks: Int
    public var totalUnknownStrength: Int
    public var totalStandardDrinks: Double
    public var windows: [Int: WindowStats]
    public var timeSinceLastDrinkMs: EpochMs?
    public var meanIntervalMs: Double?
    public var maxDrinksInAny30Min: Int
    public var maxStandardDrinksInAny60Min: Double
    public var clusterCount: Int
    public var rapidReasons: [String]
    public var concentrated: Bool
    public var clockSkewDetected: Bool
    public var rapidConsumption: Bool { !rapidReasons.isEmpty }
}

public struct PaceTracker: Sendable {
    public static let windowsMinutes = [15, 30, 60, 120]
    private static let eps = 1e-9
    private static let minute: EpochMs = 60_000

    public let thresholds: PaceThresholds
    private var byId: [String: PaceEvent] = [:]
    private var sorted: [PaceEvent] = []
    private var times: [EpochMs] = []
    private var pStd: [Double] = [0]
    private var pUnknown: [Int] = [0]

    public init(thresholds: PaceThresholds = PaceThresholds(), events: [PaceEvent] = []) {
        self.thresholds = thresholds
        for e in events { _ = apply(e) }
        rebuild()
    }

    @discardableResult
    public mutating func upsert(_ e: PaceEvent) -> Bool {
        let changed = apply(e)
        if changed { rebuild() }
        return changed
    }

    private mutating func apply(_ e: PaceEvent) -> Bool {
        if let existing = byId[e.id] {
            let newer = e.revision > existing.revision || (e.revision == existing.revision && e.updatedAt > existing.updatedAt)
            if !newer { return false }
        }
        byId[e.id] = e
        return true
    }

    private mutating func rebuild() {
        sorted = byId.values.filter { $0.counts }.sorted { a, b in
            a.consumedAt != b.consumedAt ? a.consumedAt < b.consumedAt : a.id < b.id
        }
        times = sorted.map { $0.consumedAt }
        pStd = [0]
        pUnknown = [0]
        for e in sorted {
            pStd.append(pStd[pStd.count - 1] + (e.standardDrinks ?? 0))
            pUnknown.append(pUnknown[pUnknown.count - 1] + (e.standardDrinks == nil ? 1 : 0))
        }
    }

    /// Index of the first element strictly greater than `target`.
    private func upperBound(_ target: EpochMs) -> Int {
        var lo = 0
        var hi = times.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if times[mid] <= target { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    /// Stats for events in (from, to].
    private func range(_ from: EpochMs, _ to: EpochMs) -> WindowStats {
        let i = upperBound(from)
        let j = upperBound(to)
        let n = max(0, j - i)
        return WindowStats(drinkCount: n, unknownStrengthCount: n == 0 ? 0 : pUnknown[j] - pUnknown[i], standardDrinks: n == 0 ? 0 : pStd[j] - pStd[i])
    }

    public func snapshot(now: EpochMs) -> PaceSnapshot {
        let t = thresholds
        let horizon = now + t.clockSkewToleranceMs
        let visibleEnd = upperBound(horizon)
        let visible = Array(sorted.prefix(visibleEnd))
        var windows: [Int: WindowStats] = [:]
        for w in PaceTracker.windowsMinutes {
            windows[w] = range(now - EpochMs(w) * PaceTracker.minute, horizon)
        }
        var intervals: [Double] = []
        if visible.count > 1 {
            for i in 1..<visible.count { intervals.append(Double(visible[i].consumedAt - visible[i - 1].consumedAt)) }
        }
        var max30 = 0
        var max60 = 0.0
        var i30 = 0
        var i60 = 0
        for j in 0..<visible.count {
            let tj = visible[j].consumedAt
            while visible[i30].consumedAt <= tj - 30 * PaceTracker.minute { i30 += 1 }
            while visible[i60].consumedAt <= tj - 60 * PaceTracker.minute { i60 += 1 }
            max30 = max(max30, j - i30 + 1)
            max60 = max(max60, pStd[j + 1] - pStd[i60])
        }
        var clusters = 0
        var lastAt: EpochMs?
        for e in visible {
            if let l = lastAt, Double(e.consumedAt - l) <= t.clusterGapMinutes * 60_000 {
                // same cluster
            } else {
                clusters += 1
            }
            lastAt = e.consumedAt
        }
        var reasons: [String] = []
        let w30 = windows[30] ?? WindowStats(drinkCount: 0, unknownStrengthCount: 0, standardDrinks: 0)
        let w60 = windows[60] ?? w30
        let w120 = windows[120] ?? w60
        if w30.standardDrinks + PaceTracker.eps >= t.rapidStandardDrinksIn30Min { reasons.append("std_30") }
        if w60.standardDrinks + PaceTracker.eps >= t.rapidStandardDrinksIn60Min { reasons.append("std_60") }
        if w30.drinkCount >= t.rapidDrinkCountIn30Min { reasons.append("count_30") }
        return PaceSnapshot(
            totalDrinks: sorted.count,
            totalUnknownStrength: pUnknown[pUnknown.count - 1],
            totalStandardDrinks: pStd[pStd.count - 1],
            windows: windows,
            timeSinceLastDrinkMs: visible.last.map { max(0, now - $0.consumedAt) },
            meanIntervalMs: intervals.isEmpty ? nil : intervals.reduce(0, +) / Double(intervals.count),
            maxDrinksInAny30Min: max30,
            maxStandardDrinksInAny60Min: max60,
            clusterCount: clusters,
            rapidReasons: reasons,
            concentrated: w120.standardDrinks + PaceTracker.eps >= t.concentratedStandardDrinksIn120Min,
            clockSkewDetected: visibleEnd < sorted.count
        )
    }
}
