import Capacitor
import Foundation
import WidgetKit

/// JS bridge: `Capacitor.Plugins.WidgetBridge.update({ data: JSON string })`.
/// Saves the schedule/stops snapshot the home screen widgets read (see
/// TripActivity/WidgetShared.swift) and asks iOS to redraw them.
/// `pinStop({ id, name, isNUS, publicCode, services?, to? })` sets the stop shown by Bus stop
/// widgets set to "Chosen in the app" (the Show on widget button on the map).
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pinStop", returnType: CAPPluginReturnPromise)
    ]

    @objc func pinStop(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let name = call.getString("name"), let defaults = AppGroup.defaults else {
            call.reject("Stop unavailable.")
            return
        }
        var stop: [String: Any] = ["id": id, "name": name, "isNUS": call.getBool("isNUS") ?? false]
        if let code = call.getString("publicCode") { stop["publicCode"] = code }
        // From a route: the bus to catch here and where it goes.
        if let services = call.getArray("services", String.self), !services.isEmpty { stop["services"] = services }
        if let to = call.getString("to") { stop["to"] = to }
        if let data = try? JSONSerialization.data(withJSONObject: stop), let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: "widget.pinnedStop.v1")
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "BusStop")
        call.resolve()
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("data"),
              let defaults = AppGroup.defaults else {
            call.reject("Widget data unavailable.")
            return
        }
        if defaults.string(forKey: "widget.v1") != json {
            defaults.set(json, forKey: "widget.v1")
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
