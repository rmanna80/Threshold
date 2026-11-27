import SwiftUI

/// Two taps: choose a beverage (recent / defaults from the phone), then the portion.
struct LogDrinkView: View {
    @Environment(WatchSessionModel.self) private var model

    private var choices: [WatchProtocol.Beverage] {
        let fromPhone = model.beverages.filter { $0.category != "water" }
        if !fromPhone.isEmpty { return fromPhone }
        // Before the first sync, offer common defaults with typical label strengths.
        return [
            .init(id: "template:beer_regular_12oz", name: "Beer", category: "beer", servingValue: 12, servingUnit: "fl_oz_us", abvPercent: 5),
            .init(id: "template:wine_red_5oz", name: "Wine", category: "wine", servingValue: 5, servingUnit: "fl_oz_us", abvPercent: 13.5),
            .init(id: "template:spirit_shot_1_5oz", name: "Spirit shot", category: "spirits", servingValue: 1.5, servingUnit: "fl_oz_us", abvPercent: 40),
            .init(id: "template:seltzer_12oz", name: "Hard seltzer", category: "hard_seltzer", servingValue: 12, servingUnit: "fl_oz_us", abvPercent: 5),
        ]
    }

    var body: some View {
        List(choices) { b in
            NavigationLink {
                PortionView(beverage: b)
            } label: {
                VStack(alignment: .leading) {
                    Text(b.name).font(.headline)
                    Text(subtitle(b)).font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityLabel("\(b.name), \(subtitle(b))")
        }
        .navigationTitle("Log drink")
    }

    private func subtitle(_ b: WatchProtocol.Beverage) -> String {
        let unit = b.servingUnit == "ml" ? "mL" : b.servingUnit == "cl" ? "cL" : "fl oz"
        let abv = b.abvPercent.map { " · \(Format.number($0))%" } ?? " · strength unknown"
        return "\(Format.number(b.servingValue)) \(unit)\(abv)"
    }
}

struct PortionView: View {
    @Environment(WatchSessionModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let beverage: WatchProtocol.Beverage

    private struct Portion: Hashable {
        let label: String
        let value: Double
    }

    private let portions = [Portion(label: "Whole", value: 1), Portion(label: "¾", value: 0.75), Portion(label: "Half", value: 0.5), Portion(label: "¼", value: 0.25)]

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(beverage.name).font(.headline)
                ForEach(portions, id: \.self) { p in
                    Button {
                        if model.log(beverage: beverage, fraction: p.value) { dismiss() }
                    } label: {
                        Text(p.label).frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .accessibilityLabel("Log \(p.label.lowercased()) \(beverage.name)")
                }
            }
        }
        .navigationTitle("How much?")
    }
}

struct DrinkListView: View {
    @Environment(WatchSessionModel.self) private var model

    var body: some View {
        List {
            if model.activeDrinks.isEmpty {
                Text("No drinks logged yet").foregroundStyle(Theme.textSecondary)
            }
            ForEach(model.activeDrinks) { d in
                NavigationLink {
                    CorrectDrinkView(drink: d)
                } label: {
                    VStack(alignment: .leading) {
                        Text(d.beverageName).font(.headline)
                        Text("\(Format.time(d.consumedAt)) · \(d.standardDrinks.map { Format.number($0) } ?? "?") \(model.prefs.labelPlural)")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .onDelete { idx in
                let items = idx.map { model.activeDrinks[$0] }
                for d in items { model.delete(d) }
            }
        }
        .navigationTitle("Drinks")
    }
}

struct CorrectDrinkView: View {
    @Environment(WatchSessionModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let drink: DrinkEvent

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(drink.beverageName).font(.headline)
                ForEach([1.0, 0.75, 0.5, 0.25], id: \.self) { f in
                    Button("\(Int(f * 100))% of it") {
                        model.changePortion(drink, fraction: f)
                        dismiss()
                    }
                }
                Button("Delete drink", role: .destructive) {
                    model.delete(drink)
                    dismiss()
                }
            }
        }
        .navigationTitle("Correct")
    }
}
