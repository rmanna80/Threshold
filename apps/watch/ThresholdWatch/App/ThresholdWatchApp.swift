import SwiftUI
import UserNotifications

@main
struct ThresholdWatchApp: App {
    @State private var model = WatchSessionModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task {
                    // Pace reminders are local notifications; declining keeps haptic in-app banners.
                    _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
                }
        }
    }
}
