#!/usr/bin/env node
/**
 * Checks the Firebase setup of the firebase-hybrid edition from the command line, without a browser.
 *
 *   node scripts/firebase-diagnose.mjs
 *
 * Calls the same three endpoints the extension's SDK calls, with the values in the git-ignored
 * firebase-settings.local.js:
 *   1. App Check  exchangeDebugToken  — fails (403) when the debug token is not registered for
 *      this exact app ID, or the API key may not call the App Check API.
 *   2. Installations  create           — Remote Config needs an installation ID first.
 *   3. Remote Config  fetch            — shows which model names the console serves right now.
 * It prints status codes and Google's error text only; the API key and the debug token are
 * replaced by "<redacted>" in everything it prints, because the debug token is a secret.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import vm from "node:vm";

const SETTINGS_FILE = new URL("../firebase-settings.local.js", import.meta.url);

function loadSettings() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(SETTINGS_FILE, "utf8"), sandbox);
  return sandbox.window.MYLOCALAI_FIREBASE || {};
}

// Hides every secret value in text that is about to be printed.
function makeRedactor(secrets) {
  const values = secrets.filter((value) => typeof value === "string" && value.length > 0);
  return (text) => values.reduce((out, value) => out.split(value).join("<redacted>"), String(text));
}

// A Firebase installation ID: 22 chars of base64url whose first 4 bits are 0111 (the SDK's format).
function newInstallationId() {
  const bytes = randomBytes(17);
  bytes[0] = 0b01110000 + (bytes[0] % 0b00010000);
  return bytes.toString("base64url").slice(0, 22);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not JSON: keep the text */ }
  return { status: response.status, json, text };
}

function errorText(result) {
  return result.json?.error ? `${result.json.error.status || ""} ${result.json.error.message || ""}`.trim() : result.text.slice(0, 300);
}

// A side panel's requests carry its chrome-extension:// origin; Node's carry none. An API key
// restricted to websites (HTTP referrers) passes the second and rejects the first with 403,
// so App Check is asked both ways. The extension ID only needs to look real. Only Origin is sent:
// with a Referer too, Google answers 400 "Origin and Referer header don't match" for some forms.
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

async function checkAppCheck({ config, appCheckDebugToken }, print) {
  if (typeof appCheckDebugToken !== "string" || !appCheckDebugToken.trim()) {
    print("App Check     SKIPPED: no appCheckDebugToken in firebase-settings.local.js (the SDK makes a new one each install)");
    return;
  }
  const url = `https://content-firebaseappcheck.googleapis.com/v1/projects/${config.projectId}/apps/${config.appId}:exchangeDebugToken?key=${config.apiKey}`;
  const body = { debug_token: appCheckDebugToken.trim() };
  const plain = await postJson(url, body);
  print(plain.status === 200
    ? "App Check     OK: the debug token is registered for this app"
    : `App Check     FAILED ${plain.status}: ${errorText(plain)}`);
  const fromExtension = await postJson(url, body, { Origin: EXTENSION_ORIGIN });
  print(fromExtension.status === 200
    ? "App Check     OK as the extension page (chrome-extension:// origin)"
    : `App Check     FAILED ${fromExtension.status} as the extension page: ${errorText(fromExtension)}`);
}

async function createInstallation(config, print) {
  const url = `https://firebaseinstallations.googleapis.com/v1/projects/${config.projectId}/installations`;
  const fid = newInstallationId();
  const result = await postJson(url, { fid, authVersion: "FIS_v2", appId: config.appId, sdkVersion: "w:diagnose" }, { "x-goog-api-key": config.apiKey });
  if (result.status !== 200) {
    print(`Installations FAILED ${result.status}: ${errorText(result)}`);
    return null;
  }
  print("Installations OK");
  return { fid: result.json.fid || fid, token: result.json.authToken?.token };
}

async function checkRemoteConfig(config, installation, print) {
  const url = `https://firebaseremoteconfig.googleapis.com/v1/projects/${config.projectId}/namespaces/firebase:fetch?key=${config.apiKey}`;
  const result = await postJson(url, {
    sdk_version: "diagnose", app_instance_id: installation.fid, app_instance_id_token: installation.token, app_id: config.appId,
  });
  if (result.status !== 200) {
    print(`Remote Config FAILED ${result.status}: ${errorText(result)}`);
    return;
  }
  print(`Remote Config OK (state ${result.json.state}, template v${result.json.templateVersion}): ${JSON.stringify(result.json.entries || {})}`);
}

// Real-time Remote Config (onConfigUpdate): the stream the panel keeps open so a console change
// reaches it without waiting for the fetch interval. Reads the first message, then hangs up.
// Same headers and body as the SDK's establishRealtimeConnection.
const REALTIME_READ_TIMEOUT_MS = 10000;

async function checkRealtime(config, installation, print) {
  const url = `https://firebaseremoteconfigrealtime.googleapis.com/v1/projects/${config.projectId}/namespaces/firebase:streamFetchInvalidations?key=${config.apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REALTIME_READ_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-Goog-Api-Key": config.apiKey,
        "X-Goog-Firebase-Installations-Auth": installation.token,
        "Content-Type": "application/json",
        Accept: "application/json",
        "If-None-Match": "*",
      },
      body: JSON.stringify({
        project: config.projectId, namespace: "firebase", lastKnownVersionNumber: "0",
        appId: config.appId, sdkVersion: "diagnose", appInstanceId: installation.fid,
      }),
    });
    if (response.status !== 200) {
      print(`Realtime RC   FAILED ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return;
    }
    const { value } = await response.body.getReader().read();
    print(`Realtime RC   OK: ${new TextDecoder().decode(value).replace(/\s+/g, " ").slice(0, 200)}`);
  } catch (e) {
    print(`Realtime RC   FAILED: ${e.name === "AbortError" ? "no message within 10 s" : e.message}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function main() {
  const settings = loadSettings();
  const config = settings.config || {};
  const redact = makeRedactor([config.apiKey, settings.appCheckDebugToken]);
  const print = (line) => console.log(redact(line));
  print(`Project ${config.projectId} · app ${config.appId}`);
  await checkAppCheck(settings, print);
  const installation = await createInstallation(config, print);
  if (!installation) return;
  await checkRemoteConfig(config, installation, print);
  await checkRealtime(config, installation, print);
}

main().catch((e) => {
  console.error("Diagnosis failed:", e.message);
  process.exitCode = 1;
});
