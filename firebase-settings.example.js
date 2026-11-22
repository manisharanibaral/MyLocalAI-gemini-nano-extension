// Firebase settings for the firebase-hybrid edition — EXAMPLE with placeholders.
//
// 1. Copy this file to firebase-settings.local.js (git-ignored; never commit it).
// 2. Fill in your web app config: Firebase console → Project settings → Your apps → Web app.
//    Enable Firebase AI Logic with the Gemini Developer API in that project.
// 3. node scripts/build.mjs firebase-hybrid   (copies the local file into dist/ when present)
//
// firebase-backend.js loads the local file at runtime and refuses values starting with "YOUR_".
window.MYLOCALAI_FIREBASE = {
  config: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
  },

  // App Check (required by Firebase AI Logic). Chrome extensions can't use reCAPTCHA, so the
  // extension uses a debug token you register in Firebase console → Security → App Check →
  // Apps → Manage debug tokens. Leave "" to let the SDK generate one: it is printed once in the
  // side panel's DevTools console ("App Check debug token: …"). Treat the token as a secret.
  appCheckDebugToken: "",
};
