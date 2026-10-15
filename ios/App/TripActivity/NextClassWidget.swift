import SwiftUI
import WidgetKit

// Next class: what's on now or next, with a countdown. Works offline: the
// whole day is laid out as timeline entries from the app's saved schedule.

struct NextClassEntry: TimelineEntry {
    let date: Date
    let occurrence: Occurrence?
    let hasData: Bool
}

struct NextClassProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextClassEntry { sample() }

    func getSnapshot(in context: Context, completion: @escaping (NextClassEntry) -> Void) {
        completion(context.isPreview ? sample() : entry(at: Date(), data: WidgetData.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextClassEntry>) -> Void) {
        let now = Date()
        let data = WidgetData.load()
        // A new entry whenever something starts or ends in the next day, and
        // every 5 minutes for the next 3 hours so the countdown stays current.
        var dates = [now]
        for i in 1...36 { dates.append(now.addingTimeInterval(Double(i) * 300)) }
        if let data {
            for o in Schedule.occurrences(data, from: now, days: 2) where o.end > now && o.start < now.addingTimeInterval(86_400) {
                if o.start > now { dates.append(o.start) }
                dates.append(o.end)
            }
        }
        let entries = Array(Set(dates)).sorted().map { entry(at: $0, data: data) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(6 * 3600))))
    }

    private func entry(at date: Date, data: WidgetData?) -> NextClassEntry {
        NextClassEntry(date: date, occurrence: data.flatMap { Schedule.next($0, at: date) }, hasData: data != nil)
    }

    private func sample() -> NextClassEntry {
        let start = Date().addingTimeInterval(25 * 60)
        let item = WidgetData.Item(kind: "lesson", title: "CS2040S", subtitle: "Tutorial 08", day: nil, date: nil,
                                   start: "14:00", end: "15:00", venue: "COM1-0210", lat: nil, lng: nil)
        return NextClassEntry(date: Date(), occurrence: Occurrence(item: item, start: start, end: start.addingTimeInterval(3600)), hasData: true)
    }
}

struct NextClassView: View {
    @Environment(\.widgetFamily) var family
    let entry: NextClassEntry

    var body: some View {
        Group {
            if let o = entry.occurrence {
                switch family {
                case .accessoryInline:
                    Text("\(o.item.title) · \(o.start, style: .time)")
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 1) {
                        Text(o.item.title).font(.headline).widgetAccentable()
                        Text("\(o.start, style: .time) · \(o.item.venue)").font(.caption)
                        whenText(o).font(.caption)
                    }
                default:
                    small(o)
                }
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("NEXT CLASS").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.accentCyan)
                    Text(entry.hasData ? "Nothing coming up" : "Open NUS Companion to set up")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .widgetURL(entry.occurrence.flatMap { o in o.item.venue.isEmpty ? deepLink("today") : deepLink("map?venue=\(o.item.venue.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") })
    }

    @ViewBuilder
    private func whenText(_ o: Occurrence) -> some View {
        if o.start <= entry.date { Text("Now · until \(o.end.formatted(date: .omitted, time: .shortened))") }
        else { Text(Schedule.whenLabel(o.start, from: entry.date)) }
    }

    private func small(_ o: Occurrence) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            whenText(o).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.accentCyan).lineLimit(1)
            Spacer(minLength: 2)
            Text(o.item.title).font(.system(size: 22, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
            Text(o.item.subtitle).font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
            Spacer(minLength: 4)
            Text("\(o.start, style: .time) – \(o.end, style: .time)").font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
            if !o.item.venue.isEmpty {
                Label(o.item.venue, systemImage: "mappin").font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct NextClassWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextClass", provider: NextClassProvider()) { entry in
            NextClassView(entry: entry)
                .nusWidgetStyle()
                .containerBackground(for: .widget) { Color.widgetBG }
        }
        .configurationDisplayName("Next class")
        .description("Your next class or activity, with a countdown.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
    }
}
