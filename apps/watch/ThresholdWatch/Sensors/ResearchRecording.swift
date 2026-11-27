import Foundation
import WatchKit

/// Writes one labelled research recording as JSON Lines (header, samples, footer), the format
/// read by intelligence/datasets/loader.py. Files stay on the watch until sent to the paired
/// phone with WatchConnectivity file transfer; nothing is uploaded from the watch.
/// Thread-safe: samples are appended from the motion queue and serialised on `queue`.
final class ResearchRecording: @unchecked Sendable {
    static let labels = ["drinking_like", "eating", "phone_use", "face_touch", "walking", "talking_gestures", "sitting", "exercise", "other"]

    let recordingId = IDs.new()
    let label: String
    let url: URL
    private let handle: FileHandle
    private var _sampleCount = 0
    var sampleCount: Int { queue.sync { _sampleCount } }
    private var lastT: Double?
    private var droppedEstimate = 0.0
    private let queue = DispatchQueue(label: "threshold.research.write")

    @MainActor
    init(label: String, participantId: String, dominantHand: String, protocolId: String = "gesture-v1") throws {
        guard Self.labels.contains(label) else { throw CocoaError(.featureUnsupported) }
        self.label = label
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Research", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        url = dir.appendingPathComponent("\(recordingId).jsonl")
        FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        handle = try FileHandle(forWritingTo: url)
        let device = WKInterfaceDevice.current()
        let header: [String: Any] = [
            "type": "header",
            "recordingId": recordingId,
            "participantId": participantId,
            "protocolId": protocolId,
            "label": label,
            "dominantHand": dominantHand,
            "wrist": device.wristLocation == .left ? "left" : "right",
            "crown": device.crownOrientation == .left ? "left" : "right",
            "deviceModel": device.model,
            "osVersion": device.systemVersion,
            "samplingHz": MotionRecorder.samplingHz,
            "startedAt": WallClock.nowMs(),
        ]
        try writeLine(header)
    }

    private func writeLine(_ obj: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: obj)
        data.append(0x0A)
        try handle.write(contentsOf: data)
    }

    func append(_ s: MotionRecorder.Sample) {
        queue.async {
            if let last = self.lastT {
                let expected = 1.0 / MotionRecorder.samplingHz
                let gap = s.t - last
                if gap > expected * 1.5 { self.droppedEstimate += (gap / expected).rounded() - 1 }
            }
            self.lastT = s.t
            try? self.writeLine(["t": s.t, "ax": s.ax, "ay": s.ay, "az": s.az, "rx": s.rx, "ry": s.ry, "rz": s.rz, "gx": s.gx, "gy": s.gy, "gz": s.gz])
            self._sampleCount += 1
        }
    }

    func finish() throws -> URL {
        try queue.sync {
            try writeLine(["type": "footer", "samples": _sampleCount, "droppedEstimate": droppedEstimate, "endedAt": WallClock.nowMs()])
            try handle.close()
        }
        return url
    }
}
