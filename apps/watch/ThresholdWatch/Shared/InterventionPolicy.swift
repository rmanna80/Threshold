import Foundation

/// Watch-side subset of packages/core/src/interventions.ts, using the identical message
/// catalogue so wording is consistent across devices. Personal goals are always described as the
/// user's own goals; nothing here implies a safe amount or pace.
public enum NotificationFrequency: String, Codable, Sendable { case minimal, standard, frequent }

public struct WatchIntervention: Codable, Equatable, Sendable {
    public var key: String
    public var dedupeKey: String
    public var title: String
    public var body: String
    public var priority: Int
    public var triggeredAt: EpochMs
}

public enum InterventionCatalog {
    public static let messages: [String: (title: String, body: String)] = [
        "pace.rapid": ("Pace check", "You’ve recorded several drinks in a short period. Consider taking a break from alcohol."),
        "goal.session_reached": ("Your goal for tonight", "You’ve reached the moderation goal you set before this session."),
        "goal.session_above": ("Your goal for tonight", "You’re now above the goal you set for this session. Consider switching to water or a non-alcoholic drink."),
        "goal.pace": ("Your pacing goal", "Your last two drinks were closer together than the pacing goal you set."),
        "alternative.switch": ("A change of glass", "Consider switching to water or a non-alcoholic beverage."),
        "closure.consider_ending": ("Winding down", "Consider ending alcohol consumption for the evening."),
    ]
}

public struct InterventionPolicy: Sendable {
    public struct Input: Sendable {
        public var now: EpochMs
        public var sessionStartedAt: EpochMs
        public var pace: PaceSnapshot
        public var goals: SessionGoalSnapshot
        public var alcoholicSinceLastNonAlcoholic: Int
        public var lastIntervalMs: EpochMs?
        public var lastDrinkId: String?
        public var frequency: NotificationFrequency
        public var quietMode: Bool
        public var history: [WatchIntervention]

        public init(now: EpochMs, sessionStartedAt: EpochMs, pace: PaceSnapshot, goals: SessionGoalSnapshot, alcoholicSinceLastNonAlcoholic: Int, lastIntervalMs: EpochMs?, lastDrinkId: String?, frequency: NotificationFrequency, quietMode: Bool, history: [WatchIntervention]) {
            self.now = now
            self.sessionStartedAt = sessionStartedAt
            self.pace = pace
            self.goals = goals
            self.alcoholicSinceLastNonAlcoholic = alcoholicSinceLastNonAlcoholic
            self.lastIntervalMs = lastIntervalMs
            self.lastDrinkId = lastDrinkId
            self.frequency = frequency
            self.quietMode = quietMode
            self.history = history
        }
    }

    private static let eps = 1e-9
    private static let minute: EpochMs = 60_000

    public init() {}

    static func gap(_ f: NotificationFrequency) -> (minGap: EpochMs, maxPerSession: Int, maxPriority: Int) {
        switch f {
        case .minimal: return (30 * minute, 4, 1)
        case .standard: return (15 * minute, 8, 2)
        case .frequent: return (10 * minute, 12, 3)
        }
    }

    private func make(_ key: String, _ dedupe: String, _ priority: Int, _ now: EpochMs) -> WatchIntervention? {
        guard let m = InterventionCatalog.messages[key] else { return nil }
        return WatchIntervention(key: key, dedupeKey: dedupe, title: m.title, body: m.body, priority: priority, triggeredAt: now)
    }

    public func propose(_ x: Input) -> [WatchIntervention] {
        var out: [WatchIntervention] = []
        let total = x.pace.totalStandardDrinks
        if x.pace.rapidConsumption, let c = make("pace.rapid", "pace:rapid:\(x.pace.totalDrinks)", 1, x.now) { out.append(c) }
        if let g = x.goals.maxStandardDrinksPerSession, g > 0 {
            if total > g + Self.eps, let c = make("goal.session_above", "goal:session:above", 1, x.now) { out.append(c) }
            else if total + Self.eps >= g, let c = make("goal.session_reached", "goal:session:reached", 1, x.now) { out.append(c) }
        }
        if let pg = x.goals.paceGoalMinutesBetweenDrinks, let li = x.lastIntervalMs, let id = x.lastDrinkId, Double(li) < pg * 60_000,
           let c = make("goal.pace", "goal:pace:\(id)", 2, x.now) { out.append(c) }
        if x.alcoholicSinceLastNonAlcoholic >= 2,
           let c = make("alternative.switch", "alt:\(x.pace.totalDrinks - x.alcoholicSinceLastNonAlcoholic):\(x.alcoholicSinceLastNonAlcoholic / 2)", 2, x.now) { out.append(c) }
        let longAndActive = x.now - x.sessionStartedAt >= 240 * Self.minute && (x.pace.timeSinceLastDrinkMs ?? .max) < 60 * Self.minute
        let aboveGoal = (x.goals.maxStandardDrinksPerSession.map { total > $0 + 1 + Self.eps }) ?? false
        if longAndActive || aboveGoal, let c = make("closure.consider_ending", "closure:session", 2, x.now) { out.append(c) }
        return out
    }

    /// Returns at most one intervention to deliver now.
    public func decide(_ x: Input) -> WatchIntervention? {
        let cfg = Self.gap(x.frequency)
        let seen = Set(x.history.map { $0.dedupeKey })
        if x.history.count >= cfg.maxPerSession { return nil }
        let last = x.history.map { $0.triggeredAt }.max()
        let candidates = propose(x).filter { !seen.contains($0.dedupeKey) }.sorted { $0.priority < $1.priority }
        for c in candidates {
            let isGoal = c.key.hasPrefix("goal.")
            if x.quietMode && !isGoal { continue }
            if c.priority > cfg.maxPriority { continue }
            let bypass = isGoal && c.priority == 1
            if !bypass, let l = last, x.now - l < cfg.minGap { continue }
            return c
        }
        return nil
    }
}

/// Counts alcoholic drinks after the most recent non-alcoholic drink (water/mocktail).
public func alcoholicSinceLastNonAlcoholic(_ drinks: [DrinkEvent]) -> Int {
    var count = 0
    for d in drinks.filter({ $0.deletedAt == nil }).sorted(by: { $0.consumedAt < $1.consumedAt }) {
        if !d.isAlcoholic { count = 0 } else if d.countsTowardConsumption { count += 1 }
    }
    return count
}
