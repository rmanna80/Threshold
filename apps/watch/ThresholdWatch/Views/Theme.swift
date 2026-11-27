import SwiftUI

/// Mirrors packages/design-system tokens. Green is reserved for completed goals and is never
/// used to signal that continuing to drink is fine.
enum Theme {
    static let background = Color(red: 0x0B / 255, green: 0x0C / 255, blue: 0x0E / 255)
    static let surface = Color(red: 0x17 / 255, green: 0x1A / 255, blue: 0x1F / 255)
    static let textPrimary = Color(red: 0xF2 / 255, green: 0xEF / 255, blue: 0xE9 / 255)
    static let textSecondary = Color(red: 0xCF / 255, green: 0xCB / 255, blue: 0xC3 / 255)
    static let accent = Color(red: 0xD9 / 255, green: 0xA5 / 255, blue: 0x5B / 255)
    static let info = Color(red: 0x7F / 255, green: 0xA3 / 255, blue: 0xC9 / 255)
    static let safety = Color(red: 0xE0 / 255, green: 0x6C / 255, blue: 0x5E / 255)
}

enum Format {
    static func number(_ v: Double) -> String {
        let r = (v * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }

    static func duration(ms: EpochMs) -> String {
        let minutes = Int(max(0, ms) / 60_000)
        let h = minutes / 60
        let m = minutes % 60
        return h > 0 ? "\(h)h \(String(format: "%02d", m))m" : "\(m) min"
    }

    static func time(_ ms: EpochMs) -> String {
        let f = DateFormatter()
        f.timeStyle = .short
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }
}
