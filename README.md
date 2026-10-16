# NUS Helper IPA

Native iOS build of the NUS Companion web app (`../NUS Companion/NUS Helper`), wrapped with Capacitor 8.

The web app ([auskor11/NUS-Helper](https://github.com/auskor11/NUS-Helper), `redesign` branch) is the source of truth. `npm run sync` copies it from `../NUS Companion/NUS Helper` into `www/` and adds the native patches. `www/` is committed, so this repo always holds the exact web app inside the IPA.

## Build the IPA

```bash
npm install
npm run build-ipa
```

Output: `build/NUS Companion.ipa`, development-signed for team `FF395Z92C2`, bundle ID `auskor.NUS-Helper`.

After changing the web app, run `npm run build-ipa` again; it re-syncs first.

## Install on the iPhone

### With AltStore

1. Install AltServer on the Mac (altstore.io), connect the phone, and in Finder tick **Show this iPhone when on Wi-Fi**.
2. AltServer menu → **Install AltStore** → the iPhone, and sign in with your Apple ID.
3. On the phone: trust your Apple ID under Settings → General → VPN & Device Management, and turn on Settings → Privacy & Security → Developer Mode.
4. AirDrop `build/NUS Companion.ipa` to the phone, save it to Files, then AltStore → My Apps → **+** → pick the IPA.

AltStore refreshes the app every 7 days while the phone and Mac share Wi-Fi with AltServer running. The app uses 2 of the free account's 10 weekly app IDs (app + widget extension).

AltStore renames the bundle ID and App Group (it appends your team ID). The app and widgets find the renamed group at launch (`ios/App/App/Trip/AppGroup.swift`), so widgets keep working.

### With a cable

With the phone connected and paired:

```bash
xcrun devicectl device install app --device "Austin's iPhone" "build/NUS Companion.ipa"
```

Or drag the IPA onto the phone in Xcode → Window → Devices and Simulators, or use Sideloadly or AltStore.

Free Apple ID signing expires after **7 days**. Rebuild and reinstall to renew it. Your data lives in Firestore, so nothing is lost.

## What differs from the web app

| Web | iOS app | Where |
|---|---|---|
| Google sign-in via redirect | Native Google Sign-In → token handed to the Firebase JS SDK | `native/native-auth.js` |
| Background Web Push (GitHub Actions) | Local notifications scheduled on the phone, same rules and wording (tasks 7d / 1d / overdue, activities 1d) | `native/native-app.js` |
| Install-app button | Hidden | `native/native-app.js` |
| Map search: OpenStreetMap (Nominatim) | Apple Maps search (MKLocalSearch) around the visible map: business listings, typo-tolerant, with category, phone and website. Falls back to OpenStreetMap | `ios/App/App/Trip/PlaceSearchPlugin.swift`, `app/places.js` in the web app |
| Directions | Same: Transit (bus + MRT via Transitous), Walk, Cycle and Drive, all drawn on the in-app map | `app/map.js` in the web app |
| NUS shuttle arrivals embedded from bus.hewliyang.com (the API blocks browsers) | Native rows: the API is called natively via CapacitorHttp | `app/places.js` in the web app |
| Firebase config from `/__/firebase/init.json` | Embedded in `firebase-config.js` at sync time | `scripts/sync-web.mjs` |

Not bundled: `sw.js` (service workers don't run in iOS apps).

## Syllabus, weeks and bus types

- **Courses** tab: This week / Assessments / Grades across modules; tap a module for its full Outline, Assessments and Grades (weights, your scores, earned so far, still to come). Import via the ⋯ button. Settings (formerly More) is the gear on Today. The file is made by Claude: tap **Make the file with Claude**, copy the prompt, give it to Claude with your modules' lesson plans, and import the `syllabus.json` it makes (or paste its contents). Dated assessments are added to Tasks. Code: `app/syllabus.js` in the web app.
- **Teaching weeks**: classes follow their weeks (NUSMods' `weeks`, or Weekly / Odd / Even / Custom in Modules → Edit timings manually), and skip recess, reading and exam weeks. Semester start dates are in `SEMESTER_STARTS` in `shared.js`; add the next academic year there when NUS publishes it. Widgets get the next four weeks of dated classes.
- **Bus type**: public bus arrivals show single deck / double deck / bendy and how full the bus is (LTA data via arrivelah). NUS shuttles don't report this.
- **Map**: OpenFreeMap vector map ("liberty" style, inverted for dark mode). Change it in the map's layers menu.

## Dynamic Island trips

**Start trip** in a route's details starts a Live Activity. It shows in the Dynamic Island and on the lock screen. The phone tracks the trip with background location until it ends.

- Transit: walking to the stop, then a live countdown to the bus, then stops left with a progress bar. One stop before getting off, the island expands and the phone vibrates.
- Walk, cycle and drive: distance and time left.
- The trip ends on arrival, from **End trip**, or after 2 hours.

Code: `ios/App/App/Trip/` (tracker + Capacitor plugin; the folder also holds the widget and place search plugins) and `ios/App/TripActivity/` (widget extension UI). `TripAttributes.swift` is compiled into both targets. The plugin is registered through `packageClassList`; `scripts/patch-ios.mjs` adds it after every `cap sync`. Requires iOS 16.2+.

To test a ride in the simulator, move the simulated location along stops:

```bash
xcrun simctl location booted start --speed=4 1.2966,103.7735 1.297204,103.772688 1.298904,103.774118 1.301081,103.77369 1.303876,103.774621
```

## Home screen widgets

Press and hold the home screen → Edit → Add Widget → NUS Companion.

- **Next class** (small, lock screen): what's on now or next, with a countdown. Works offline.
- **Up next** (medium): the next class and the NUS shuttle to catch from your usual stop (press and hold the widget → Edit Widget). It picks the latest bus that still gets you there on time, using live times.
- **Bus stop** (small, medium, lock screen): live NUS shuttle and public bus arrivals at a stop you pick, with a refresh button. Press and hold → Edit Widget: **Stop** lists NUS stops and public stops near NUS; **Bus stop no.** takes any public stop's 5-digit number (on the stop's sign) and overrides **Stop**.

Widget settings store stops as text labels, not App Intents entities: iOS failed to look entities back up, so the widgets always fell back to Central Library.

The app writes the schedule, NUS stops and shuttle routes to the `group.auskor.NUS-Helper` App Group (`WidgetBridgePlugin.swift`, called from `native/native-app.js`); the widgets in `ios/App/TripActivity/` read it and fetch live bus times themselves. Widget taps open the app via `nuscompanion://open/<route>`. Home screen widgets refresh about every 10 minutes (iOS sets the limit); between refreshes the minutes count down on their own.

## Files

- `scripts/sync-web.mjs` copies the web app into `www/` and applies the patches.
- `scripts/build-ipa.sh` archives the app and exports the IPA.
- `scripts/patch-ios.mjs` registers the app's own native plugins after `cap sync`.
- `native/` holds the JS loaded only in the iOS app.
- `resources/` holds the SVG sources for the app icon and splash screen.
- `ios/App/App/GoogleService-Info.plist` is the Firebase iOS app config (`firebase apps:sdkconfig IOS 1:685608964768:ios:1f8d597eef1abe93b72fc5`).

## Backups

- `backup/2026-10-15-before-update`: this repo before the app was added (README only).
- `backup/2026-10-15-before-in-app-navigation`: the app before Citymapper was replaced with in-app directions.
- `backup/2026-10-15-widgets-and-map-search` (tag `v1.0-2026-10-15`): widgets and the OpenStreetMap search.
- `backup/2026-10-16-before-altstore` (tag `v1.1-2026-10-16`): Apple Maps search, before the AltStore changes.
- `backup/2026-10-16-before-syllabus` (tag `v1.2-2026-10-16`): before the new map, bus types, teaching weeks and syllabus.
