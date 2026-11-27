import SwiftUI
import UserNotifications

@main
struct ThresholdWatchApp: App {
    @State private var model = WatchSessionModel()
    @State private var motion = MotionCoordinator()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(motion)
                .task {
                    // Pace reminders are local notifications; declining keeps haptic in-app banners.
                    _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
                    model.fileTransfersChanged = { motion.refreshPending() }
                    motion.refreshPending()
                }
                .onChange(of: scenePhase, initial: true) { _, _ in syncMotion() }
                .onChange(of: model.prefs) { _, _ in syncMotion() }
                .onChange(of: model.session?.id) { _, _ in syncMotion() }
                .alert("Possible drinking activity detected", isPresented: $motion.showDetectionPrompt) {
                    Button("Start evening") { model.startEvening() }
                    Button("Not now", role: .cancel) {}
                } message: {
                    Text("Would you like to start an evening session? Nothing is logged unless you add a drink.")
                }
        }
    }

    private func syncMotion() {
        motion.update(active: scenePhase == .active, prefs: model.prefs, sessionOpen: model.session != nil)
    }
}
