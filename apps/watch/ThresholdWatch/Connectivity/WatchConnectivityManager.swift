import Foundation
import WatchConnectivity

/// Watch side of WatchConnectivity.
///  - Receives the phone's latest state via `applicationContext` (latest value wins).
///  - Sends records with `transferUserInfo`, which the system queues and delivers even when the
///    phone app is not running; the phone persists them in a durable inbox.
final class WatchConnectivityManager: NSObject, WCSessionDelegate {
    var onContext: (([String: Any]) -> Void)?
    var onTransferFinished: ((String, Bool) -> Void)?
    var onReachabilityChange: ((Bool) -> Void)?

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    var isReachable: Bool { WCSession.isSupported() && WCSession.default.isReachable }

    /// Queue a records message. Returns false if the session is not ready (caller keeps it in the outbox).
    @discardableResult
    func send(_ payload: [String: Any]) -> Bool {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return false }
        WCSession.default.transferUserInfo(payload)
        return true
    }

    func requestContext() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let msg = WatchProtocol.requestContext(messageId: IDs.new())
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(msg, replyHandler: nil) { _ in WCSession.default.transferUserInfo(msg) }
        } else {
            WCSession.default.transferUserInfo(msg)
        }
    }

    /// Message ids of transfers the system is still delivering.
    var outstandingMessageIds: Set<String> {
        guard WCSession.isSupported() else { return [] }
        return Set(WCSession.default.outstandingUserInfoTransfers.compactMap { $0.userInfo["id"] as? String })
    }

    var latestContext: [String: Any] {
        WCSession.isSupported() ? WCSession.default.receivedApplicationContext : [:]
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let ctx = session.receivedApplicationContext
        if !ctx.isEmpty { DispatchQueue.main.async { self.onContext?(ctx) } }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async { self.onContext?(applicationContext) }
    }

    func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        guard let id = userInfoTransfer.userInfo["id"] as? String else { return }
        DispatchQueue.main.async { self.onTransferFinished?(id, error == nil) }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        DispatchQueue.main.async { self.onReachabilityChange?(reachable) }
    }
}
