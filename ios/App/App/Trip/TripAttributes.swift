import ActivityKit
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
