import Foundation
import Observation
import UserNotifications
import WatchKit

/// Main watch state machine. All logging works offline; records are queued for the phone and
/// pace reminders are evaluated on the watch itself with the shared policy.
@MainActor
@Observable
final class WatchSessionModel {
    private(set) var state: WatchState
    private(set) var reachable = false
    private(set) var banner: WatchIntervention?
    private let store: WatchStore
    private let connectivity: WatchConnectivityManager
    private let policy = InterventionPolicy()

    init(store: WatchStore = WatchStore(), connectivity: WatchConnectivityManager = WatchConnectivityManager()) {
        self.store = store
        self.connectivity = connectivity
        self.state = store.load()
        // The connectivity manager always invokes these callbacks on the main queue.
        connectivity.onContext = { [weak self] ctx in MainActor.assumeIsolated { self?.applyContext(ctx) } }
        connectivity.onTransferFinished = { [weak self] id, ok in MainActor.assumeIsolated { self?.transferFinished(id: id, ok: ok) } }
        connectivity.onReachabilityChange = { [weak self] r in
            MainActor.assumeIsolated {
                self?.reachable = r
                if r { self?.flushOutbox(retry: true) }
            }
        }
        connectivity.activate()
        reachable = connectivity.isReachable
        if !connectivity.latestContext.isEmpty { applyContext(connectivity.latestContext) }
        connectivity.requestContext()
        flushOutbox(retry: true)
    }

    // MARK: Derived state

    var prefs: WatchProtocol.Prefs { state.lastContext?.prefs ?? .fallback }
    var session: DrinkingSession? { state.session?.isOpen == true ? state.session : nil }
    var activeDrinks: [DrinkEvent] {
        guard let s = session else { return [] }
        return state.drinks.filter { $0.sessionId == s.id && $0.deletedAt == nil }.sorted { $0.consumedAt > $1.consumedAt }
    }
    var beverages: [WatchProtocol.Beverage] { state.lastContext?.beverages ?? [] }
    var pendingCount: Int { state.outbox.count }
    var hasPhoneContext: Bool { state.lastContext != nil }

    func pace(now: EpochMs = WallClock.nowMs()) -> PaceSnapshot {
        PaceTracker(events: activeDrinks.map { PaceEvent($0) }).snapshot(now: now)
    }

    // MARK: Actions

    func startEvening() {
        guard session == nil else { return }
        let now = WallClock.nowMs()
        let goals = state.lastContext?.goals ?? SessionGoalSnapshot(maxStandardDrinksPerSession: nil, paceGoalMinutesBetweenDrinks: nil)
        let s = SessionLogic.start(now: now, tzOffsetMin: WallClock.tzOffsetMin(), deviceId: state.deviceId, goals: goals)
        state.session = s
        state.interventions = []
        enqueue(sessions: [s], drinks: [])
        WKInterfaceDevice.current().play(.start)
    }

    func endSession() {
        guard let s = session, let ended = SessionLogic.end(s, now: WallClock.nowMs(), deviceId: state.deviceId) else { return }
        state.session = ended
        enqueue(sessions: [ended], drinks: [])
        WKInterfaceDevice.current().play(.stop)
    }

    @discardableResult
    func log(beverage: WatchProtocol.Beverage, fraction: Double) -> Bool {
        guard var s = session else { return false }
        let now = WallClock.nowMs()
        let unit = VolumeUnit(rawValue: beverage.servingUnit) ?? .flOzUS
        let category = BeverageCategory(rawValue: beverage.category) ?? .custom
        let result = SessionLogic.makeDrink(
            sessionId: s.id, beverageId: beverage.id, name: beverage.name, category: category,
            serving: VolumeInput(value: beverage.servingValue, unit: unit), fraction: fraction, abvPercent: beverage.abvPercent,
            standardDrinkGrams: prefs.standardDrinkGrams, now: now, tzOffsetMin: WallClock.tzOffsetMin(), deviceId: state.deviceId
        )
        guard case .success(let drink) = result else {
            WKInterfaceDevice.current().play(.failure)
            return false
        }
        var sessions: [DrinkingSession] = []
        if s.status == .paused {
            s = SessionLogic.resumeIfPaused(s, now: now, deviceId: state.deviceId)
            state.session = s
            sessions.append(s)
        }
        state.drinks.append(drink)
        enqueue(sessions: sessions, drinks: [drink])
        WKInterfaceDevice.current().play(.success)
        evaluateInterventions(now: now)
        return true
    }

