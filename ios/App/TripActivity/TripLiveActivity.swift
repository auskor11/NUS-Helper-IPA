import ActivityKit
import SwiftUI
import WidgetKit

@main
struct TripActivityBundle: WidgetBundle {
    var body: some Widget {
        TripLiveActivity()
        NextClassWidget()
        UpNextWidget()
        BusStopWidget()
    }
}

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripAttributes.self) { context in
            LockScreenTripView(state: context.state, destination: context.attributes.destination)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(tripURL)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LineBadge(state: s).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    MetricView(state: s, large: true).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(s.title).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        if s.totalStops > 0 && s.phase == "ride" {
                            StopDots(state: s)
                        }
                        HStack {
                            Text(s.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            Spacer()
                            if s.phase != "arrived" && s.phase != "street" {
                                Text("Arrive \(s.eta, style: .time)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if s.phase != "arrived" { EndTripButton() }
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                LineBadge(state: s, compact: true)
            } compactTrailing: {
                MetricView(state: s, large: false)
            } minimal: {
                MinimalMetric(state: s)
            }
            .keylineTint(Color(hex: s.lineColor))
            .widgetURL(tripURL)
        }
    }
}

/// Tapping the island or lock screen card reopens the trip in the app.
private let tripURL = URL(string: "nuscompanion://open/map?trip=1")

/// Coloured service badge ("R2"), or the travel icon when walking/driving.
struct LineBadge: View {
    let state: TripAttributes.ContentState
    var compact = false

    var body: some View {
        if state.line.isEmpty {
            Image(systemName: state.icon)
                .font(compact ? .caption : .title3)
                .foregroundStyle(Color(hex: state.lineColor))
        } else {
            Text(state.line)
                .font(.system(size: compact ? 12 : 15, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, compact ? 5 : 8)
                .padding(.vertical, compact ? 1 : 3)
                .background(Color(hex: state.lineColor), in: RoundedRectangle(cornerRadius: compact ? 5 : 7))
        }
    }
}

/// Stops left while riding, minutes to the next bus while walking or
/// waiting, otherwise distance left. Bus times are estimates, so they show
/// whole minutes from the latest live data (the app updates them as the
/// minute changes) instead of a seconds countdown.
struct MetricView: View {
    let state: TripAttributes.ContentState
    let large: Bool

    var body: some View {
        Group {
            Text(state.metric).lineLimit(1).monospacedDigit()
        }
        .font(large ? .title3.weight(.semibold) : .caption.weight(.semibold))
        .foregroundStyle(state.phase == "arrived" ? .green : .white)
    }
}

/// The island's smallest form, used when another app (music, a timer) shares
/// it: the number that matters ("5" over "min", "3" over "stops"), in the
/// line's colour, since the badge alone hides when the bus comes.
struct MinimalMetric: View {
    let state: TripAttributes.ContentState

    var body: some View {
        let parts = state.metric.split(separator: " ", maxSplits: 1).map(String.init)
        let tint = state.phase == "arrived" ? Color.green : Color(hex: state.lineColor)
        if state.phase == "arrived" {
            Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.green)
        } else if parts.count == 2 {
            VStack(spacing: -2) {
                Text(parts[0]).font(.system(size: 13, weight: .bold)).monospacedDigit()
                    .minimumScaleFactor(0.6)
                Text(parts[1]).font(.system(size: 8, weight: .semibold))
            }
            .lineLimit(1)
            .foregroundStyle(tint)
        } else {
            Text(state.metric).font(.system(size: 11, weight: .bold))
                .minimumScaleFactor(0.6).lineLimit(1)
                .foregroundStyle(tint)
        }
    }
}

/// One dot per stop on the current ride; passed stops are filled in.
struct StopDots: View {
    let state: TripAttributes.ContentState

    var body: some View {
        let total = min(state.totalStops, 14)
        let done = max(0, total - min(state.stopsLeft, total))
        HStack(spacing: 4) {
            ForEach(0..<total, id: \.self) { i in
                Circle()
                    .fill(i < done ? Color(hex: state.lineColor) : (i == done ? Color.white : Color.gray.opacity(0.45)))
                    .frame(width: 8, height: 8)
            }
            if state.totalStops > total { Text("…").font(.caption2).foregroundStyle(.secondary) }
        }
    }
}

struct LockScreenTripView: View {
    let state: TripAttributes.ContentState
    let destination: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                LineBadge(state: state)
                Text(state.title).font(.headline).foregroundStyle(.white).lineLimit(1)
                Spacer()
                MetricView(state: state, large: true)
            }
            if state.totalStops > 0 && state.phase == "ride" {
                StopDots(state: state)
            }
            HStack {
                Text(state.subtitle).font(.subheadline).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                Spacer()
                if state.phase != "arrived" && state.phase != "street" {
                    Text("Arrive \(state.eta, style: .time)").font(.subheadline).foregroundStyle(.white.opacity(0.75))
                }
            }
            if state.phase != "arrived" { EndTripButton() }
        }
        .padding(16)
    }
}

/// Ends the trip without opening the app (EndTripIntent).
struct EndTripButton: View {
    var body: some View {
        Button(intent: EndTripIntent()) {
            Label("End trip", systemImage: "xmark.circle.fill")
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(.red)
    }
}

extension Color {
    init(hex: String) {
        let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: clean).scanHexInt64(&value)
        self.init(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}
