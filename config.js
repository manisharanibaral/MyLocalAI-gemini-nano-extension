/**
 * MyLocalAI — edition config.
 *
 * Which AI backends this build may use, in priority order:
 *   "nano"   → Gemini Nano (Chrome's built-in Prompt API)
 *   "ollama" → Ollama REST API on localhost
 *   "firebase" → Firebase AI Logic hybrid inference (firebase-backend.js): Gemini Nano
 *                on-device, opt-in cloud Gemini fallback. The firebase-hybrid edition gets
 *                { edition: "firebase-hybrid", backends: ["firebase"] } from scripts/build.mjs.
 *
 * This root copy is the "mixed" edition. `node scripts/build.mjs` writes a
 * different config.js into each folder under dist/.
 */
window.MYLOCALAI_CONFIG = {
  edition: "mixed",
  backends: ["nano", "ollama"],
};
