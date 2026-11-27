import Foundation
import Observation
import WatchConnectivity
import WatchKit

/// Routes motion samples (delivered on the Core Motion queue) to the active research recording
/// and/or the gesture prompt engine. All mutable state is guarded by a lock.
final class MotionPipeline: @unchecked Sendable {
    private let lock = NSLock()
    private var recording: ResearchRecording?
    private var detectionOn = false
    private let prompts: GesturePromptEngine?

    init(prompts: GesturePromptEngine?) { self.prompts = prompts }

    func setRecording(_ r: ResearchRecording?) {
        lock.lock(); recording = r; lock.unlock()
    }

    func setDetection(_ on: Bool) {
        lock.lock()
        detectionOn = on && prompts != nil
        if !detectionOn { prompts?.reset() }
        lock.unlock()
    }

    func handle(_ s: MotionRecorder.Sample) {
        lock.lock()
        let r = recording
        let detect = detectionOn
        if detect { prompts?.ingest(s) }
        lock.unlock()
        r?.append(s)
    }
}

/// Owns motion capture while the watch app is in the foreground.
///  - Research recording: only when the phone says the participant enrolled AND enabled the
///    recorder, and only while a labelled recording is running.
///  - Gesture prompts: only when the user enabled automatic detection, the phone's feature flag
///    allowed it, AND a validated model is bundled. No model ships today, so this stays off.
/// Motion stops whenever the app leaves the foreground; there is no background capture.
@MainActor
@Observable
final class MotionCoordinator {
    private(set) var recordingLabel: String?
    private(set) var lastRecordingSamples = 0
    private(set) var pendingFiles = 0
    var showDetectionPrompt = false

    @ObservationIgnored private let recorder = MotionRecorder()
    @ObservationIgnored private let pipeline: MotionPipeline
    @ObservationIgnored private var recording: ResearchRecording?
    @ObservationIgnored private var handlerId: UUID?
    @ObservationIgnored private var active = false
    let gestureModelBundled: Bool

    init() {
        let engine = CoreMLGestureClassifier.loadValidated().map { GesturePromptEngine(classifier: $0, threshold: $0.manifest.threshold) }
        let device = WKInterfaceDevice.current()
        engine?.mirrorXY = (device.wristLocation == .left) != (device.crownOrientation == .left)
        gestureModelBundled = engine != nil
        pipeline = MotionPipeline(prompts: engine)
        engine?.onPrompt = { [weak self] in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.showDetectionPrompt = true } }
        }
        let p = pipeline
        handlerId = recorder.addHandler { s in p.handle(s) }
    }

    var motionAvailable: Bool { recorder.isAvailable }

    /// Re-evaluate whether motion should run. Call on scene-phase and context changes.
    func update(active: Bool, prefs: WatchProtocol.Prefs, sessionOpen: Bool) {
        self.active = active
        if prefs.researchRecording != true, recording != nil { stopRecording() }
        let detection = active && prefs.automaticDetectionEnabled && gestureModelBundled && !sessionOpen
        pipeline.setDetection(detection)
        if active && (recording != nil || detection) {
            recorder.start()
        } else {
            recorder.stop()
        }
    }

    func startRecording(label: String, prefs: WatchProtocol.Prefs) {
        guard recording == nil, prefs.researchRecording == true, active else { return }
        guard let r = try? ResearchRecording(label: label, participantId: prefs.participantId ?? "unassigned", dominantHand: prefs.dominantHand ?? "unknown") else { return }
        recording = r
        recordingLabel = label
        pipeline.setRecording(r)
        recorder.start()
    }

    func stopRecording() {
        guard let r = recording else { return }
        pipeline.setRecording(nil)
        recording = nil
        recordingLabel = nil
        lastRecordingSamples = r.sampleCount
        guard let url = try? r.finish() else { return }
        if WCSession.isSupported(), WCSession.default.activationState == .activated {
            // Queued by the system and delivered when the phone is reachable; the phone accepts
            // it only while the participant's recorder is switched on.
            WCSession.default.transferFile(url, metadata: ["type": "research_recording", "recordingId": r.recordingId, "label": r.label])
        }
        refreshPending()
    }

    func refreshPending() {
        pendingFiles = WCSession.isSupported() ? WCSession.default.outstandingFileTransfers.count : 0
    }
}
