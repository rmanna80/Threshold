import CoreMotion
import Foundation

/// Foreground-only device-motion capture at 50 Hz.
///
/// watchOS suspends apps that leave the foreground; Threshold does not use workout sessions or
/// other background modes to keep motion running (App Review guideline 2.5.4). Callers start
/// this only while the app is active and stop it when the scene leaves the foreground.
final class MotionRecorder: @unchecked Sendable {
    struct Sample: Sendable {
        /// Seconds (Core Motion timestamp, monotonic since boot).
        let t: Double
        /// User acceleration (gravity removed), in g.
        let ax: Double, ay: Double, az: Double
        /// Rotation rate, rad/s.
        let rx: Double, ry: Double, rz: Double
        /// Gravity vector, in g.
        let gx: Double, gy: Double, gz: Double
    }

    static let samplingHz = 50.0
    private let manager = CMMotionManager()
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.name = "threshold.motion"
        q.maxConcurrentOperationCount = 1
        return q
    }()
    private var handlers: [UUID: @Sendable (Sample) -> Void] = [:]
    private let lock = NSLock()

    var isAvailable: Bool { manager.isDeviceMotionAvailable }
    var isRunning: Bool { manager.isDeviceMotionActive }

    @discardableResult
    func addHandler(_ h: @escaping @Sendable (Sample) -> Void) -> UUID {
        let id = UUID()
        lock.lock()
        handlers[id] = h
        lock.unlock()
        return id
    }

    func removeHandler(_ id: UUID) {
        lock.lock()
        handlers[id] = nil
        lock.unlock()
    }

    func start() {
        guard isAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / Self.samplingHz
        manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            let s = Sample(
                t: m.timestamp,
                ax: m.userAcceleration.x, ay: m.userAcceleration.y, az: m.userAcceleration.z,
                rx: m.rotationRate.x, ry: m.rotationRate.y, rz: m.rotationRate.z,
                gx: m.gravity.x, gy: m.gravity.y, gz: m.gravity.z
            )
            self.lock.lock()
            let hs = Array(self.handlers.values)
            self.lock.unlock()
            for h in hs { h(s) }
        }
    }

    func stop() {
        if manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
    }
}
