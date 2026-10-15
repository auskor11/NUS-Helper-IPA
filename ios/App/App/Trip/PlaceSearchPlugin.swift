import Capacitor
import Foundation
import MapKit

/// JS bridge: `Capacitor.Plugins.PlaceSearch.search({ query, lat, lng, latDelta, lngDelta })`.
/// Searches Apple Maps for places around the visible map, the way the Maps
/// app does: businesses and landmarks first, then addresses. Resolves
/// `{ places: [{ name, address, area, category, lat, lng, phone, url }] }`.
@objc(PlaceSearchPlugin)
public class PlaceSearchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PlaceSearchPlugin"
    public let jsName = "PlaceSearch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "search", returnType: CAPPluginReturnPromise)
    ]

    @objc func search(_ call: CAPPluginCall) {
        guard let query = call.getString("query")?.trimmingCharacters(in: .whitespaces), !query.isEmpty else {
            call.resolve(["places": []])
            return
        }
        let center = CLLocationCoordinate2D(latitude: call.getDouble("lat") ?? 1.2966, longitude: call.getDouble("lng") ?? 103.7764)
        let span = MKCoordinateSpan(latitudeDelta: call.getDouble("latDelta") ?? 0.05, longitudeDelta: call.getDouble("lngDelta") ?? 0.05)

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = MKCoordinateRegion(center: center, span: span)
        request.resultTypes = [.pointOfInterest, .address]

        MKLocalSearch(request: request).start { response, error in
            guard let items = response?.mapItems else {
                // "No results" comes back as an error; treat it as an empty list.
                if let error = error as? MKError, error.code != .placemarkNotFound {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["places": []])
                }
                return
            }
            call.resolve(["places": items.map(Self.describe)])
        }
    }

    private static func describe(_ item: MKMapItem) -> [String: Any] {
        let mark = item.placemark
        let street = [mark.subThoroughfare, mark.thoroughfare].compactMap { $0 }.joined(separator: " ")
        var place: [String: Any] = [
            "name": item.name ?? street,
            "address": street,
            "area": mark.subLocality ?? mark.locality ?? "",
            "postcode": mark.postalCode ?? "",
            "category": item.pointOfInterestCategory.map(categoryLabel) ?? "",
            "lat": mark.coordinate.latitude,
            "lng": mark.coordinate.longitude
        ]
        if let phone = item.phoneNumber { place["phone"] = phone }
        if let url = item.url { place["url"] = url.absoluteString }
        return place
    }

    /// "MKPOICategoryFitnessCenter" -> "Fitness centre".
    private static func categoryLabel(_ category: MKPointOfInterestCategory) -> String {
        let overrides: [MKPointOfInterestCategory: String] = [
            .publicTransport: "Station", .fitnessCenter: "Gym", .foodMarket: "Supermarket",
            .nightlife: "Bar", .atm: "ATM", .evCharger: "EV charger", .parking: "Car park"
        ]
        if let label = overrides[category] { return label }
        let raw = category.rawValue.replacingOccurrences(of: "MKPOICategory", with: "")
        let words = raw.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
        return words.prefix(1) + words.dropFirst().lowercased()
    }
}
