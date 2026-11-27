import Foundation

/// Phone ⇄ watch protocol v1 (see apps/mobile/services/watch/protocol.ts). WatchConnectivity
/// dictionaries may only contain property-list types, so structured data is a JSON string.
public enum WatchProtocol {
    public static let version = 1

    public struct Beverage: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var name: String
        public var category: String
        public var servingValue: Double
        public var servingUnit: String
        public var abvPercent: Double?
    }

    public struct Prefs: Codable, Equatable, Sendable {
        public var standardDrinkGrams: Double
        public var label: String
        public var labelPlural: String
        public var notificationFrequency: NotificationFrequency
        public var quietMode: Bool
        public var unitSystem: String
        public var automaticDetectionEnabled: Bool
        /// Present only in research builds when the participant enabled recording.
        public var researchRecording: Bool?

        public static let fallback = Prefs(standardDrinkGrams: 14, label: "standard drink", labelPlural: "standard drinks", notificationFrequency: .standard, quietMode: false, unitSystem: "us_customary", automaticDetectionEnabled: false, researchRecording: nil)
    }

    public struct Context: Codable, Equatable, Sendable {
        public var generatedAt: EpochMs
        public var phoneDeviceId: String
        public var activeSession: DrinkingSession?
        public var drinks: [DrinkEvent]
        public var goals: SessionGoalSnapshot
        public var prefs: Prefs
        public var beverages: [Beverage]
    }

    public struct Records: Codable, Sendable {
        public var sessions: [DrinkingSession]
        public var drinks: [DrinkEvent]
        public init(sessions: [DrinkingSession], drinks: [DrinkEvent]) {
            self.sessions = sessions
            self.drinks = drinks
        }
    }

    public enum DecodeError: Error, Equatable { case missingJSON, unsupportedVersion(Int), invalid }

    public static func decodeContext(_ dict: [String: Any]) throws -> Context {
        let v = (dict["v"] as? Int) ?? (dict["v"] as? NSNumber)?.intValue ?? -1
        guard v == version else { throw DecodeError.unsupportedVersion(v) }
        guard let json = dict["json"] as? String, let data = json.data(using: .utf8) else { throw DecodeError.missingJSON }
        do { return try JSONDecoder().decode(Context.self, from: data) } catch { throw DecodeError.invalid }
    }

    public static func encodeRecords(_ records: Records, messageId: String, sentAt: EpochMs) throws -> [String: Any] {
        let data = try JSONEncoder().encode(records)
        guard let json = String(data: data, encoding: .utf8) else { throw DecodeError.invalid }
        return ["v": version, "id": messageId, "type": "records", "sentAt": sentAt, "json": json]
    }

    public static func requestContext(messageId: String) -> [String: Any] {
        ["v": version, "id": messageId, "type": "request_context"]
    }
}

/// Deterministic last-writer-wins shared with phone and server.
public enum Conflict {
    public static func isNewer(revision: Int, updatedAt: EpochMs, deviceId: String, than other: (revision: Int, updatedAt: EpochMs, deviceId: String)) -> Bool {
        if revision != other.revision { return revision > other.revision }
        if updatedAt != other.updatedAt { return updatedAt > other.updatedAt }
        return deviceId > other.deviceId
    }

    public static func merge(local: DrinkingSession?, remote: DrinkingSession) -> DrinkingSession {
        guard let l = local else { return remote }
        return isNewer(revision: remote.revision, updatedAt: remote.updatedAt, deviceId: remote.deviceId, than: (l.revision, l.updatedAt, l.deviceId)) ? remote : l
    }

    public static func merge(local: [DrinkEvent], remote: [DrinkEvent]) -> [DrinkEvent] {
        var byId = Dictionary(local.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for r in remote {
            if let l = byId[r.id] {
                if isNewer(revision: r.revision, updatedAt: r.updatedAt, deviceId: r.deviceId, than: (l.revision, l.updatedAt, l.deviceId)) { byId[r.id] = r }
            } else {
                byId[r.id] = r
            }
        }
        return byId.values.sorted { $0.consumedAt < $1.consumedAt }
    }
}
