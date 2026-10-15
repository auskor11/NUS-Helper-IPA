/*
 * NUS Companion V11 Firebase configuration.
 *
 * OPTION A (recommended):
 * Deploy with Firebase Hosting. V11 automatically tries:
 *   /__/firebase/init.json
 *   /__/firebase/init.js
 *
 * OPTION B:
 * Paste the Firebase Web App config from:
 * Firebase Console → Project settings → Your apps → Web app
 *
 * Replace the values below with your REAL values.
 */
// Optional Google Places integration for searching locations not in NUSMods.
window.NUS_GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";

window.NUS_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Added by NUS Helper IPA sync-web.mjs
window.NUS_FIREBASE_CONFIG = {
  "apiKey": "AIzaSyDPw4DPL6wgoV_R_KhQQqzBWqcX3qXVPf4",
  "authDomain": "nus-app-5a7d7.firebaseapp.com",
  "projectId": "nus-app-5a7d7",
  "storageBucket": "nus-app-5a7d7.firebasestorage.app",
  "messagingSenderId": "685608964768",
  "appId": "1:685608964768:web:58a97d33f7806b09b72fc5"
};
