import ActivityKit
import AppIntents
import Foundation

/// Shared between the app (which starts and updates the trip) and the
/// TripActivity widget extension (which draws the Dynamic Island and the
/// lock screen card). Keep both targets' copies identical: this one file is
/// compiled into both.
struct TripAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// walk, wait, ride, street, arrived
        var phase: String
        /// SF Symbol for the current way of travelling.
        var icon: String
        /// Service shown in a coloured badge (e.g. "R2", "95", "EW"); empty when walking.
        var line: String
        /// Badge colour as "#rrggbb".
        var lineColor: String
        var title: String
        var subtitle: String
        /// Short value for the compact island, e.g. "3 stops" or "5 min".
        var metric: String
        /// When set, the island shows a live countdown to this time (next bus).
        var countdownTo: Date?
        var stopsLeft: Int
        var totalStops: Int
        var eta: Date
    }

    var destination: String
    /// transit, walk, cycle or drive
    var mode: String
}

extension Notification.Name {
    /// Posted in the app when "End trip" is tapped on the island or lock screen.
    static let endTripFromIsland = Notification.Name("EndTripFromIsland")
}

/// The "End trip" button on the Dynamic Island and lock screen. iOS runs it
/// in the app's process (in the background), so the trip tracker hears about
/// it and stops; the Live Activity is ended here too in case the app isn't
/// tracking (it notices on its next launch).
struct EndTripIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "End trip"
    static var description = IntentDescription("Ends the trip shown in the Dynamic Island.")

    init() {}

    func perform() async throws -> some IntentResult {
        await MainActor.run { NotificationCenter.default.post(name: .endTripFromIsland, object: nil) }
        for activity in Activity<TripAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        return .result()
    }
}
