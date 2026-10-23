import ActivityKit
import AudioToolbox
import CoreLocation
import Foundation
import os

private let log = Logger(subsystem: "auskor.NUS-Helper", category: "Trip")

/// A trip as sent from the web app (see app/map.js `tripPlan`).
struct TripPlan: Codable {
    struct Stop: Codable { let name: String; let lat: Double; let lng: Double; let time: Double? }
    struct Leg: Codable {
        /// WALK, CYCLE, DRIVE, SHUTTLE, BUS, SUBWAY, RAIL…
        let mode: String
        let line: String
        let color: String
        let toName: String
        let toLat: Double
        let toLng: Double
        /// Stop code for live arrivals, with liveKind "shuttle" (NUS NextBus) or "bus" (arrivelah).
        let code: String?
        let liveKind: String?
        /// Boarding stop … alighting stop, for transit legs.
        let stops: [Stop]
        /// [[lat, lng]] for walking/cycling/driving legs.
        let path: [[Double]]
        let duration: Double
        /// Scheduled start/end, ms since 1970.
        let start: Double
        let end: Double
    }
    let destination: String
    let mode: String
    let end: Double
    let legs: [Leg]
}

/// Follows the user along a trip, keeps the Live Activity (Dynamic Island and
/// lock screen) up to date, and alerts one stop before getting off.
/// Location updates keep running in the background for the length of the trip.
@available(iOS 16.2, *)
final class TripTracker: NSObject, CLLocationManagerDelegate {
    static let shared = TripTracker()

    var onEnd: (() -> Void)?
    /// Called when the bus the user was heading for has gone (or is running
    /// well late), so the app can offer other routes.
    var onBehind: (([String: Any]) -> Void)?
    var isActive: Bool { plan != nil }

    /// The user is behind plan for an upcoming ride: the bus they were
    /// heading for (`was`) can't be caught any more, the next is at `next`.
    struct Behind { let leg: Int; let line: String; let service: String; let was: Date; let next: Date }
    private(set) var behind: Behind?
    /// First live arrival seen for each ride: the bus the user is aiming for.
    private var baseline: [Int: Date] = [:]

    var behindInfo: [String: Any]? {
        guard let behind else { return nil }
        return ["leg": behind.leg, "line": behind.line, "service": behind.service,
                "was": behind.was.timeIntervalSince1970 * 1000, "next": behind.next.timeIntervalSince1970 * 1000]
    }

    private let locationManager = CLLocationManager()
    private var plan: TripPlan?
    private var activity: Activity<TripAttributes>?
    private var legIndex = 0
    private var progress = 0          // index of the furthest stop reached on the current ride
    private var boarded = false
    private var alertedLeg = -1
    private var pathIndex = 0         // furthest point reached along a street leg
    private var nearBoarding = false  // came within 150 m of the stop this walk leads to
    private var location: CLLocation?
    private var liveNext: Date?
    private var liveFetchedAt = Date.distantPast
    private var lastPushed: TripAttributes.ContentState?
    private var lastPushAt = Date.distantPast
    private var timer: Timer?
    private var startedAt = Date()

    private static let maxTripLength: TimeInterval = 2 * 60 * 60
    private static let savedKey = "trip.active.v1"

    /// Saved so a trip survives the app being closed: the Live Activity keeps
    /// running, and on the next launch `restore()` picks it back up.
    private struct Saved: Codable { let plan: TripPlan; let startedAt: Date; let legIndex: Int }

