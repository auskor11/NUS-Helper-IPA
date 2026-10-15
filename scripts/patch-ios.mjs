// Runs after `cap sync ios`, which regenerates ios/App/App/capacitor.config.json.
// Registers the app's own native plugins (ios/App/App/Trip) alongside the
// npm plugins so the bridge loads them at startup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "ios", "App", "App", "capacitor.config.json");
const LOCAL_PLUGINS = ["TripActivityPlugin", "WidgetBridgePlugin"];

const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.packageClassList = [...new Set([...(config.packageClassList || []), ...LOCAL_PLUGINS])];
fs.writeFileSync(file, JSON.stringify(config, null, "\t") + "\n");
console.log(`Native plugins: ${config.packageClassList.join(", ")}`);
