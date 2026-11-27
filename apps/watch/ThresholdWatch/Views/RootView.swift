import SwiftUI

struct RootView: View {
    @Environment(WatchSessionModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                if model.session != nil {
                    SessionView()
                } else {
                    StartView()
                }
            }
            .background(Theme.background)
        }
        .tint(Theme.accent)
    }
}

struct SyncStatusLine: View {
    @Environment(WatchSessionModel.self) private var model

    var body: some View {
        let text: String = {
            if !model.hasPhoneContext { return "Open Threshold on iPhone to sync" }
            if model.pendingCount > 0 { return model.reachable ? "Syncing \(model.pendingCount)…" : "Offline · \(model.pendingCount) to sync" }
            return model.reachable ? "Synced" : "Offline · saved on watch"
        }()
        Text(text)
            .font(.footnote)
            .foregroundStyle(Theme.textSecondary)
            .accessibilityLabel("Sync status: \(text)")
    }
}

struct StartView: View {
    @Environment(WatchSessionModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text("Threshold")
                    .font(.headline)
                    .foregroundStyle(Theme.textPrimary)
                Button {
                    model.startEvening()
                } label: {
                    Text("Start Evening")
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(Theme.background)
                .accessibilityHint("Starts tracking your drinks for this evening")
                SyncStatusLine()
                if model.prefs.researchRecording == true {
                    NavigationLink("Research recorder") { ResearchView() }
                        .font(.footnote)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}
