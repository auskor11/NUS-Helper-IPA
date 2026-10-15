import AppIntents
import Foundation
import SwiftUI
import WidgetKit

// Data and helpers shared by the home screen widgets. The app writes
// WidgetData into the shared App Group (see WidgetBridgePlugin.swift and
// native/native-app.js); widgets only read it, plus live bus times.

let widgetDataKey = "widget.v1"

struct WidgetData: Codable {
    struct Item: Codable {
        let kind: String        // lesson or activity
        let title: String       // e.g. CS2040S
        let subtitle: String    // e.g. Tutorial 08
        let day: String?        // weekly: "Monday"…
        let date: String?       // one-time: "2026-10-20"
        let start: String       // "14:00"
        let end: String
        let venue: String
        let lat: Double?
        let lng: Double?
    }
    struct Stop: Codable {
        let code: String
        let name: String
        let lat: Double
        let lng: Double
        /// Public bus stop sharing the same pole, if any.
        let publicCode: String?
    }
    let updatedAt: Double
    let items: [Item]
    let stops: [Stop]
    let routes: [String: [String]]

    static func load() -> WidgetData? {
        guard let json = AppGroup.defaults?.string(forKey: widgetDataKey),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }
}

// MARK: - Schedule

struct Occurrence {
    let item: WidgetData.Item
    let start: Date
    let end: Date
}

enum Schedule {
    private static let calendar = Calendar.current

    static func minutes(_ hhmm: String) -> Int? {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 ? p[0] * 60 + p[1] : nil
    }

    static func weekdayName(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEEE"
        return f.string(from: date)
    }

    static func isoDay(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Every lesson and activity in the next `days` days, soonest first.
    static func occurrences(_ data: WidgetData, from now: Date, days: Int = 8) -> [Occurrence] {
        let today = calendar.startOfDay(for: now)
        var out: [Occurrence] = []
        for offset in 0..<days {
            guard let day = calendar.date(byAdding: .day, value: offset, to: today) else { continue }
            let name = weekdayName(day), iso = isoDay(day)
            for item in data.items where item.day == name || item.date == iso {
                guard let s = minutes(item.start), let e = minutes(item.end),
                      let start = calendar.date(byAdding: .minute, value: s, to: day),
                      let end = calendar.date(byAdding: .minute, value: e, to: day) else { continue }
                out.append(Occurrence(item: item, start: start, end: end))
            }
        }
        return out.sorted { $0.start < $1.start }
    }

    /// The class or activity happening now, or the next one.
    static func next(_ data: WidgetData, at now: Date) -> Occurrence? {
        occurrences(data, from: now).first { $0.end > now }
    }

    /// The next one that hasn't started yet.
    static func upcoming(_ data: WidgetData, at now: Date) -> Occurrence? {
        occurrences(data, from: now).first { $0.start > now }
    }

    /// "In 25 min", "In 2h 5m", "Tomorrow 9:00 AM", "Wed 9:00 AM".
    static func whenLabel(_ start: Date, from now: Date) -> String {
        let mins = Int((start.timeIntervalSince(now) / 60).rounded(.up))
        if calendar.isDate(start, inSameDayAs: now) || mins < 6 * 60 {
            if mins < 60 { return "In \(max(1, mins)) min" }
            return mins % 60 == 0 ? "In \(mins / 60)h" : "In \(mins / 60)h \(mins % 60)m"
        }
        let time = start.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInTomorrow(start) { return "Tomorrow \(time)" }
        return "\(start.formatted(.dateTime.weekday(.abbreviated))) \(time)"
    }
}

// MARK: - Live arrivals

struct Arrival: Identifiable {
    let id = UUID()
    let service: String
    let isShuttle: Bool
    /// Arrival times, soonest first (up to three).
    let times: [Date]
}

enum Arrivals {
    static func shuttle(_ code: String) async -> [Arrival] {
        guard let url = URL(string: "https://bus.hewliyang.com/api/stop/\(code)"),
              let json = await fetch(url),
              let timings = (json["etas"] as? [String: Any])?["timings"] as? [[String: Any]] else { return [] }
        var pooled: [String: [Double]] = [:]
        for t in timings {
            guard let name = t["name"] as? String else { continue }
            for key in ["arrivalTime", "nextArrivalTime"] {
                if let s = t[key] as? String, let m = Double(s) { pooled[name, default: []].append(m) }
            }
        }
        return pooled.map { Arrival(service: $0.key, isShuttle: true, times: dates($0.value)) }
    }

    static func publicBus(_ code: String) async -> [Arrival] {
        guard let url = URL(string: "https://arrivelah2.busrouter.sg/?id=\(code)"),
              let json = await fetch(url),
              let services = json["services"] as? [[String: Any]] else { return [] }
        return services.compactMap { s in
            guard let no = s["no"] as? String else { return nil }
            let mins = ["next", "next2", "next3"].compactMap { ((s[$0] as? [String: Any])?["duration_ms"] as? Double).map { $0 / 60_000 } }
            return Arrival(service: no, isShuttle: false, times: dates(mins))
        }
    }

    /// Shuttles and public buses at a stop, by next arrival.
    static func all(nusCode: String?, publicCode: String?) async -> [Arrival] {
        async let a: [Arrival] = nusCode != nil ? shuttle(nusCode!) : []
        async let b: [Arrival] = publicCode != nil ? publicBus(publicCode!) : []
        let combined: [Arrival] = await a + b
        return combined.filter { !$0.times.isEmpty }.sorted { $0.times[0] < $1.times[0] }
    }

    private static func dates(_ minutes: [Double]) -> [Date] {
        let now = Date()
        return Array(Set(minutes.map { Int(max(0, $0).rounded()) })).sorted().prefix(3).map { now.addingTimeInterval(Double($0) * 60) }
    }

