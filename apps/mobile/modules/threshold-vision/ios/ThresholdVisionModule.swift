import ExpoModulesCore
import ImageIO
import UIKit
import Vision

private extension CGImagePropertyOrientation {
  init(_ o: UIImage.Orientation) {
    switch o {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}

/// Recognizes text in a captured label photo entirely on device (no network). The JS layer
/// parses candidate fields and always asks the user to confirm them.
public class ThresholdVisionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ThresholdVision")

    AsyncFunction("recognizeText") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri),
            let data = try? Data(contentsOf: url),
            let image = UIImage(data: data),
            let cgImage = image.cgImage else {
        promise.reject("E_IMAGE", "The photo could not be read.")
        return
      }
      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          promise.reject("E_VISION", error.localizedDescription)
          return
        }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        let lines: [[String: Any]] = observations.compactMap { obs in
          guard let best = obs.topCandidates(1).first else { return nil }
          return ["text": best.string, "confidence": Double(best.confidence)]
        }
        promise.resolve(lines)
      }
      request.recognitionLevel = .accurate
      // Language correction can "fix" numbers like 5.6% into words; keep raw text.
      request.usesLanguageCorrection = false
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation), options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          promise.reject("E_VISION", error.localizedDescription)
        }
      }
    }
  }
}
