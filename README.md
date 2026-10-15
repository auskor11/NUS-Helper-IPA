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
| Directions | Same: Transit (bus + MRT via Transitous), Walk, Cycle and Drive, all drawn on the in-app map | `app/map.js` in the web app |
| NUS shuttle arrivals embedded from bus.hewliyang.com (the API blocks browsers) | Native rows: the API is called natively via CapacitorHttp | `app/places.js` in the web app |
| Firebase config from `/__/firebase/init.json` | Embedded in `firebase-config.js` at sync time | `scripts/sync-web.mjs` |

Not bundled: `sw.js` (service workers don't run in iOS apps).

## Dynamic Island trips

**Start trip** in a route's details starts a Live Activity. It shows in the Dynamic Island and on the lock screen. The phone tracks the trip with background location until it ends.

- Transit: walking to the stop, then a live countdown to the bus, then stops left with a progress bar. One stop before getting off, the island expands and the phone vibrates.
- Walk, cycle and drive: distance and time left.
- The trip ends on arrival, from **End trip**, or after 2 hours.

Code: `ios/App/App/Trip/` (tracker + Capacitor plugin) and `ios/App/TripActivity/` (widget extension UI). `TripAttributes.swift` is compiled into both targets. The plugin is registered through `packageClassList`; `scripts/patch-ios.mjs` adds it after every `cap sync`. Requires iOS 16.2+.

To test a ride in the simulator, move the simulated location along stops:

```bash
xcrun simctl location booted start --speed=4 1.2966,103.7735 1.297204,103.772688 1.298904,103.774118 1.301081,103.77369 1.303876,103.774621
```

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
