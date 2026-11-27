import ExpoModulesCore
import Foundation
import WatchConnectivity

/// Durable inbox for messages that arrive from the watch while JavaScript is not running.
/// Messages are appended to a file protected until first unlock and removed only after the JS
/// layer acknowledges them, so nothing is lost if the app is terminated mid-sync.
final class WatchInbox {
  private let url: URL
  private let queue = DispatchQueue(label: "threshold.watch.inbox")

  init() {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ThresholdWatch", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                             attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    url = dir.appendingPathComponent("inbox.json")
  }

  private func load() -> [[String: Any]] {
    guard let data = try? Data(contentsOf: url),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
    return arr
  }

  private func save(_ items: [[String: Any]]) {
    guard let data = try? JSONSerialization.data(withJSONObject: items) else { return }
    try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  func append(_ message: [String: Any]) {
    queue.sync {
      var items = load()
      if let id = message["id"] as? String, items.contains(where: { ($0["id"] as? String) == id }) { return }
      items.append(message)
      // Bound the inbox; the watch keeps its own outbox and will resend if needed.
      if items.count > 2000 { items.removeFirst(items.count - 2000) }
      save(items)
    }
  }

  func all() -> [[String: Any]] { queue.sync { load() } }

  func remove(ids: Set<String>) {
    queue.sync { save(load().filter { !ids.contains(($0["id"] as? String) ?? "") }) }
  }
}

final class PhoneSessionBridge: NSObject, WCSessionDelegate {
  static let shared = PhoneSessionBridge()
  let inbox = WatchInbox()
  var onMessage: (([String: Any]) -> Void)?
  var onStateChange: (([String: Any]) -> Void)?

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    if session.delegate == nil { session.delegate = self }
    if session.activationState != .activated { session.activate() }
  }

  func state() -> [String: Any] {
    guard WCSession.isSupported() else {
      return ["supported": false, "paired": false, "installed": false, "reachable": false, "activated": false]
    }
    let s = WCSession.default
    return [
      "supported": true,
      "paired": s.isPaired,
      "installed": s.isWatchAppInstalled,
      "reachable": s.isReachable,
      "activated": s.activationState == .activated,
      "pendingTransfers": s.outstandingUserInfoTransfers.count,
    ]
  }

  func updateContext(_ context: [String: Any]) throws {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    guard WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else { return }
    try WCSession.default.updateApplicationContext(context)
  }

  func transfer(_ payload: [String: Any]) {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated,
          WCSession.default.isWatchAppInstalled else { return }
    WCSession.default.transferUserInfo(payload)
  }

  private func receive(_ payload: [String: Any]) {
    inbox.append(payload)
    onMessage?(payload)
  }

  // MARK: WCSessionDelegate
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    onStateChange?(state())
  }
  func sessionDidBecomeInactive(_ session: WCSession) { onStateChange?(state()) }
  func sessionDidDeactivate(_ session: WCSession) {
    // Required when switching between paired watches.
    session.activate()
  }
  func sessionReachabilityDidChange(_ session: WCSession) { onStateChange?(state()) }
  func sessionWatchStateDidChange(_ session: WCSession) { onStateChange?(state()) }
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { receive(userInfo) }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { receive(message) }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    receive(message)
    replyHandler(["received": message["id"] ?? NSNull()])
  }
}

public class ThresholdWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ThresholdWatch")
    Events("onWatchMessage", "onWatchStateChange")

    OnCreate {
      let bridge = PhoneSessionBridge.shared
      bridge.onMessage = { [weak self] payload in self?.sendEvent("onWatchMessage", payload) }
      bridge.onStateChange = { [weak self] state in self?.sendEvent("onWatchStateChange", state) }
      bridge.activate()
    }

    AsyncFunction("getState") { () -> [String: Any] in
      PhoneSessionBridge.shared.state()
    }

    AsyncFunction("updateApplicationContext") { (context: [String: Any]) in
      try PhoneSessionBridge.shared.updateContext(context)
    }

    AsyncFunction("transferUserInfo") { (payload: [String: Any]) in
      PhoneSessionBridge.shared.transfer(payload)
    }

    AsyncFunction("drainInbox") { () -> [[String: Any]] in
      PhoneSessionBridge.shared.inbox.all()
    }

    AsyncFunction("acknowledge") { (ids: [String]) in
      PhoneSessionBridge.shared.inbox.remove(ids: Set(ids))
    }
  }
}
