import Foundation

// The App Group the app and its widgets share. Built in Xcode it is
// group.auskor.NUS-Helper, but AltStore and SideStore rename it when they
// re-sign the app (they append the signer's team ID, as they do to the bundle
// ID), so it's worked out at launch instead of hardcoded. Compiled into both
// the app and the TripActivity extension.

enum AppGroup {
    static let original = "group.auskor.NUS-Helper"

    static let identifier: String = {
        let fm = FileManager.default
        // Only a group this build is signed for has a container, so the first
        // candidate with one is the right name.
        return candidates.first { fm.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil } ?? original
    }()

    static var defaults: UserDefaults? { UserDefaults(suiteName: identifier) }

    static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) }

    private static var candidates: [String] {
        var list: [String] = []
        // AltStore lists the renamed groups in Info.plist.
        if let groups = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] {
            list += groups.filter { $0.hasPrefix(original) }
        }
        // Otherwise derive it from the bundle ID, which is renamed the same way
        // (auskor.NUS-Helper.<TEAMID>, and .TripActivity for the extension).
        if var id = Bundle.main.bundleIdentifier {
            if id.hasSuffix(".TripActivity") { id = String(id.dropLast(".TripActivity".count)) }
            if id.hasPrefix("auskor.NUS-Helper") { list.append("group." + id) }
        }
        list.append(original)
        return list
    }
}
