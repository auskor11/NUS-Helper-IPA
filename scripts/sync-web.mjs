// Copies the NUS Companion web app into www/ and applies the native-only
// patches. The web app in ../NUS Companion/NUS Helper stays the single source
// of truth: re-run `npm run sync` after changing it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(process.env.NUS_WEB_SRC || path.join(root, "..", "NUS Companion", "NUS Helper"));
const out = path.join(root, "www");

// Public Firebase Web App config (same values Firebase Hosting serves at
// /__/firebase/init.json). The app can't reach that endpoint when bundled.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDPw4DPL6wgoV_R_KhQQqzBWqcX3qXVPf4",
  authDomain: "nus-app-5a7d7.firebaseapp.com",
  projectId: "nus-app-5a7d7",
  storageBucket: "nus-app-5a7d7.firebasestorage.app",
  messagingSenderId: "685608964768",
  appId: "1:685608964768:web:58a97d33f7806b09b72fc5"
};

// Web-only files that have no use inside the iOS app.
const SKIP = new Set(["sw.js", "firebase.json"]);
const KEEP_EXT = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".png"]);

if (!fs.existsSync(path.join(src, "index.html"))) {
  console.error(`Web app not found at ${src} (set NUS_WEB_SRC to override).`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const name of fs.readdirSync(src)) {
  const full = path.join(src, name);
  if (name.startsWith(".") || SKIP.has(name)) continue;
  if (fs.statSync(full).isDirectory()) {
    if (name === "assets" || name === "app" || name === "vendor") fs.cpSync(full, path.join(out, name), { recursive: true });
    continue;
  }
  if (KEEP_EXT.has(path.extname(name))) fs.copyFileSync(full, path.join(out, name));
}
fs.cpSync(path.join(root, "native"), path.join(out, "native"), { recursive: true });

function patch(file, from, to) {
  const p = path.join(out, file);
  const text = fs.readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`Patch target not found in ${file}: ${from}`);
  fs.writeFileSync(p, text.split(from).join(to));
}

fs.appendFileSync(
  path.join(out, "firebase-config.js"),
  `\n// Added by NUS Helper IPA sync-web.mjs\nwindow.NUS_FIREBASE_CONFIG = ${JSON.stringify(FIREBASE_CONFIG, null, 2)};\n`
);

// Redirect sign-in can't complete inside the app (Google sign-in is native
// instead), and checking for a redirect result loads a firebaseapp.com iframe
// that can stall start-up.
patch(
  "firebase.js",
  "redirectResult=await auth.getRedirectResult();",
  "if(!window.Capacitor?.isNativePlatform?.()) redirectResult=await auth.getRedirectResult();"
);

let pages = 0;
for (const name of fs.readdirSync(out).filter(n => n.endsWith(".html"))) {
  // Redirect stubs (e.g. tasks.html -> /#/tasks) have no scripts to patch.
  if (!fs.readFileSync(path.join(out, name), "utf8").includes('<script src="/firebase.js"></script>')) continue;
  patch(name, '<script src="/firebase.js"></script>', '<script src="/firebase.js"></script>\n<script src="/native/native-auth.js"></script>');
  const html = fs.readFileSync(path.join(out, name), "utf8");
  if (html.includes('<script src="/shared.js"></script>')) {
    patch(name, '<script src="/shared.js"></script>', '<script src="/shared.js"></script>\n<script src="/native/native-app.js"></script>');
  }
  pages++;
}

console.log(`Synced ${pages} pages from ${src} -> ${out}`);