    /// Written straight to a file (not UserDefaults, which saves lazily and
    /// can be lost if the app is swiped away right after a trip starts).
    private static var savedURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("active-trip.json")
    }

    private func persist() {
        guard let plan, let data = try? JSONEncoder().encode(Saved(plan: plan, startedAt: startedAt, legIndex: legIndex)) else { return }
        try? data.write(to: Self.savedURL, options: .atomic)
    }

    private static func clearSaved() {
        try? FileManager.default.removeItem(at: savedURL)
        UserDefaults.standard.removeObject(forKey: savedKey)
    }

    /// Destination of a trip still showing in the Dynamic Island, even if its
    /// plan couldn't be restored.
    var runningDestination: String? {
        activity?.attributes.destination ?? Activity<TripAttributes>.activities.first?.attributes.destination
    }

    /// Called at launch. Re-attaches to a trip's Live Activity left running
    /// when the app was closed, and resumes tracking it; ends any activity
    /// that can't be resumed.
    func restore() {
        guard plan == nil else { return }
        let running = Activity<TripAttributes>.activities
        guard let current = running.first else { Self.clearSaved(); return }
        let data = (try? Data(contentsOf: Self.savedURL)) ?? UserDefaults.standard.data(forKey: Self.savedKey)
        guard let data, let saved = try? JSONDecoder().decode(Saved.self, from: data) else {
            // The island is still up but the plan is gone: leave it showing so
            // the app can offer to end it, rather than silently removing it.
            log.info("Trip activity running without a saved plan")
            return
        }
        guard Date().timeIntervalSince(saved.startedAt) < Self.maxTripLength else {
            Self.clearSaved()
            for a in running { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        for a in running.dropFirst() { Task { await a.end(nil, dismissalPolicy: .immediate) } }
        plan = saved.plan
        activity = current
        startedAt = saved.startedAt
        legIndex = min(saved.legIndex, saved.plan.legs.count - 1)
        progress = 0; boarded = false; alertedLeg = -1; pathIndex = 0; behind = nil; baseline = [:]
        liveNext = nil; liveFetchedAt = .distantPast; lastPushed = current.content.state; lastPushAt = .distantPast
        log.info("Trip restored to \(saved.plan.destination, privacy: .public) at leg \(self.legIndex)")
        startTracking()
    }

    /// The trip plan as JSON, for the app to redraw the trip after a restart.
    var planJSON: String? {
        guard let plan, let data = try? JSONEncoder().encode(plan) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private static let walkSpeed = 1.3 // m/s

    // MARK: Start / end

    func start(_ newPlan: TripPlan) throws {
        if plan != nil { finish(arrived: false) }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw TripError.disabled }
        guard !newPlan.legs.isEmpty else { throw TripError.empty }

        plan = newPlan
        legIndex = 0; progress = 0; boarded = false; alertedLeg = -1; pathIndex = 0; behind = nil; baseline = [:]
        liveNext = nil; liveFetchedAt = .distantPast; lastPushed = nil; startedAt = Date()

        let state = makeState()
        activity = try Activity.request(
            attributes: TripAttributes(destination: newPlan.destination, mode: newPlan.mode),
            content: .init(state: state, staleDate: nil)
        )
        lastPushed = state
        lastPushAt = Date()
        log.info("Trip started to \(newPlan.destination, privacy: .public) with \(newPlan.legs.count) legs")
        persist()
        startTracking()
    }

    private func startTracking() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 8
        locationManager.activityType = .otherNavigation
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.requestWhenInUseAuthorization()
        locationManager.startUpdatingLocation()

        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.tick() }
        refreshLive()
    }

    func finish(arrived: Bool) {
        guard plan != nil else {
            // An island left from a trip that couldn't be restored.
            for a in Activity<TripAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            Self.clearSaved()
            return
        }
        log.info("Trip ended (arrived: \(arrived))")
        timer?.invalidate(); timer = nil
        locationManager.stopUpdatingLocation()
        locationManager.allowsBackgroundLocationUpdates = false

        let final = arrived ? arrivedState() : (lastPushed ?? makeState())
        let current = activity
        Task {
            await current?.end(.init(state: final, staleDate: nil),
                               dismissalPolicy: arrived ? .after(Date().addingTimeInterval(120)) : .immediate)
        }
        activity = nil
        plan = nil
        Self.clearSaved()
        onEnd?()
    }

    // MARK: Location

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last, loc.horizontalAccuracy >= 0, loc.horizontalAccuracy < 200 else { return }
        location = loc
        advance()
        push()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Keep going on schedule-based estimates; GPS often drops underground.
    }

    private func tick() {
        guard plan != nil else { return }
        if Date().timeIntervalSince(startedAt) > Self.maxTripLength { finish(arrived: false); return }
        advance()
        if Date().timeIntervalSince(liveFetchedAt) > 30 { refreshLive() }
        push()
    }

    /// Moves through the trip's legs as the user reaches each target.
    private func advance() {
        guard let plan, legIndex < plan.legs.count else { return }
        let leg = plan.legs[legIndex]
        let isLast = legIndex == plan.legs.count - 1
        let now = Date()

        if leg.stops.count >= 2 {
            let stops = leg.stops
            let rail = !(leg.mode == "BUS" || leg.mode == "SHUTTLE")
            if let loc = location {
                // Furthest stop within reach, searching a few stops ahead so a
                // stray fix can't skip half the route.
                let radius: Double = rail ? 120 : 60
                for i in progress..<min(progress + 4, stops.count) where distance(loc, stops[i].lat, stops[i].lng) < radius {
                    progress = i
                }
                let first = stops[0], second = stops[1]
                let gap = distance(first.lat, first.lng, second.lat, second.lng)
                if !boarded, distance(loc, first.lat, first.lng) > 150,
                   distance(loc, second.lat, second.lng) < gap { boarded = true }
            }
            // Trains run underground: fall back to the timetable for rail.
            if rail, now.timeIntervalSince1970 * 1000 > leg.start {
                boarded = true
                let byTime = stops.lastIndex { ($0.time ?? .infinity) <= now.timeIntervalSince1970 * 1000 } ?? 0
                progress = max(progress, byTime)
            }
            if progress >= 1 { boarded = true }
            if boarded, behind?.leg == legIndex { behind = nil }

            if boarded, progress >= stops.count - 2, alertedLeg != legIndex {
                alertedLeg = legIndex
                alertGetOff(leg)
            }
            if progress >= stops.count - 1 || (rail && now.timeIntervalSince1970 * 1000 > leg.end + 90_000) {
                nextLeg()
            }
        } else if let loc = location {
            // Already on the next bus or train, though GPS never put the user
            // at the boarding stop (fixes near HDB blocks are often 30+ m off).
            if distance(loc, leg.toLat, leg.toLng) < 150 { nearBoarding = true }
            if let (i, stop) = boardedAhead(loc) { jumpOnto(i, at: stop); return }
            // Walking / cycling / driving: track progress along the path.
            if !leg.path.isEmpty {
                let end = min(pathIndex + 40, leg.path.count)
                var best = pathIndex, bestD = Double.infinity
                for i in pathIndex..<end {
                    let d = distance(loc, leg.path[i][0], leg.path[i][1])
                    if d < bestD { bestD = d; best = i }
                }
                if bestD < 60 { pathIndex = best }
            }
            if distance(loc, leg.toLat, leg.toLng) < (isLast ? 35 : 30) {
                if isLast { finish(arrived: true); return }
                nextLeg()
            }
        }
    }

    /// When walking to a stop: the next ride and the stop the user is at if
    /// they're clearly on it already, either at one of its later stops or
    /// moving at vehicle speed just past the boarding stop.
    private func boardedAhead(_ loc: CLLocation) -> (Int, Int)? {
        guard let plan, legIndex + 1 < plan.legs.count else { return nil }
        let i = legIndex + 1, ride = plan.legs[i]
        guard ride.stops.count >= 2 else { return nil }
        let rail = !(ride.mode == "BUS" || ride.mode == "SHUTTLE")
        let radius: Double = rail ? 120 : 60
        // A later stop only counts after being near the boarding stop, in case
        // the walk there runs along the bus route.
        if nearBoarding, let stop = (1..<min(6, ride.stops.count)).last(where: { distance(loc, ride.stops[$0].lat, ride.stops[$0].lng) < radius }) {
            return (i, stop)
        }
        let first = ride.stops[0], second = ride.stops[1]
        let gap = distance(first.lat, first.lng, second.lat, second.lng)
        if loc.speed > 5, distance(loc, first.lat, first.lng) < 350, distance(loc, second.lat, second.lng) < gap + 100 {
            return (i, 0)
        }
        return nil
    }

    private func jumpOnto(_ index: Int, at stop: Int) {
        log.info("On leg \(index) already (near stop \(stop))")
        legIndex = index; progress = stop; boarded = true; pathIndex = 0; nearBoarding = false
        if let b = behind, b.leg <= index { behind = nil }
        liveNext = nil; liveFetchedAt = .distantPast
        persist()
        refreshLive()
        push(force: true)
    }

    private func nextLeg() {
        legIndex += 1
        log.info("Now on leg \(self.legIndex)")
        progress = 0; boarded = false; pathIndex = 0; nearBoarding = false
        liveNext = nil; liveFetchedAt = .distantPast
        if let b = behind, b.leg < legIndex { behind = nil }
        if let plan, legIndex >= plan.legs.count { finish(arrived: true); return }
        persist()
        refreshLive()
    }

    private func alertGetOff(_ leg: TripPlan.Leg) {
        log.info("Get-off alert for \(leg.toName, privacy: .public)")
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        let state = makeState()
        let alert = AlertConfiguration(title: "Get off at the next stop",
                                       body: "\(leg.toName)",
                                       sound: .named("silence.caf"))
        Task { await activity?.update(.init(state: state, staleDate: nil), alertConfiguration: alert) }
        lastPushed = state
        lastPushAt = Date()
    }

    // MARK: Live arrivals

    /// The next transit leg the user hasn't boarded yet (while riding, the
    /// connection after this ride).
    private var upcomingTransit: (index: Int, leg: TripPlan.Leg)? {
        guard let plan, legIndex < plan.legs.count else { return nil }
        for i in legIndex..<plan.legs.count where plan.legs[i].stops.count >= 2 {
            if i == legIndex && boarded { continue }
            return (i, plan.legs[i])
        }
        return nil
    }

    private func refreshLive() {
        liveFetchedAt = Date()
        guard let (index, leg) = upcomingTransit, let code = leg.code, let kind = leg.liveKind else { return }
        let url: URL?
        if kind == "shuttle" {
            url = URL(string: "https://bus.hewliyang.com/api/stop/\(code)")
        } else {
            url = URL(string: "https://arrivelah2.busrouter.sg/?id=\(code)")
        }
        guard let url else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            var minutes: [Double] = []
            if kind == "shuttle" {
                let timings = ((json["etas"] as? [String: Any])?["timings"] as? [[String: Any]]) ?? []
                for t in timings where (t["name"] as? String) == leg.line {
                    for key in ["arrivalTime", "nextArrivalTime"] {
                        if let s = t[key] as? String, let m = Double(s) { minutes.append(m) }
                    }
                }
            } else {
                let services = (json["services"] as? [[String: Any]]) ?? []
                for s in services where (s["no"] as? String) == leg.line {
                    for key in ["next", "subsequent"] {
                        if let ms = (s[key] as? [String: Any])?["duration_ms"] as? Double { minutes.append(ms / 60_000) }
                    }
                }
            }
            DispatchQueue.main.async {
                guard index == self.upcomingTransit?.index else { return }
                // Catch the first bus the user can still reach.
                let reachIn = self.secondsToBoarding(index)
                let sorted = minutes.sorted()
                let catchable = sorted.first { $0 * 60 >= reachIn - 30 }
                self.liveNext = (catchable ?? sorted.first).map { Date().addingTimeInterval(max(0, $0) * 60) }
                self.checkBehind(index: index, leg: leg, arrivals: sorted, reachIn: reachIn, catchable: catchable)
                self.push(force: true)
            }
        }.resume()
    }

    /// Seconds until the user can be at the boarding stop of leg `target`:
    /// the rest of this walk (or ride), plus any walks in between.
    private func secondsToBoarding(_ target: Int) -> Double {
        guard let plan else { return 0 }
        let nowMs = Date().timeIntervalSince1970 * 1000
        var secs = 0.0
        for i in legIndex..<min(target, plan.legs.count) {
            let l = plan.legs[i]
            if i == legIndex {
                if l.stops.count >= 2 { secs += boarded ? max(0, (l.end - nowMs) / 1000) : l.duration }
                else if let loc = location { secs += distance(loc, l.toLat, l.toLng) / Self.walkSpeed }
                else { secs += l.duration }
            } else { secs += l.duration }
        }
        return secs
    }

    /// Spots a missed bus (or connection): the bus the user was aiming for
    /// can no longer be reached and the next one is 4+ minutes later.
    private func checkBehind(index: Int, leg: TripPlan.Leg, arrivals: [Double], reachIn: Double, catchable: Double?) {
        guard let c = catchable else { return }
        // Moving at vehicle speed: most likely on that bus already.
        if let loc = location, loc.speed > 4, Date().timeIntervalSince(loc.timestamp) < 60 { return }
        let nextAt = Date().addingTimeInterval(c * 60)
        guard let aim = baseline[index] else { baseline[index] = nextAt; return }
        guard nextAt.timeIntervalSince(aim) >= 240 else { return }
        let aimIn = aim.timeIntervalSinceNow
        // It has come and gone, or it's still on the board but out of reach.
        // Give boarding a minute to register before calling it missed.
        let lost = aimIn < -60 || arrivals.contains { abs($0 * 60 - aimIn) < 120 && $0 * 60 < reachIn - 30 }
        guard lost else { return }
        let b = Behind(leg: index, line: leg.line, service: serviceName(leg), was: aim, next: nextAt)
        behind = b
        baseline[index] = nextAt   // aim for the next one; a second miss alerts again
        log.info("Behind plan: missed \(b.service, privacy: .public), next at \(self.timeString(nextAt), privacy: .public)")
        if let info = behindInfo { onBehind?(info) }
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        let state = makeState()
        let alert = AlertConfiguration(title: "Missed the \(b.service)?",
                                       body: "Next one at \(timeString(nextAt)). Open NUS Companion for other routes.",
                                       sound: .named("silence.caf"))
        Task { await activity?.update(.init(state: state, staleDate: nil), alertConfiguration: alert) }
        lastPushed = state
        lastPushAt = Date()
    }

    // MARK: State

    private func push(force: Bool = false) {
        guard plan != nil, let activity else { return }
        let state = makeState()
        let changed = state != lastPushed
        guard changed, force || Date().timeIntervalSince(lastPushAt) > 4 else { return }
        lastPushed = state
        lastPushAt = Date()
        log.info("Island: \(state.phase, privacy: .public) · \(state.title, privacy: .public) · \(state.metric, privacy: .public)")
        Task { await activity.update(.init(state: state, staleDate: Date().addingTimeInterval(300))) }
    }

    private func arrivedState() -> TripAttributes.ContentState {
        .init(phase: "arrived", icon: "checkmark.circle.fill", line: "", lineColor: "#22c55e",
              title: "Arrived", subtitle: plan?.destination ?? "", metric: "Arrived",
              countdownTo: nil, stopsLeft: 0, totalStops: 0, eta: Date())
    }

    private func makeState() -> TripAttributes.ContentState {
        guard let plan, legIndex < plan.legs.count else { return arrivedState() }
        let leg = plan.legs[legIndex]
        let now = Date()

        // Street trips (walk / cycle / drive the whole way).
        if plan.mode != "transit" {
            let left = remainingPathDistance(leg)
            let speed = leg.duration > 0 ? max(1, totalPathDistance(leg) / leg.duration) : Self.walkSpeed
            let secs = left / speed
            let icon = ["cycle": "bicycle", "drive": "car.fill"][plan.mode] ?? "figure.walk"
            let verb = ["cycle": "Cycle", "drive": "Drive"][plan.mode] ?? "Walk"
            // Walk, cycle and drive: distance left in the island, with the
            // time left and arrival time underneath.
            let arrive = now.addingTimeInterval(secs)
            return .init(phase: "street", icon: icon, line: "", lineColor: "#8b7cff",
                         title: "\(verb) to \(plan.destination)",
                         subtitle: "\(formatMinutes(secs)) left · arrive \(timeString(arrive))",
                         metric: formatDistance(left), countdownTo: nil, stopsLeft: 0, totalStops: 0,
                         eta: now.addingTimeInterval(secs))
        }

        let eta = estimatedArrival()

        if leg.stops.count >= 2 {
            let total = leg.stops.count - 1
            if !boarded {
                let when = liveNext ?? Date(timeIntervalSince1970: leg.start / 1000)
                let missed = behind?.leg == legIndex ? "Missed the \(timeString(behind!.was)) · next at \(timeString(when))" : nil
                return .init(phase: "wait", icon: icon(for: leg), line: leg.line, lineColor: leg.color,
                             title: "Board \(serviceName(leg))", subtitle: missed ?? "At \(leg.stops[0].name) · \(liveNext != nil ? "live" : "scheduled")",
                             metric: when.timeIntervalSince(now) <= 30 ? "Arr" : formatMinutes(when.timeIntervalSince(now)), countdownTo: when,
                             stopsLeft: total, totalStops: total, eta: eta)
            }
            let left = max(0, total - progress)
            let next = leg.stops[min(progress + 1, total)].name
            // A connection that's been missed shows instead of the next stop.
            var rideSub = left <= 1 ? "Your stop is next" : "Next stop: \(next)"
            if let b = behind, b.leg > legIndex, left > 1 { rideSub = "Missed connection · next \(b.service) at \(timeString(liveNext ?? b.next))" }
            return .init(phase: "ride", icon: icon(for: leg), line: leg.line, lineColor: leg.color,
                         title: "Get off at \(leg.toName)",
                         subtitle: rideSub,
                         metric: left == 1 ? "1 stop" : "\(left) stops", countdownTo: nil,
                         stopsLeft: left, totalStops: total, eta: eta)
        }

        // Walking between stops, or to the destination at the end.
        let distLeft = location.map { distance($0, leg.toLat, leg.toLng) * 1.2 } ?? leg.duration * Self.walkSpeed
        let isLast = legIndex == plan.legs.count - 1
        // Walking to catch a bus or shuttle: the island shows that service and
        // a countdown to its next arrival (live when available). Any other
        // walk shows the distance left.
        if !isLast, let upcoming = upcomingTransit, upcoming.leg.mode == "BUS" || upcoming.leg.mode == "SHUTTLE" {
            let when = liveNext ?? Date(timeIntervalSince1970: upcoming.leg.start / 1000)
            let wait = when.timeIntervalSince(now)
            return .init(phase: "walk", icon: "figure.walk", line: upcoming.leg.line, lineColor: upcoming.leg.color,
                         title: "Walk to \(leg.toName)",
                         subtitle: behind?.leg == upcoming.index
                            ? "Missed the \(timeString(behind!.was)) · next at \(timeString(when))"
                            : "\(formatDistance(distLeft)) to the stop · \(serviceName(upcoming.leg)) \(liveNext != nil ? "live" : "scheduled")",
                         metric: wait <= 30 ? "Arr" : formatMinutes(wait), countdownTo: when,
                         stopsLeft: 0, totalStops: 0, eta: eta)
        }
        var subtitle = isLast ? "To \(plan.destination)" : "To \(leg.toName)"
        if !isLast, let upcoming = upcomingTransit {
            subtitle += " · \(serviceName(upcoming.leg)) at \(timeString(Date(timeIntervalSince1970: upcoming.leg.start / 1000)))"
        }
        return .init(phase: "walk", icon: "figure.walk", line: "", lineColor: "#8b7cff",
                     title: isLast ? "Walk to \(plan.destination)" : "Walk to \(leg.toName)",
                     subtitle: subtitle, metric: formatDistance(distLeft),
                     countdownTo: nil, stopsLeft: 0, totalStops: 0, eta: eta)
    }

    /// Scheduled arrival, shifted by how late or early the live bus is.
    private func estimatedArrival() -> Date {
        guard let plan else { return Date() }
        var end = Date(timeIntervalSince1970: plan.end / 1000)
        if let next = liveNext, let upcoming = upcomingTransit {
            end = end.addingTimeInterval(next.timeIntervalSince(Date(timeIntervalSince1970: upcoming.leg.start / 1000)))
        }
        return max(end, Date())
    }

    // MARK: Helpers

    private func serviceName(_ leg: TripPlan.Leg) -> String {
        switch leg.mode {
        case "SHUTTLE": return "Shuttle \(leg.line)"
        case "BUS": return "Bus \(leg.line)"
        default: return "\(leg.line) line"
        }
    }

    private func icon(for leg: TripPlan.Leg) -> String {
        leg.mode == "BUS" || leg.mode == "SHUTTLE" ? "bus.fill" : "tram.fill"
    }

    private func totalPathDistance(_ leg: TripPlan.Leg) -> Double {
        zip(leg.path, leg.path.dropFirst()).reduce(0) { $0 + distance($1.0[0], $1.0[1], $1.1[0], $1.1[1]) }
    }

    private func remainingPathDistance(_ leg: TripPlan.Leg) -> Double {
        guard leg.path.count > 1 else {
            return location.map { distance($0, leg.toLat, leg.toLng) } ?? 0
        }
        let rest = Array(leg.path[pathIndex...])
        var d = zip(rest, rest.dropFirst()).reduce(0) { $0 + distance($1.0[0], $1.0[1], $1.1[0], $1.1[1]) }
        if let loc = location { d += distance(loc, rest[0][0], rest[0][1]) }
        return d
    }

    private func distance(_ loc: CLLocation, _ lat: Double, _ lng: Double) -> Double {
        loc.distance(from: CLLocation(latitude: lat, longitude: lng))
    }

    private func distance(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        CLLocation(latitude: lat1, longitude: lng1).distance(from: CLLocation(latitude: lat2, longitude: lng2))
    }

    private func formatMinutes(_ seconds: Double) -> String {
        let m = Int((max(0, seconds) / 60).rounded())
        return m <= 0 ? "Now" : "\(m) min"
    }

    private func formatDistance(_ m: Double) -> String {
        m < 1000 ? "\(Int((m / 10).rounded()) * 10) m" : String(format: "%.1f km", m / 1000)
    }

    private func timeString(_ d: Date) -> String {
        let f = DateFormatter()
        f.timeStyle = .short
        return f.string(from: d)
    }
}

enum TripError: LocalizedError {
    case disabled, empty
    var errorDescription: String? {
        switch self {
        case .disabled: return "Live Activities are turned off for NUS Companion in Settings."
        case .empty: return "This route has no steps."
        }
    }
}
