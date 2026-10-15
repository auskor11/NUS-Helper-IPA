import Capacitor
import Foundation
import WidgetKit

/// JS bridge: `Capacitor.Plugins.WidgetBridge.update({ data: JSON string })`.
/// Saves the schedule/stops snapshot the home screen widgets read (see
/// TripActivity/WidgetShared.swift) and asks iOS to redraw them.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("data"),
              let defaults = UserDefaults(suiteName: "group.auskor.NUS-Helper") else {
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
