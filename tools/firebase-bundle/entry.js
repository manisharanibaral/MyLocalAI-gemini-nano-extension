// Bundled into ../../vendor/firebase-ai.js by `npm run build` (esbuild, IIFE).
// Chrome extension pages may not load remote scripts, so the SDK ships inside the extension.
// firebase-backend.js reads everything from window.MyLocalAIFirebase.
import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from "firebase/ai";
// App Check is required by Firebase AI Logic. reCAPTCHA cannot run in an extension page
// (it is a remote script), so firebase-backend.js uses a registered debug token plus a
// CustomProvider placeholder; see README "Firebase hybrid edition → App Check".
import { initializeAppCheck, CustomProvider } from "firebase/app-check";

window.MyLocalAIFirebase = {
  initializeApp,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  initializeAppCheck,
  CustomProvider,
};
