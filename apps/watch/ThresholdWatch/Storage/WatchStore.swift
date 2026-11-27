import Foundation

/// Durable on-watch state. Written atomically to Application Support with file protection
/// "complete until first user authentication" so logging keeps working while the watch is
/// locked on the wrist, and nothing is lost if the app is terminated or the watch restarts.
struct WatchState: Codable, Equatable {
    var deviceId: String
    var session: DrinkingSession?
    var drinks: [DrinkEvent]
    /// Records not yet confirmed as transferred to the phone.
    var outbox: [OutboxItem]
    var lastContext: WatchProtocol.Context?
    var lastContextReceivedAt: EpochMs?
    var interventions: [WatchIntervention]

    static func fresh() -> WatchState {
        WatchState(deviceId: "watch-" + IDs.new(), session: nil, drinks: [], outbox: [], lastContext: nil, lastContextReceivedAt: nil, interventions: [])
    }
}

struct OutboxItem: Codable, Equatable, Identifiable {
    var id: String
    var sessions: [DrinkingSession]
    var drinks: [DrinkEvent]
    var createdAt: EpochMs
    var attempts: Int
}

final class WatchStore {
    private let url: URL
    private let queue = DispatchQueue(label: "threshold.watch.store")

    init(filename: String = "watch-state.json") {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent(filename)
    }

    func load() -> WatchState {
        queue.sync {
            guard let data = try? Data(contentsOf: url), let s = try? JSONDecoder().decode(WatchState.self, from: data) else {
                return WatchState.fresh()
            }
            return s
        }
    }

    func save(_ state: WatchState) {
        queue.sync {
            guard let data = try? JSONEncoder().encode(state) else { return }
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    func wipe() {
        queue.sync { try? FileManager.default.removeItem(at: url) }
    }
}
