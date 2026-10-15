import ActivityKit
import SwiftUI
import WidgetKit

@main
struct TripActivityBundle: WidgetBundle {
    var body: some Widget {
        TripLiveActivity()
    }
}

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripAttributes.self) { context in
            LockScreenTripView(state: context.state, destination: context.attributes.destination)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
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
                            if s.phase != "arrived" {
                                Text("Arrive \(s.eta, style: .time)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                LineBadge(state: s, compact: true)
            } compactTrailing: {
                MetricView(state: s, large: false)
            } minimal: {
                LineBadge(state: s, compact: true)
            }
            .keylineTint(Color(hex: s.lineColor))
        }
    }
}

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

/// Stops left while riding, a countdown while waiting, otherwise time left.
struct MetricView: View {
    let state: TripAttributes.ContentState
    let large: Bool

    var body: some View {
        Group {
            if let target = state.countdownTo, target > .now, state.phase == "walk" || state.phase == "wait" {
                Text(timerInterval: Date.now...target, countsDown: true)
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: large ? 70 : 44)
            } else {
                Text(state.metric).lineLimit(1)
            }
        }
        .font(large ? .title3.weight(.semibold) : .caption.weight(.semibold))
        .foregroundStyle(state.phase == "arrived" ? .green : .white)
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
                if state.phase != "arrived" {
                    Text("Arrive \(state.eta, style: .time)").font(.subheadline).foregroundStyle(.white.opacity(0.75))
                }
            }
        }
        .padding(16)
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
