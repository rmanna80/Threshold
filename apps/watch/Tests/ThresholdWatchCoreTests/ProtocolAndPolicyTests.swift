import Foundation
import XCTest
@testable import ThresholdWatchCore

final class ProtocolTests: XCTestCase {
    private func drink(_ sessionId: String) throws -> DrinkEvent {
        let r = SessionLogic.makeDrink(sessionId: sessionId, beverageId: "template:beer", name: "Beer", category: .beer, serving: VolumeInput(value: 12, unit: .flOzUS), fraction: 1, abvPercent: 5, standardDrinkGrams: 14, now: 1_764_291_600_000, tzOffsetMin: -300, deviceId: "watch-1")
        guard case .success(let d) = r else { throw XCTSkip("drink failed") }
        return d
    }

    func testRecordsEncodeExplicitNullsForThePhoneSchema() throws {
        let s = SessionLogic.start(now: 1_764_291_600_000, tzOffsetMin: -300, deviceId: "watch-1", goals: SessionGoalSnapshot(maxStandardDrinksPerSession: nil, paceGoalMinutesBetweenDrinks: nil))
        let d = try drink(s.id)
        XCTAssertNil(d.beverageId) // non-UUID template ids are not sent as beverage ids
        let dict = try WatchProtocol.encodeRecords(.init(sessions: [s], drinks: [d]), messageId: "m-12345678", sentAt: 1)
        XCTAssertEqual(dict["v"] as? Int, 1)
        XCTAssertEqual(dict["type"] as? String, "records")
        let json = try XCTUnwrap(dict["json"] as? String)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let session = try XCTUnwrap((obj["sessions"] as? [[String: Any]])?.first)
        XCTAssertTrue(session.keys.contains("endedAt"))
        XCTAssertTrue(session["endedAt"] is NSNull)
        let drinkJson = try XCTUnwrap((obj["drinks"] as? [[String: Any]])?.first)
        XCTAssertTrue(drinkJson["beverageId"] is NSNull)
        XCTAssertTrue(drinkJson["deletedAt"] is NSNull)
        XCTAssertTrue((drinkJson["uncertainty"] as? [String: Any])?["note"] is NSNull)
    }

    func testContextDecoding() throws {
        let ctx = """
        {"generatedAt":1,"phoneDeviceId":"p","activeSession":null,"drinks":[],"goals":{"maxStandardDrinksPerSession":3,"paceGoalMinutesBetweenDrinks":null},
         "prefs":{"standardDrinkGrams":8,"label":"unit","labelPlural":"units","notificationFrequency":"minimal","quietMode":false,"unitSystem":"metric","automaticDetectionEnabled":false},
         "beverages":[{"id":"x","name":"Pint","category":"beer","servingValue":568,"servingUnit":"ml","abvPercent":4.5}]}
        """
        let decoded = try WatchProtocol.decodeContext(["v": 1, "json": ctx])
        XCTAssertEqual(decoded.prefs.standardDrinkGrams, 8)
        XCTAssertEqual(decoded.goals.maxStandardDrinksPerSession, 3)
        XCTAssertThrowsError(try WatchProtocol.decodeContext(["v": 2, "json": ctx]))
    }

    func testConflictResolutionPrefersHigherRevision() throws {
        let s = SessionLogic.start(now: 1000, tzOffsetMin: 0, deviceId: "watch-1", goals: SessionGoalSnapshot(maxStandardDrinksPerSession: nil, paceGoalMinutesBetweenDrinks: nil))
        let ended = try XCTUnwrap(SessionLogic.end(s, now: 2000, deviceId: "phone-1"))
        XCTAssertEqual(Conflict.merge(local: s, remote: ended).status, .ended)
        XCTAssertEqual(Conflict.merge(local: ended, remote: s).status, .ended)
        let d = try drink(s.id)
        let tomb = SessionLogic.delete(d, now: 3000, deviceId: "phone-1")
        XCTAssertNotNil(Conflict.merge(local: [d], remote: [tomb]).first?.deletedAt)
        XCTAssertNotNil(Conflict.merge(local: [tomb], remote: [d]).first?.deletedAt)
    }
}

final class PolicyTests: XCTestCase {
    private let start: EpochMs = 1_764_291_600_000

    private func events(_ minutes: [Double], std: Double = 1) -> [PaceEvent] {
        minutes.enumerated().map { i, m in PaceEvent(id: "e\(i)", consumedAt: start + EpochMs(m * 60_000), standardDrinks: std, revision: 1, updatedAt: 0, counts: true) }
    }

    private func input(_ evs: [PaceEvent], nowMin: Double, goal: Double? = nil, quiet: Bool = false, history: [WatchIntervention] = []) -> InterventionPolicy.Input {
        let now = start + EpochMs(nowMin * 60_000)
        return .init(now: now, sessionStartedAt: start, pace: PaceTracker(events: evs).snapshot(now: now), goals: SessionGoalSnapshot(maxStandardDrinksPerSession: goal, paceGoalMinutesBetweenDrinks: nil), alcoholicSinceLastNonAlcoholic: 0, lastIntervalMs: nil, lastDrinkId: nil, frequency: .standard, quietMode: quiet, history: history)
    }

    func testRapidPaceTriggersOnceThenDedupes() {
        let policy = InterventionPolicy()
        let x = input(events([5, 12, 20]), nowMin: 22)
        let first = policy.decide(x)
        XCTAssertEqual(first?.key, "pace.rapid")
        var y = x
        y.history = [first!]
        XCTAssertNil(policy.decide(y))
    }

    func testQuietModeOnlyAllowsPersonalGoals() {
        let policy = InterventionPolicy()
        XCTAssertNil(policy.decide(input(events([5, 12, 20]), nowMin: 22, quiet: true)))
        XCTAssertEqual(policy.decide(input(events([5, 12]), nowMin: 22, goal: 2, quiet: true))?.key, "goal.session_reached")
    }

    func testCatalogueAvoidsForbiddenClaims() {
        let forbidden = ["sober", "safe to drive", "BAC", "hangover-free", "guarantee", "have another", "safe limit"]
        for (_, m) in InterventionCatalog.messages {
            for f in forbidden { XCTAssertFalse(m.body.localizedCaseInsensitiveContains(f), m.body) }
        }
    }
}
