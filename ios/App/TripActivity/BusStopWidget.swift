import AppIntents
import SwiftUI
import WidgetKit

// Bus stop: live arrivals (NUS shuttles and public buses) at a stop chosen
// when editing the widget. Minutes count down between refreshes; the
// refresh button fetches new times.

struct BusStopConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Bus stop"
    static var description = IntentDescription("Live arrivals at your favourite stop.")

    @Parameter(title: "Stop", optionsProvider: AnyStopOptions())
    var stop: String?

    @Parameter(title: "Bus stop no.", description: "Any public bus stop in Singapore, e.g. 16191. Overrides the stop above.",
               inputOptions: String.IntentInputOptions(keyboardType: .numberPad))
    var stopNumber: String?

    func chosenStop() async -> StopEntity {
        if let stop = await StopChoice.resolve(number: stopNumber) { return stop }
        return await StopChoice.resolve(stop) ?? .fallback
    }
}

struct BusStopEntry: TimelineEntry {
    let date: Date
    let stop: StopEntity
    let arrivals: [Arrival]
    let fetchedAt: Date
}

struct BusStopProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> BusStopEntry { sample() }

    func snapshot(for configuration: BusStopConfig, in context: Context) async -> BusStopEntry {
        context.isPreview ? sample() : await fetch(configuration.chosenStop()).first!
    }

    func timeline(for configuration: BusStopConfig, in context: Context) async -> Timeline<BusStopEntry> {
        let entries = await fetch(configuration.chosenStop())
        return Timeline(entries: entries, policy: .after(Date().addingTimeInterval(10 * 60)))
    }

    /// One entry per minute for the next 15 minutes, so the minutes count
    /// down without using a refresh.
    private func fetch(_ stop: StopEntity) async -> [BusStopEntry] {
        let arrivals = await Arrivals.all(nusCode: stop.isNUS ? stop.id : nil, publicCode: stop.publicCode)
        let now = Date()
        return (0..<15).map { i in
            let at = now.addingTimeInterval(Double(i) * 60)
            let upcoming = arrivals.compactMap { a -> Arrival? in
                let times = a.times.filter { $0 > at.addingTimeInterval(-30) }
                return times.isEmpty ? nil : Arrival(service: a.service, isShuttle: a.isShuttle, times: times,
                                                     deck: times.count == a.times.count ? a.deck : nil)
            }.sorted { $0.times[0] < $1.times[0] }
            return BusStopEntry(date: at, stop: stop, arrivals: upcoming, fetchedAt: now)
        }
    }

    private func sample() -> BusStopEntry {
        let now = Date()
        let t = { (m: [Double]) in m.map { now.addingTimeInterval($0 * 60) } }
        return BusStopEntry(date: now, stop: .fallback, arrivals: [
            Arrival(service: "D1", isShuttle: true, times: t([1, 7])),
            Arrival(service: "151", isShuttle: false, times: t([2, 14, 26])),
            Arrival(service: "K", isShuttle: true, times: t([4, 44])),
            Arrival(service: "95", isShuttle: false, times: t([6, 18, 30]))
        ], fetchedAt: now)
    }
}

struct BusStopView: View {
    @Environment(\.widgetFamily) var family
    let entry: BusStopEntry

    var body: some View {
        Group {
            if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.stop.name).font(.headline).lineLimit(1).widgetAccentable()
                    ForEach(entry.arrivals.prefix(2)) { a in
                        Text("\(a.service)  \(times(a))").font(.caption).lineLimit(1)
                    }
                    if entry.arrivals.isEmpty { Text("No buses right now").font(.caption) }
                }
            } else {
                full
            }
        }
        .widgetURL(deepLink("map?stop=\(entry.stop.id)"))
    }

    private var full: some View {
        let rows = family == .systemSmall ? 3 : 4
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                Text(entry.stop.name).font(.system(size: 13, weight: .bold)).lineLimit(1)
                Spacer(minLength: 2)
                Button(intent: RefreshIntent()) {
                    Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentPurple)
            }
            if entry.arrivals.isEmpty {
                Spacer()
                Text("No buses right now").font(.caption).foregroundStyle(.white.opacity(0.65))
                Spacer()
            } else {
                ForEach(entry.arrivals.prefix(rows)) { a in
                    HStack(spacing: 6) {
                        ServiceBadge(service: a.service, isShuttle: a.isShuttle)
                        Text(minutesText(a.times[0], from: entry.date) + (minutesText(a.times[0], from: entry.date) == "Arr" ? "" : " min"))
                            .font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        if let deck = a.deckLabel {
                            Text(deck).font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                                .padding(.horizontal, 4).padding(.vertical, 1)
                                .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                        }
                        Spacer(minLength: 2)
                        if family != .systemSmall, a.times.count > 1 {
                            Text("then \(a.times.dropFirst().map { minutesText($0, from: entry.date) }.joined(separator: ", "))")
                                .font(.caption2).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            Text("Updated \(entry.fetchedAt.formatted(date: .omitted, time: .shortened))").font(.system(size: 9)).foregroundStyle(.white.opacity(0.45))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func times(_ a: Arrival) -> String {
        a.times.map { minutesText($0, from: entry.date) }.joined(separator: ", ")
    }
}

struct BusStopWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "BusStop", intent: BusStopConfig.self, provider: BusStopProvider()) { entry in
            BusStopView(entry: entry)
                .nusWidgetStyle()
                .containerBackground(for: .widget) { Color.widgetBG }
        }
        .configurationDisplayName("Bus stop")
        .description("Live shuttle and bus arrivals at your favourite stop.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}
