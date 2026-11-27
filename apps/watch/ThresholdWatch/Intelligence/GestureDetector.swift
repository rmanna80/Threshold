import CoreML
import Foundation

/// On-device gesture inference interface.
///
/// The classifier is loaded ONLY if the app bundle contains both `DrinkGestureClassifier.mlmodelc`
/// and `gesture_model_manifest.json` with `"status": "validated"` (written by the model registry's
/// promotion step). No model ships today, so `CoreMLGestureClassifier.loadValidated()` returns
/// nil and gesture prompts stay disabled — the app never pretends to detect gestures.
///
/// Input contract (see intelligence/training/export.py): MLMultiArray "window" [1, 6, 128] float32
/// with channels [userAccel x, y, z (g), rotationRate x, y, z (rad/s)] at 50 Hz; output
/// "probabilities" over the registry's class order, where index `drinkingIndex` is drinking-like.
protocol GestureClassifier {
    func drinkingProbability(window: [[Float]]) throws -> Float
}

struct GestureModelManifest: Codable {
    var modelId: String
    var version: String
    var status: String
    var classes: [String]
    var threshold: Float
    /// Must be "device_v1": raw ~50 Hz samples with left-wrist mirroring only (no zero-phase
    /// filtering), which is exactly what `GesturePromptEngine` feeds the model.
    var preprocessing: String
}

final class CoreMLGestureClassifier: GestureClassifier {
    private let model: MLModel
    private let drinkingIndex: Int
    let manifest: GestureModelManifest

    private init(model: MLModel, manifest: GestureModelManifest, drinkingIndex: Int) {
        self.model = model
        self.manifest = manifest
        self.drinkingIndex = drinkingIndex
    }

    static func loadValidated(bundle: Bundle = .main) -> CoreMLGestureClassifier? {
        guard let manifestURL = bundle.url(forResource: "gesture_model_manifest", withExtension: "json"),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(GestureModelManifest.self, from: data),
              manifest.status == "validated",
              manifest.preprocessing == "device_v1",
              (0.5..<1.0).contains(manifest.threshold),
              let idx = manifest.classes.firstIndex(of: "drinking_like"),
              let modelURL = bundle.url(forResource: "DrinkGestureClassifier", withExtension: "mlmodelc"),
              let model = try? MLModel(contentsOf: modelURL)
        else { return nil }
        return CoreMLGestureClassifier(model: model, manifest: manifest, drinkingIndex: idx)
    }

    func drinkingProbability(window: [[Float]]) throws -> Float {
        let size = 128
        guard window.count == size, window.allSatisfy({ $0.count == 6 }) else { throw NSError(domain: "Gesture", code: 1) }
        let array = try MLMultiArray(shape: [1, 6, NSNumber(value: size)], dataType: .float32)
        for t in 0..<size {
            for c in 0..<6 { array[[0, NSNumber(value: c), NSNumber(value: t)]] = NSNumber(value: window[t][c]) }
        }
        let input = try MLDictionaryFeatureProvider(dictionary: ["window": MLFeatureValue(multiArray: array)])
        let out = try model.prediction(from: input)
        guard let probs = out.featureValue(for: "probabilities")?.multiArrayValue, drinkingIndex < probs.count else { throw NSError(domain: "Gesture", code: 2) }
        return probs[drinkingIndex].floatValue
    }
}

/// Turns window probabilities into a *prompt* — never into a logged drink.
/// Requires repeated confident drinking-like windows (≥ 2 events at least 10 s apart within
/// 3 minutes) and enforces a 30-minute cool-down after any prompt.
/// Not thread-safe on its own; `MotionPipeline` calls it from the single motion queue.
final class GesturePromptEngine {
    private let classifier: GestureClassifier
    private let threshold: Float
    /// Mirror x/y for left-wrist or left-crown wear (intelligence/signal_processing/preprocess.py).
    var mirrorXY = false
    private var buffer: [[Float]] = []
    private var eventTimes: [Double] = []
    private var lastPromptAt: Double = -.infinity
    var onPrompt: (() -> Void)?

    init(classifier: GestureClassifier, threshold: Float) {
        self.classifier = classifier
        self.threshold = threshold
    }

    func ingest(_ s: MotionRecorder.Sample) {
        let m: Float = mirrorXY ? -1 : 1
        buffer.append([m * Float(s.ax), m * Float(s.ay), Float(s.az), m * Float(s.rx), m * Float(s.ry), Float(s.rz)])
        guard buffer.count >= 128 else { return }
        defer { buffer.removeFirst(64) } // 50 % overlap
        guard let p = try? classifier.drinkingProbability(window: Array(buffer.prefix(128))), p >= threshold else { return }
        if let last = eventTimes.last, s.t - last < 10 { return }
        eventTimes.append(s.t)
        eventTimes.removeAll { s.t - $0 > 180 }
        if eventTimes.count >= 2, s.t - lastPromptAt > 1800 {
            lastPromptAt = s.t
            eventTimes.removeAll()
            onPrompt?()
        }
    }

    func reset() {
        buffer.removeAll()
        eventTimes.removeAll()
    }
}