    func logWater() {
        let water = WatchProtocol.Beverage(id: "template:water_glass", name: "Water", category: "water", servingValue: 8, servingUnit: "fl_oz_us", abvPercent: 0)
        log(beverage: water, fraction: 1)
    }

    func delete(_ drink: DrinkEvent) {
        guard let idx = state.drinks.firstIndex(where: { $0.id == drink.id }) else { return }
        let tomb = SessionLogic.delete(state.drinks[idx], now: WallClock.nowMs(), deviceId: state.deviceId)
        state.drinks[idx] = tomb
        enqueue(sessions: [], drinks: [tomb])
        WKInterfaceDevice.current().play(.click)
    }

    func changePortion(_ drink: DrinkEvent, fraction: Double) {
        guard let idx = state.drinks.firstIndex(where: { $0.id == drink.id }),
              let updated = SessionLogic.changePortion(state.drinks[idx], fraction: fraction, now: WallClock.nowMs(), deviceId: state.deviceId) else { return }
        state.drinks[idx] = updated
        enqueue(sessions: [], drinks: [updated])
    }

    func dismissBanner() { banner = nil }

    // MARK: Interventions (on-watch; haptic + local notification)

    private func evaluateInterventions(now: EpochMs) {
        guard let s = session else { return }
        let alcoholic = activeDrinks.filter { $0.countsTowardConsumption }.sorted { $0.consumedAt < $1.consumedAt }
        let last = alcoholic.last
        let prev = alcoholic.count >= 2 ? alcoholic[alcoholic.count - 2] : nil
        let input = InterventionPolicy.Input(
            now: now, sessionStartedAt: s.startedAt, pace: pace(now: now), goals: s.goalSnapshot,
            alcoholicSinceLastNonAlcoholic: alcoholicSinceLastNonAlcoholic(activeDrinks),
            lastIntervalMs: (last != nil && prev != nil) ? last!.consumedAt - prev!.consumedAt : nil,
            lastDrinkId: last?.id, frequency: prefs.notificationFrequency, quietMode: prefs.quietMode, history: state.interventions
        )
        guard let decision = policy.decide(input) else { return }
        state.interventions.append(decision)
        persist()
        banner = decision
        WKInterfaceDevice.current().play(.notification)
        let content = UNMutableNotificationContent()
        content.title = decision.title
        content.body = decision.body
        let request = UNNotificationRequest(identifier: "threshold.\(decision.dedupeKey)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: Sync

    private func enqueue(sessions: [DrinkingSession], drinks: [DrinkEvent]) {
        state.outbox.append(OutboxItem(id: IDs.new(), sessions: sessions, drinks: drinks, createdAt: WallClock.nowMs(), attempts: 0))
        persist()
        flushOutbox()
    }

    /// Sends new outbox items; with `retry`, also re-sends items the system no longer has queued
    /// (e.g. after a restart). The phone de-duplicates by message id, so re-sending is safe.
    private func flushOutbox(retry: Bool = false) {
        let outstanding = connectivity.outstandingMessageIds
        for i in state.outbox.indices {
            let item = state.outbox[i]
            if outstanding.contains(item.id) { continue }
            if item.attempts > 0 && !retry { continue }
            guard let payload = try? WatchProtocol.encodeRecords(.init(sessions: item.sessions, drinks: item.drinks), messageId: item.id, sentAt: WallClock.nowMs()) else { continue }
            if connectivity.send(payload) { state.outbox[i].attempts += 1 }
        }
        persist()
    }

    private func transferFinished(id: String, ok: Bool) {
        if ok { state.outbox.removeAll { $0.id == id } }
        persist()
    }

    private func applyContext(_ dict: [String: Any]) {
        guard let ctx = try? WatchProtocol.decodeContext(dict) else { return }
        state.lastContext = ctx
        state.lastContextReceivedAt = WallClock.nowMs()
        if let remote = ctx.activeSession {
            state.session = Conflict.merge(local: state.session?.id == remote.id ? state.session : nil, remote: remote)
            state.drinks = Conflict.merge(local: state.drinks.filter { $0.sessionId == remote.id }, remote: ctx.drinks)
        } else if let local = state.session, local.isOpen {
            // The phone reports no open session. Keep a local session that hasn't reached the
            // phone yet; otherwise the phone ended it.
            let unsent = state.outbox.contains { $0.sessions.contains { $0.id == local.id } }
            if !unsent, let ended = SessionLogic.end(local, now: WallClock.nowMs(), deviceId: state.deviceId) {
                state.session = ended
            }
        }
        persist()
    }

    private func persist() { store.save(state) }
}
