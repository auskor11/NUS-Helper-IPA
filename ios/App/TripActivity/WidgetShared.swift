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
    /// The next public bus's type from LTA: SD single deck, DD double deck, BD bendy.
    var deck: String? = nil

    /// Shown only when it isn't the usual single-decker.
    var deckLabel: String? { ["DD": "Double", "BD": "Bendy"][deck ?? ""] }
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
            return Arrival(service: no, isShuttle: false, times: dates(mins), deck: (s["next"] as? [String: Any])?["type"] as? String)
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

/// A bus stop the widgets show: an NUS shuttle stop (with the public stop on
/// the same pole, if any) or a public bus stop.
struct StopEntity {
    /// NUS stop code (e.g. "CLB") or 5-digit public stop code.
    let id: String
    let name: String
    let isNUS: Bool
    let publicCode: String?
    /// Set when pinned from a route: the bus(es) to catch here, shown first,
    /// and where the ride goes.
    var priority: [String] = []
    var routeTo: String? = nil

    static let fallback = StopEntity(id: "CLB", name: "Central Library", isNUS: true, publicCode: "16181")
}

/// The widgets store the chosen stop as its label, "Central Library · NUS
/// shuttle" or "Aft Kent Ridge Dr · 16191", rather than as an AppEntity:
/// iOS hands a string straight to the widget, while an entity has to be
/// looked up again and that lookup can fail, leaving the widget on its default.
enum StopChoice {
    static let nusTag = "NUS shuttle"
    /// The widget follows the stop picked with "Show on widget" in the app.
    static let appLabel = "Chosen in the app"

    /// The stop last picked in the app (WidgetBridgePlugin.pinStop), if any.
    static func pinned() -> StopEntity? {
        guard let json = AppGroup.defaults?.string(forKey: "widget.pinnedStop.v1"),
              let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
              let id = obj["id"] as? String, let name = obj["name"] as? String else { return nil }
        return StopEntity(id: id, name: name, isNUS: obj["isNUS"] as? Bool ?? false, publicCode: obj["publicCode"] as? String,
                          priority: obj["services"] as? [String] ?? [], routeTo: obj["to"] as? String)
    }

    static func label(_ stop: StopEntity) -> String { "\(stop.name) · \(stop.isNUS ? nusTag : stop.id)" }

    /// A 5-digit public bus stop number, as on the stop's sign.
    static func resolve(number: String?) async -> StopEntity? {
        let code = (number ?? "").filter(\.isNumber)
        guard code.count == 5 else { return nil }
        return await PublicStops.all().first { $0.id == code } ?? StopEntity(id: code, name: "Bus stop \(code)", isNUS: false, publicCode: code)
    }

    static func resolve(_ label: String?) async -> StopEntity? {
        guard let label, let tag = label.components(separatedBy: " · ").last else { return nil }
        let name = String(label.dropLast(tag.count + 3))
        if tag == nusTag { return nusStops().first { $0.name == name } }
        if let stop = await PublicStops.all().first(where: { $0.id == tag }) { return stop }
        return StopEntity(id: tag, name: name, isNUS: false, publicCode: tag)
    }

    static func nusStops() -> [StopEntity] {
        let stops = WidgetData.load()?.stops ?? []
        let list = stops.map { StopEntity(id: $0.code, name: $0.name, isNUS: true, publicCode: $0.publicCode) }
        return list.isEmpty ? [StopEntity.fallback] : list
    }
}

/// Stops offered when editing the Bus stop widget: NUS stops and public stops
/// around campus. iOS shows these as a menu without search, so any other stop
/// is entered by its number instead (BusStopConfig.stopNumber).
struct AnyStopOptions: DynamicOptionsProvider {
    func results() async throws -> ItemCollection<String> {
        let nus = WidgetData.load()?.stops ?? []
        let linked = Set(nus.compactMap(\.publicCode))
        let all = await PublicStops.located()
        let nearby = all.filter { p in
            !linked.contains(p.stop.id) && nus.contains { ShuttleRouting.distance($0.lat, $0.lng, p.lat, p.lng) < 600 }
        }.map(\.stop)
        let item = { (s: StopEntity) in IntentItem(StopChoice.label(s), title: "\(s.name)", subtitle: s.isNUS ? "NUS shuttle" : "Bus stop \(s.id)") }
        let follow = IntentItem(StopChoice.appLabel, title: "Chosen in the app",
                                subtitle: StopChoice.pinned().map { "Now: \($0.name)" } ?? "Tap Show on widget on a stop in the map")
        return ItemCollection(sections: [
            ItemSection("Follow the app", items: [follow]),
            ItemSection("NUS shuttle stops", items: StopChoice.nusStops().map(item)),
            ItemSection("Public bus stops near NUS", items: nearby.map(item))
        ])
    }

    func defaultResult() async -> String? { StopChoice.appLabel }
}

/// Stops offered for "I usually leave from" (Up next): NUS shuttle stops only.
struct NUSStopOptions: DynamicOptionsProvider {
    func results() async throws -> [String] { StopChoice.nusStops().map(StopChoice.label) }
    func defaultResult() async -> String? { StopChoice.label(.fallback) }
}

/// Singapore public bus stops (BusRouter SG), cached in the App Group.
enum PublicStops {
    static func all() async -> [StopEntity] { await located().map(\.stop) }

    static func located() async -> [(stop: StopEntity, lat: Double, lng: Double)] {
        let dir = AppGroup.container
        let file = dir?.appendingPathComponent("public-stops.json")
        var data = file.flatMap { try? Data(contentsOf: $0) }
        if data == nil, let url = URL(string: "https://data.busrouter.sg/v1/stops.min.json") {
            data = try? await URLSession.shared.data(from: url).0
            if let data, let file { try? data.write(to: file) }
        }
        guard let data, let dict = try? JSONSerialization.jsonObject(with: data) as? [String: [Any]] else { return [] }
        return dict.compactMap { key, v in
            guard v.count >= 3, let lng = v[0] as? Double, let lat = v[1] as? Double, let name = v[2] as? String else { return nil }
            let code = String(repeating: "0", count: max(0, 5 - key.count)) + key
            return (StopEntity(id: code, name: name, isNUS: false, publicCode: code), lat, lng)
        }.sorted { $0.stop.name < $1.stop.name }
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
