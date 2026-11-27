import SwiftUI

/// Internal research recorder (research builds only; enabled from the phone after the participant
/// consents). Participants may record drinking gestures with water or non-alcoholic drinks —
/// alcohol is never required.
struct ResearchView: View {
    @Environment(WatchSessionModel.self) private var model
    @Environment(MotionCoordinator.self) private var motion

    var body: some View {
        List {
            if let label = motion.recordingLabel {
                Section {
                    Text("Recording: \(label.replacingOccurrences(of: "_", with: " "))")
                    Button("Stop recording", role: .destructive) { motion.stopRecording() }
                }
            } else {
                Section("Choose the activity, then perform it") {
                    ForEach(ResearchRecording.labels, id: \.self) { label in
                        Button(label.replacingOccurrences(of: "_", with: " ")) {
                            motion.startRecording(label: label, prefs: model.prefs)
                        }
                    }
                }
            }
            Section {
                if !motion.motionAvailable {
                    Text("Motion data is not available on this watch.").font(.footnote)
                }
                Text("Last recording: \(motion.lastRecordingSamples) samples").font(.footnote)
                Text("Waiting to send to iPhone: \(motion.pendingFiles)").font(.footnote)
                Text("Use water or a non-alcoholic drink for drinking gestures.").font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        }
        .navigationTitle("Research")
        .onDisappear { motion.stopRecording() }
    }
}
