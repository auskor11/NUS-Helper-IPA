import Capacitor
import Foundation

/// JS bridge: `Capacitor.Plugins.TripActivity` in the web app (registered via
/// packageClassList, see scripts/patch-ios.mjs).
///   start({ trip: JSON string of TripPlan }) → starts the Live Activity
///   end()                                     → ends it
///   isActive()                                → { active }
/// Emits "tripEnded" when a trip finishes on its own (arrival or time limit).
@objc(TripActivityPlugin)
public class TripActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TripActivityPlugin"
    public let jsName = "TripActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isActive", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        // Resume a trip whose Live Activity outlived the app being closed.
        if #available(iOS 16.2, *) {
            DispatchQueue.main.async {
                TripTracker.shared.onEnd = { [weak self] in self?.notifyListeners("tripEnded", data: [:]) }
                TripTracker.shared.restore()
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities need iOS 16.2 or later.")
            return
        }
        guard let json = call.getString("trip"), let data = json.data(using: .utf8) else {
            call.reject("Missing trip.")
            return
        }
        DispatchQueue.main.async {
            do {
                let plan = try JSONDecoder().decode(TripPlan.self, from: data)
                TripTracker.shared.onEnd = { [weak self] in self?.notifyListeners("tripEnded", data: [:]) }
                try TripTracker.shared.start(plan)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 16.2, *) { TripTracker.shared.finish(arrived: false) }
            call.resolve()
        }
    }

    @objc func isActive(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 16.2, *) {
                TripTracker.shared.restore()
                var result: [String: Any] = ["active": TripTracker.shared.isActive]
                if let plan = TripTracker.shared.planJSON { result["plan"] = plan }
                call.resolve(result)
            }
            else { call.resolve(["active": false]) }
        }
    }
}
