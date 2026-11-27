import Foundation

/// Session lifecycle and drink construction (ports of session.ts / drinks.ts).
public enum SessionLogic {
    public static func start(now: EpochMs, tzOffsetMin: Int, deviceId: String, goals: SessionGoalSnapshot) -> DrinkingSession {
        DrinkingSession(
            id: IDs.new(), status: .active, startedAt: now, endedAt: nil, tzOffsetMin: tzOffsetMin, pauses: [],
            startContext: .empty, goalSnapshot: goals, origin: .watch, revision: 1, updatedAt: now, deletedAt: nil, deviceId: deviceId
        )
    }

    public static func end(_ s: DrinkingSession, now: EpochMs, deviceId: String) -> DrinkingSession? {
        guard s.status != .ended else { return nil }
        var n = s
        let endedAt = max(now, s.startedAt)
        n.status = .ended
        n.endedAt = endedAt
        n.pauses = s.pauses.map { p in PauseInterval(startedAt: p.startedAt, endedAt: p.endedAt ?? max(endedAt, p.startedAt)) }
        n.revision = s.revision + 1
        n.updatedAt = now
        n.deviceId = deviceId
        return n
    }

    public static func resumeIfPaused(_ s: DrinkingSession, now: EpochMs, deviceId: String) -> DrinkingSession {
        guard s.status == .paused else { return s }
        var n = s
        n.status = .active
        if var last = n.pauses.last, last.endedAt == nil {
            last.endedAt = max(now, last.startedAt)
            n.pauses[n.pauses.count - 1] = last
        }
        n.revision += 1
        n.updatedAt = now
        n.deviceId = deviceId
        return n
    }

    public enum DrinkError: Error, Equatable { case measurement(AlcoholMath.MeasureError), futureTime }

    public static func makeDrink(
        sessionId: String, beverageId: String?, name: String, category: BeverageCategory, serving: VolumeInput,
        fraction: Double, abvPercent: Double?, standardDrinkGrams: Double, now: EpochMs, consumedAt: EpochMs? = nil,
        tzOffsetMin: Int, deviceId: String, source: DataSource = .watch
    ) -> Result<DrinkEvent, DrinkError> {
        let at = consumedAt ?? now
        if at > now + 5 * 60_000 { return .failure(.futureTime) }
        switch AlcoholMath.measure(serving: serving, fractionConsumed: fraction, abvPercent: abvPercent, standardDrinkGrams: standardDrinkGrams) {
        case .failure(let e):
            return .failure(.measurement(e))
        case .success(let m):
            return .success(DrinkEvent(
                id: IDs.new(), sessionId: sessionId, beverageId: IDs.isUUID(beverageId) ? beverageId?.lowercased() : nil,
                beverageName: name.isEmpty ? "Drink" : name, category: category, servingInput: serving, servingMl: m.servingMl,
                fractionConsumed: fraction, abvPercent: abvPercent, ethanolGrams: m.ethanolGrams, standardDrinks: m.standardDrinks,
                standardDrinkGrams: m.standardDrinkGrams,
                isAlcoholic: AlcoholMath.isAlcoholic(category: category, abvPercent: abvPercent, ethanolGrams: m.ethanolGrams),
                consumedAt: at, loggedAt: now, tzOffsetMin: tzOffsetMin, source: source, confirmation: m.confirmation,
                uncertainty: m.uncertainty, revision: 1, updatedAt: now, deletedAt: nil, deviceId: deviceId
            ))
        }
    }

    public static func delete(_ d: DrinkEvent, now: EpochMs, deviceId: String) -> DrinkEvent {
        var n = d
        n.deletedAt = now
        n.revision += 1
        n.updatedAt = now
        n.deviceId = deviceId
        return n
    }

    public static func changePortion(_ d: DrinkEvent, fraction: Double, now: EpochMs, deviceId: String) -> DrinkEvent? {
        guard d.deletedAt == nil else { return nil }
        guard case .success(let m) = AlcoholMath.measure(serving: d.servingInput, fractionConsumed: fraction, abvPercent: d.abvPercent, standardDrinkGrams: d.standardDrinkGrams) else { return nil }
        var n = d
        n.fractionConsumed = fraction
        n.ethanolGrams = m.ethanolGrams
        n.standardDrinks = m.standardDrinks
        n.revision += 1
        n.updatedAt = now
        n.deviceId = deviceId
        return n
    }
}
