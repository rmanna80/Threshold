import SwiftUI

struct SessionView: View {
    @Environment(WatchSessionModel.self) private var model
    @State private var confirmEnd = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let now = WallClock.nowMs(context.date)
            let pace = model.pace(now: now)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let banner = model.banner {
                        BannerView(intervention: banner) { model.dismissBanner() }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Format.number(pace.totalStandardDrinks))
                            .font(.system(size: 44, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Theme.textPrimary)
                        Text(pace.totalStandardDrinks == 1 ? model.prefs.label : model.prefs.labelPlural)
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                        if let goal = model.session?.goalSnapshot.maxStandardDrinksPerSession {
                            Text("Your goal: \(Format.number(goal))")
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(Format.number(pace.totalStandardDrinks)) \(model.prefs.labelPlural) recorded")

                    HStack {
                        Metric(label: "Last 30 min", value: Format.number(pace.windows[30]?.standardDrinks ?? 0))
                        Metric(label: "Last drink", value: pace.timeSinceLastDrinkMs.map { Format.duration(ms: $0) } ?? "—")
                    }

                    NavigationLink {
                        LogDrinkView()
                    } label: {
                        Label("Log drink", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .foregroundStyle(Theme.background)

                    Button {
                        model.logWater()
                    } label: {
                        Label("Water", systemImage: "drop.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .tint(Theme.info)
                    .accessibilityHint("Logs a glass of water")

                    NavigationLink {
                        DrinkListView()
                    } label: {
                        Label("Drinks (\(model.activeDrinks.count))", systemImage: "list.bullet")
                    }

                    Button(role: .destructive) {
                        confirmEnd = true
                    } label: {
                        Text("End Session").frame(maxWidth: .infinity)
                    }
                    if let s = model.session {
                        Text("Started \(Format.time(s.startedAt)) · \(Format.duration(ms: now - s.startedAt))")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    SyncStatusLine()
                }
            }
        }
        .navigationTitle("Evening")
        .confirmationDialog("End this session?", isPresented: $confirmEnd) {
            Button("End Session", role: .destructive) { model.endSession() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

struct Metric: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading) {
            Text(label.uppercased()).font(.caption2).foregroundStyle(Theme.textSecondary)
            Text(value).font(.headline).monospacedDigit().foregroundStyle(Theme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct BannerView: View {
    let intervention: WatchIntervention
    let onDismiss: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(intervention.title).font(.headline).foregroundStyle(Theme.accent)
            Text(intervention.body).font(.footnote).foregroundStyle(Theme.textPrimary)
            Button("OK", action: onDismiss).font(.footnote)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
        .accessibilityElement(children: .combine)
    }
}
