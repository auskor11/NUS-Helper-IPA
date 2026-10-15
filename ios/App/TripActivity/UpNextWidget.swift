import AppIntents
import SwiftUI
import WidgetKit

// Up next: your next class plus the NUS shuttle to catch from the stop you
// usually leave from (chosen when editing the widget), using live times.

struct UpNextConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Up next"
    static var description = IntentDescription("Your next class and the shuttle to catch to get there.")

    @Parameter(title: "I usually leave from")
    var stop: StopEntity?
}

struct ShuttlePlan {
    let service: String
    let fromName: String
    let toName: String
    let stops: Int
    let board: Date        // when the bus to catch arrives
    let arrive: Date       // estimated arrival at the class
    let onTime: Bool
}

struct UpNextEntry: TimelineEntry {
    let date: Date
    let occurrence: Occurrence?
    let plan: ShuttlePlan?
    let note: String?
}

struct UpNextProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> UpNextEntry { sample() }

    func snapshot(for configuration: UpNextConfig, in context: Context) async -> UpNextEntry {
        context.isPreview ? sample() : await build(configuration)
    }

    func timeline(for configuration: UpNextConfig, in context: Context) async -> Timeline<UpNextEntry> {
        let entry = await build(configuration)
        // Live bus times go stale: ask for a refresh in 10 minutes, sooner if
        // the class starts. Until then, one entry a minute keeps countdowns current.
        var next = Date().addingTimeInterval(10 * 60)
        if let start = entry.occurrence?.start, start > Date(), start < next { next = start }
        let entries = (0..<10).map { i in
            UpNextEntry(date: entry.date.addingTimeInterval(Double(i) * 60), occurrence: entry.occurrence, plan: entry.plan, note: entry.note)
        }.filter { $0.date < next }
        return Timeline(entries: entries.isEmpty ? [entry] : entries, policy: .after(next))
    }

    private func build(_ config: UpNextConfig) async -> UpNextEntry {
        let now = Date()
        guard let data = WidgetData.load() else {
            return UpNextEntry(date: now, occurrence: nil, plan: nil, note: "Open NUS Companion to set up")
        }
        guard let o = Schedule.upcoming(data, at: now) else {
            return UpNextEntry(date: now, occurrence: nil, plan: nil, note: "Nothing coming up")
        }
        guard let lat = o.item.lat, let lng = o.item.lng,
              let (dest, walkEnd) = ShuttleRouting.nearestStop(data.stops, lat: lat, lng: lng), walkEnd < 700 else {
            return UpNextEntry(date: now, occurrence: o, plan: nil, note: "No shuttle stop near this venue")
        }
        let origin = data.stops.first { $0.code == (config.stop?.isNUS == true ? config.stop!.id : "") }
            ?? data.stops.first { $0.code == StopEntity.fallback.id }
        guard let origin else { return UpNextEntry(date: now, occurrence: o, plan: nil, note: nil) }
        if origin.code == dest.code {
            return UpNextEntry(date: now, occurrence: o, plan: nil, note: "Walk from \(origin.name)")
        }
        let rides = ShuttleRouting.rides(data.routes, from: origin.code, to: dest.code)
        guard !rides.isEmpty else {
            return UpNextEntry(date: now, occurrence: o, plan: nil, note: "No direct shuttle from \(origin.name)")
        }
        let live = await Arrivals.shuttle(origin.code)
        let walk = walkEnd / 1.25
        var best: ShuttlePlan?
        for ride in rides {
            guard let times = live.first(where: { $0.service == ride.service })?.times else { continue }
            for t in times {
                let arrive = t.addingTimeInterval(Double(ride.stops) * 100 + walk)
                let plan = ShuttlePlan(service: ride.service, fromName: origin.name, toName: dest.name, stops: ride.stops,
                                       board: t, arrive: arrive, onTime: arrive <= o.start)
                // Prefer the latest bus that still gets you there on time;
                // otherwise the one that arrives soonest.
                if best == nil
                    || (plan.onTime && (!best!.onTime || plan.board > best!.board))
                    || (!plan.onTime && !best!.onTime && plan.arrive < best!.arrive) { best = plan }
            }
        }
        return UpNextEntry(date: now, occurrence: o, plan: best,
                           note: best == nil ? "No \(rides.map(\.service).joined(separator: "/")) running now" : nil)
    }

    private func sample() -> UpNextEntry {
        let start = Date().addingTimeInterval(25 * 60)
        let item = WidgetData.Item(kind: "lesson", title: "CS2040S", subtitle: "Tutorial 08", day: nil, date: nil,
                                   start: "14:00", end: "15:00", venue: "COM1-0210", lat: nil, lng: nil)
        let plan = ShuttlePlan(service: "D1", fromName: "Central Library", toName: "COM 3", stops: 2,
                               board: Date().addingTimeInterval(180), arrive: start.addingTimeInterval(-300), onTime: true)
        return UpNextEntry(date: Date(), occurrence: Occurrence(item: item, start: start, end: start.addingTimeInterval(3600)), plan: plan, note: nil)
    }
}

struct UpNextView: View {
    let entry: UpNextEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let o = entry.occurrence {
                HStack {
                    Text("UP NEXT · \(Schedule.whenLabel(o.start, from: entry.date).uppercased())")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.accentCyan)
                    Spacer()
                    Text(o.start.formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(.white.opacity(0.65))
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(o.item.title).font(.system(size: 20, weight: .bold)).lineLimit(1)
                    Text("\(o.item.subtitle)\(o.item.venue.isEmpty ? "" : " · \(o.item.venue)")")
                        .font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                }
                Divider().overlay(Color.white.opacity(0.15))
                if let p = entry.plan {
                    HStack(spacing: 8) {
                        ServiceBadge(service: p.service, isShuttle: true)
                        Text("from \(p.fromName)").font(.caption).lineLimit(1)
                        Spacer()
                        Text(minutesText(p.board, from: entry.date) == "Arr" ? "Arriving" : "in \(minutesText(p.board, from: entry.date)) min")
                            .font(.caption.weight(.semibold))
                    }
                    Text(p.onTime
                         ? "Catch it at \(p.board.formatted(date: .omitted, time: .shortened)) · \(p.stops) stop\(p.stops == 1 ? "" : "s") to \(p.toName)"
                         : "You'll be about \(Int(p.arrive.timeIntervalSince(entry.occurrence!.start) / 60)) min late · \(p.stops) stops to \(p.toName)")
                        .font(.caption2).foregroundStyle(p.onTime ? Color.white.opacity(0.65) : Color.orange).lineLimit(1)
                } else if let note = entry.note {
                    Text(note).font(.caption).foregroundStyle(.white.opacity(0.65))
                }
            } else {
                Text("UP NEXT").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.accentCyan)
                Text(entry.note ?? "Nothing coming up").font(.subheadline.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(entry.occurrence.flatMap { o in
            o.item.venue.isEmpty ? deepLink("today") : deepLink("map?venue=\(o.item.venue.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")")
        })
    }
}

struct UpNextWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "UpNext", intent: UpNextConfig.self, provider: UpNextProvider()) { entry in
            UpNextView(entry: entry)
                .nusWidgetStyle()
                .containerBackground(for: .widget) { Color.widgetBG }
        }
        .configurationDisplayName("Up next")
        .description("Your next class and the shuttle to catch from your usual stop.")
        .supportedFamilies([.systemMedium])
    }
}