    private static func fetch(_ url: URL) async -> [String: Any]? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        guard let (data, _) = try? await URLSession.shared.data(for: request) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

// MARK: - NUS shuttle routing

enum ShuttleRouting {
    /// Shortest ride from stop a to stop b on each service, in travel direction.
    static func rides(_ routes: [String: [String]], from a: String, to b: String) -> [(service: String, stops: Int)] {
        var out: [(String, Int)] = []
        for (service, route) in routes {
            let loop = route.first == route.last
            let seq = loop ? route + route.dropFirst() : route
            var best: Int?
            for (i, code) in route.enumerated() where code == a && !(loop && i == route.count - 1) {
                if let j = seq[(i + 1)...].firstIndex(of: b), best == nil || j - i < best! { best = j - i }
            }
            if let best { out.append((service, best)) }
        }
        return out.sorted { $0.1 < $1.1 }
    }

    static func distance(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        let r = 6_371_000.0, dLat = (lat2 - lat1) * .pi / 180, dLng = (lng2 - lng1) * .pi / 180
        let x = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * r * atan2(sqrt(x), sqrt(1 - x))
    }

    static func nearestStop(_ stops: [WidgetData.Stop], lat: Double, lng: Double) -> (WidgetData.Stop, Double)? {
        stops.map { ($0, distance(lat, lng, $0.lat, $0.lng)) }.min { $0.1 < $1.1 }
    }
}

// MARK: - Stop picker (widget configuration)

struct StopEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Bus stop"
    static var defaultQuery = StopQuery()

    /// NUS stop code (e.g. "CLB") or 5-digit public stop code.
    let id: String
    let name: String
    let isNUS: Bool
    let publicCode: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: isNUS ? "NUS shuttle" : "Bus stop \(id)")
    }

    static let fallback = StopEntity(id: "CLB", name: "Central Library", isNUS: true, publicCode: "16181")
}

struct StopQuery: EntityStringQuery {
    func entities(for identifiers: [StopEntity.ID]) async throws -> [StopEntity] {
        let nus = nusStops()
        var out: [StopEntity] = []
        for id in identifiers {
            if let s = nus.first(where: { $0.id == id }) { out.append(s); continue }
            if let p = await PublicStops.all().first(where: { $0.id == id }) { out.append(p) }
            else { out.append(StopEntity(id: id, name: "Bus stop \(id)", isNUS: false, publicCode: id)) }
        }
        return out
    }

    func suggestedEntities() async throws -> [StopEntity] { nusStops() }

    func entities(matching string: String) async throws -> [StopEntity] {
        let q = string.lowercased()
        let nus = nusStops().filter { $0.name.lowercased().contains(q) || $0.id.lowercased().contains(q) }
        let pub = await PublicStops.all().filter { $0.name.lowercased().contains(q) || $0.id.hasPrefix(q) }.prefix(30)
        return nus + pub
    }

    private func nusStops() -> [StopEntity] {
        let stops = WidgetData.load()?.stops ?? []
        let list = stops.map { StopEntity(id: $0.code, name: $0.name, isNUS: true, publicCode: $0.publicCode) }
        return list.isEmpty ? [StopEntity.fallback] : list
    }
}

/// Singapore public bus stops (BusRouter SG), cached in the App Group.
enum PublicStops {
    static func all() async -> [StopEntity] {
        let dir = AppGroup.container
        let file = dir?.appendingPathComponent("public-stops.json")
        var data = file.flatMap { try? Data(contentsOf: $0) }
        if data == nil, let url = URL(string: "https://data.busrouter.sg/v1/stops.min.json") {
            data = try? await URLSession.shared.data(from: url).0
            if let data, let file { try? data.write(to: file) }
        }
        guard let data, let dict = try? JSONSerialization.jsonObject(with: data) as? [String: [Any]] else { return [] }
        return dict.compactMap { code, v in
            guard v.count >= 3, let name = v[2] as? String else { return nil }
            return StopEntity(id: code, name: name, isNUS: false, publicCode: code)
        }.sorted { $0.name < $1.name }
    }
}

struct RefreshIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh bus times"
    func perform() async throws -> some IntentResult { .result() }
}

// MARK: - Shared views

extension Color {
    static let widgetBG = Color(red: 0.08, green: 0.09, blue: 0.12)
    static let accentPurple = Color(red: 0.55, green: 0.49, blue: 1.0)
    static let accentCyan = Color(red: 0.31, green: 0.78, blue: 0.94)
}

let shuttleColors: [String: Color] = [
    "A1": Color(hex: "#ef4444"), "A2": Color(hex: "#f59e0b"), "D1": Color(hex: "#8b5cf6"), "D2": Color(hex: "#7c3aed"),
    "K": Color(hex: "#2563eb"), "P": Color(hex: "#0ea5e9"), "R1": Color(hex: "#ec4899"), "R2": Color(hex: "#db2777")
]

extension View {
    /// Widgets always use the app's dark look, whatever the system appearance.
    func nusWidgetStyle() -> some View {
        self.environment(\.colorScheme, .dark).foregroundStyle(.white)
    }
}

struct ServiceBadge: View {
    let service: String
    let isShuttle: Bool
    var body: some View {
        Text(service)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .frame(minWidth: 30)
            .padding(.vertical, 2)
            .background(isShuttle ? (shuttleColors[service] ?? .gray) : Color(hex: "#16a34a"), in: RoundedRectangle(cornerRadius: 5))
    }
}

func minutesText(_ date: Date, from now: Date) -> String {
    let m = Int((date.timeIntervalSince(now) / 60).rounded())
    return m <= 0 ? "Arr" : "\(m)"
}

func deepLink(_ route: String) -> URL? { URL(string: "nuscompanion://open/\(route)") }
