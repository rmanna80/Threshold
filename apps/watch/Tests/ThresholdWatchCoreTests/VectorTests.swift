import Foundation
import XCTest
@testable import ThresholdWatchCore

/// Loads the shared JSON vectors from packages/core/test-vectors so Swift, TypeScript and Python
/// are checked against identical expectations.
enum Vectors {
    static var directory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // ThresholdWatchCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // apps/watch
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent() // repo root
            .appendingPathComponent("packages/core/test-vectors")
    }

    static func load(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: directory.appendingPathComponent(name))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

final class AlcoholVectorTests: XCTestCase {
    func testValidVectors() throws {
        let doc = try Vectors.load("alcohol.json")
        let regionGrams = try XCTUnwrap(doc["regionGrams"] as? [String: Double])
        XCTAssertEqual(doc["ethanolDensity"] as? Double, AlcoholMath.ethanolDensityGPerMl)
        for case let c as [String: Any] in try XCTUnwrap(doc["valid"] as? [Any]) {
            let input = try XCTUnwrap(c["input"] as? [String: Any])
            let expected = try XCTUnwrap(c["expected"] as? [String: Any])
            let serving = try XCTUnwrap(input["serving"] as? [String: Any])
            let unit = try XCTUnwrap(VolumeUnit(rawValue: try XCTUnwrap(serving["unit"] as? String)))
            let grams = try XCTUnwrap(regionGrams[try XCTUnwrap(input["region"] as? String)])
            let result = AlcoholMath.measure(
                serving: VolumeInput(value: try XCTUnwrap(serving["value"] as? Double), unit: unit),
                fractionConsumed: try XCTUnwrap(input["fractionConsumed"] as? Double),
                abvPercent: input["abvPercent"] as? Double,
                standardDrinkGrams: grams
            )
            guard case .success(let m) = result else { return XCTFail("\(c["name"] ?? "?") failed") }
            XCTAssertEqual(m.servingMl, try XCTUnwrap(expected["servingMl"] as? Double), accuracy: 1e-9)
            XCTAssertEqual(m.ethanolGrams ?? -1, try XCTUnwrap(expected["ethanolGrams"] as? Double), accuracy: 1e-9)
            XCTAssertEqual(m.standardDrinks ?? -1, try XCTUnwrap(expected["standardDrinks"] as? Double), accuracy: 1e-9)
        }
    }

    func testInvalidVectors() throws {
        let doc = try Vectors.load("alcohol.json")
        for case let c as [String: Any] in try XCTUnwrap(doc["invalid"] as? [Any]) {
            let input = try XCTUnwrap(c["input"] as? [String: Any])
            let serving = try XCTUnwrap(input["serving"] as? [String: Any])
            let expectedCode = try XCTUnwrap(c["expectedErrorCode"] as? String)
            guard let unit = VolumeUnit(rawValue: try XCTUnwrap(serving["unit"] as? String)) else {
                XCTAssertEqual(expectedCode, "invalid_unit") // unknown units cannot be represented in Swift
                continue
            }
            let result = AlcoholMath.measure(
                serving: VolumeInput(value: try XCTUnwrap(serving["value"] as? Double), unit: unit),
                fractionConsumed: try XCTUnwrap(input["fractionConsumed"] as? Double),
                abvPercent: input["abvPercent"] as? Double,
                standardDrinkGrams: 14
            )
            guard case .failure(let e) = result else { return XCTFail("\(c["name"] ?? "?") should fail") }
            XCTAssertEqual(e.rawValue, expectedCode)
        }
    }

    func testUnknownAbvIsNeverAssumed() {
        guard case .success(let m) = AlcoholMath.measure(serving: VolumeInput(value: 6, unit: .flOzUS), fractionConsumed: 1, abvPercent: nil, standardDrinkGrams: 14) else {
            return XCTFail("measure failed")
        }
        XCTAssertNil(m.ethanolGrams)
        XCTAssertNil(m.standardDrinks)
        XCTAssertEqual(m.confirmation, .estimated)
    }
}

final class PaceVectorTests: XCTestCase {
    func testPaceVectors() throws {
        let doc = try Vectors.load("pace.json")
        for case let c as [String: Any] in try XCTUnwrap(doc["cases"] as? [Any]) {
            let name = c["name"] as? String ?? "?"
            var tracker = PaceTracker()
            for case let e as [String: Any] in try XCTUnwrap(c["events"] as? [Any]) {
                tracker.upsert(PaceEvent(
                    id: try XCTUnwrap(e["id"] as? String),
                    consumedAt: Int64(try XCTUnwrap(e["consumedAt"] as? Double)),
                    standardDrinks: e["standardDrinks"] as? Double,
                    revision: try XCTUnwrap(e["revision"] as? Int),
                    updatedAt: Int64(try XCTUnwrap(e["updatedAt"] as? Double)),
                    counts: try XCTUnwrap(e["counts"] as? Bool)
                ))
            }
            let s = tracker.snapshot(now: Int64(try XCTUnwrap(c["now"] as? Double)))
            let x = try XCTUnwrap(c["expected"] as? [String: Any])
            XCTAssertEqual(s.totalDrinks, x["totalDrinks"] as? Int, name)
            XCTAssertEqual(s.totalUnknownStrength, x["totalUnknownStrength"] as? Int, name)
            XCTAssertEqual(s.totalStandardDrinks, try XCTUnwrap(x["totalStandardDrinks"] as? Double), accuracy: 1e-9, name)
            let windows = try XCTUnwrap(x["windows"] as? [String: [String: Any]])
            for w in [15, 30, 60, 120] {
                let ew = try XCTUnwrap(windows[String(w)])
                XCTAssertEqual(s.windows[w]?.drinkCount, ew["drinkCount"] as? Int, "\(name) w\(w)")
                XCTAssertEqual(s.windows[w]?.standardDrinks ?? -1, try XCTUnwrap(ew["standardDrinks"] as? Double), accuracy: 1e-9, "\(name) w\(w)")
            }
            XCTAssertEqual(s.maxDrinksInAny30Min, x["maxDrinksInAny30Min"] as? Int, name)
            XCTAssertEqual(s.maxStandardDrinksInAny60Min, try XCTUnwrap(x["maxStandardDrinksInAny60Min"] as? Double), accuracy: 1e-9, name)
            XCTAssertEqual(s.clusterCount, x["clusterCount"] as? Int, name)
            XCTAssertEqual(s.rapidReasons, x["rapidReasons"] as? [String], name)
            XCTAssertEqual(s.concentrated, x["concentrated"] as? Bool, name)
            XCTAssertEqual(s.clockSkewDetected, x["clockSkewDetected"] as? Bool, name)
            if let mean = x["meanIntervalMs"] as? Double {
                XCTAssertEqual(s.meanIntervalMs ?? -1, mean, accuracy: 1e-6, name)
            } else {
                XCTAssertNil(s.meanIntervalMs, name)
            }
        }
    }
}
