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

/// Receives labelled research recordings sent from the watch with `transferFile`.
/// Files are accepted only while the participant has research recording switched on (the JS
/// layer sets `accepting`); otherwise they are discarded on arrival. Files stay on this device,
/// excluded from iCloud backup, until the participant shares or deletes them.
final class ResearchFileStore {
  private let dir: URL
  private let acceptingKey = "threshold.research.accepting"
  private let queue = DispatchQueue(label: "threshold.research.files")

  init() {
    dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ResearchRecordings", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                             attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var d = dir
    try? d.setResourceValues(values)
  }

  var accepting: Bool {
    get { UserDefaults.standard.bool(forKey: acceptingKey) }
    set { UserDefaults.standard.set(newValue, forKey: acceptingKey) }
  }

  static func validId(_ id: String) -> Bool {
    id.count >= 8 && id.count <= 64 && id.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
  }

  /// Must run synchronously inside the delegate callback: WatchConnectivity deletes the
  /// incoming file as soon as the callback returns.
  func accept(_ file: WCSessionFile) -> Bool {
    let meta = file.metadata ?? [:]
    guard accepting, (meta["type"] as? String) == "research_recording",
          let id = meta["recordingId"] as? String, Self.validId(id) else { return false }
    return queue.sync {
      let dest = dir.appendingPathComponent("\(id).jsonl")
      try? FileManager.default.removeItem(at: dest)
      do {
        try FileManager.default.moveItem(at: file.fileURL, to: dest)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: dest.path)
        return true
      } catch {
        return false
      }
    }
  }

  private func header(of url: URL) -> [String: Any] {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return [:] }
    defer { try? handle.close() }
    let chunk = (try? handle.read(upToCount: 8192)) ?? Data()
    guard let newline = chunk.firstIndex(of: 0x0A),
          let obj = try? JSONSerialization.jsonObject(with: chunk[chunk.startIndex..<newline]) as? [String: Any],
          (obj["type"] as? String) == "header" else { return [:] }
    return obj
  }

  func list() -> [[String: Any]] {
    queue.sync {
      let urls = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
      return urls.filter { $0.pathExtension == "jsonl" }.map { url in
        let h = header(of: url)
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        var item: [String: Any] = [
          "id": url.deletingPathExtension().lastPathComponent,
          "uri": url.absoluteString,
          "bytes": size,
        ]
        if let v = h["label"] as? String { item["label"] = v }
        if let v = h["participantId"] as? String { item["participantId"] = v }
        if let v = h["startedAt"] as? NSNumber { item["startedAt"] = v }
        if let v = h["protocolId"] as? String { item["protocolId"] = v }
        return item
      }
    }
  }

  func remove(id: String) {
    guard Self.validId(id) else { return }
    queue.sync { try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).jsonl")) }
  }

  func removeAll() {
    queue.sync {
      let urls = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
      for u in urls { try? FileManager.default.removeItem(at: u) }
    }
  }
}

final class PhoneSessionBridge: NSObject, WCSessionDelegate {
  static let shared = PhoneSessionBridge()
  let inbox = WatchInbox()
  let research = ResearchFileStore()
  var onMessage: (([String: Any]) -> Void)?
  var onResearchFile: (([String: Any]) -> Void)?
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
  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    let id = (file.metadata?["recordingId"] as? String) ?? ""
    let accepted = research.accept(file)
    onResearchFile?(["id": id, "accepted": accepted])
  }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { receive(message) }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    receive(message)
    replyHandler(["received": message["id"] ?? NSNull()])
  }
}

public class ThresholdWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ThresholdWatch")
    Events("onWatchMessage", "onWatchStateChange", "onResearchFile")

    OnCreate {
      let bridge = PhoneSessionBridge.shared
      bridge.onMessage = { [weak self] payload in self?.sendEvent("onWatchMessage", payload) }
      bridge.onStateChange = { [weak self] state in self?.sendEvent("onWatchStateChange", state) }
      bridge.onResearchFile = { [weak self] info in self?.sendEvent("onResearchFile", info) }
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

    AsyncFunction("setResearchAccepting") { (on: Bool) in
      PhoneSessionBridge.shared.research.accepting = on
    }

    AsyncFunction("listResearchRecordings") { () -> [[String: Any]] in
      PhoneSessionBridge.shared.research.list()
    }

    AsyncFunction("deleteResearchRecording") { (id: String) in
      PhoneSessionBridge.shared.research.remove(id: id)
    }

    AsyncFunction("deleteAllResearchRecordings") {
      PhoneSessionBridge.shared.research.removeAll()
    }
  }
}
