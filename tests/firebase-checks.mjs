// Static checks for the firebase-hybrid edition (Firebase AI Logic hybrid inference).
// Like the other test files, this never runs the extension in a browser. It does build the
// firebase-hybrid edition and evaluates firebase-backend.js's pure prompt builder in a vm.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { EDITIONS, SHARED_FILES, zipExcludeArgs } from "../scripts/build.mjs";
import { sidebarHtml, sidebarJs, sidebarPaths } from "./helpers/sources.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const exists = (path) => existsSync(new URL(path, root));

const backendJs = read("providers/firebase-backend.js");
const promptJs = read("providers/firebase-prompt.js");
const settingsJs = read("providers/firebase-settings.js");
const routingJs = read("providers/firebase-routing.js");
// firebase-backend.js uses the helpers that sidebar.html loads just before it.
const loadProvider = (sandbox) => {
  for (const helper of [promptJs, settingsJs, routingJs]) vm.runInNewContext(helper, sandbox);
  vm.runInNewContext(backendJs, sandbox);
  return sandbox.window.MYLOCALAI_PROVIDERS.firebase;
};

// ===== New files exist; the extension root stays free of package.json =====
for (const file of ["providers/firebase-backend.js", "providers/firebase-settings.js", "providers/firebase-routing.js", "firebase-settings.example.js", "vendor/firebase-ai.js",
  "tools/firebase-bundle/package.json", "tools/firebase-bundle/entry.js", "docs/HACKATHON_RULES.md"]) {
  assert.ok(exists(file), `${file} should exist`);
}
assert.equal(exists("package.json"), false, "the extension root must not get a package.json (CLAUDE.md)");

// ===== Runtime files ship =====
for (const folder of ["providers", "vendor"]) {
  assert.ok(SHARED_FILES.includes(folder), `SHARED_FILES should include ${folder}/`);
}
assert.equal(SHARED_FILES.includes("firebase-settings.local.js"), false, "the local (secret) config must not be a shared file");

// ===== Edition definition =====
const edition = EDITIONS["firebase-hybrid"];
assert.ok(edition, "EDITIONS should define firebase-hybrid");
assert.deepEqual(edition.backends, ["firebase"], "firebase-hybrid uses only the firebase provider (it routes Nano itself)");
assert.deepEqual(edition.optionalFiles, ["firebase-settings.local.js"], "the local config ships only when present");
assert.deepEqual(zipExcludeArgs(edition.optionalFiles), ["-x", "firebase-settings.local.js"],
  "the zip leaves out the local config, which holds the App Check debug token");
assert.deepEqual(zipExcludeArgs([]), [], "editions without local files zip everything");
assert.match(read(".mcp.json"), /"firebase-tools@\d+\.\d+\.\d+"/, "the Firebase MCP tool runs a pinned version, not @latest");
assert.match(edition.manifest.name, /Firebase/, "the edition needs its own name");
assert.equal(/zero cloud/i.test(edition.manifest.description), false, "the description must not claim zero cloud");
assert.ok(edition.manifest.description.length <= 132, "Chrome limits descriptions to 132 characters");
const FIREBASE_HOSTS = ["https://firebasevertexai.googleapis.com/*", "https://firebaseremoteconfig.googleapis.com/*",
  "https://firebaseremoteconfigrealtime.googleapis.com/*", "https://firebaseinstallations.googleapis.com/*"];
assert.deepEqual(edition.manifest.host_permissions, FIREBASE_HOSTS,
  "only Firebase AI Logic and Remote Config (its live stream, and the Installations API it needs) get host access");
assert.ok(Number(edition.manifest.minimum_chrome_version) >= 139, "hybrid on-device inference needs Chrome 139+");

// ===== Build output =====
// With the zip tool installed, also build and inspect the zip that would be shared or uploaded.
const canZip = (() => {
  try { execFileSync("zip", ["-v"], { stdio: "ignore" }); execFileSync("unzip", ["-v"], { stdio: "ignore" }); return true; } catch (_) { return false; }
})();
execFileSync(process.execPath, ["scripts/build.mjs", "firebase-hybrid", ...(canZip ? ["--zip"] : [])], { cwd: root, stdio: "ignore" });
const dist = "dist/mylocalai-firebase-hybrid/";
if (canZip) {
  const listing = execFileSync("unzip", ["-l", "dist/mylocalai-firebase-hybrid.zip"], { cwd: root, encoding: "utf8" });
  assert.match(listing, /manifest\.json/, "the zip holds the edition");
  assert.equal(listing.includes("firebase-settings.local.js"), false, "the zip never holds the local config (App Check debug token)");
} else {
  console.warn("! zip/unzip not installed: the zip contents were not checked");
}
for (const file of ["providers/firebase-backend.js", "providers/firebase-prompt.js", "providers/firebase-settings.js",
  "providers/firebase-routing.js", "vendor/firebase-ai.js", "sidebar.html", ...sidebarPaths, "config.js", "manifest.json"]) {
  assert.ok(exists(`${dist}${file}`), `dist should ship ${file}`);
}
{
  const sandbox = { window: {} };
  vm.runInNewContext(read(`${dist}config.js`), sandbox);
  const config = JSON.parse(JSON.stringify(sandbox.window.MYLOCALAI_CONFIG));
  assert.deepEqual(config, { edition: "firebase-hybrid", backends: ["firebase"] }, "generated config.js");
  const manifest = JSON.parse(read(`${dist}manifest.json`));
  assert.deepEqual(manifest.host_permissions, FIREBASE_HOSTS, "built manifest host access");
  assert.equal(manifest.minimum_chrome_version, "139");
  assert.equal(/zero cloud/i.test(manifest.description), false, "built description must not claim zero cloud");
  const scriptPolicy = /script-src ([^;]*)/.exec(manifest.content_security_policy?.extension_pages ?? "script-src 'self'")[1];
  assert.equal(scriptPolicy.trim(), "'self' 'wasm-unsafe-eval'", "keep MV3's default script policy (no remote code)");
}

// ===== Secrets stay out of git =====
assert.match(read(".gitignore"), /^firebase-settings\.local\.js$/m, ".gitignore must list firebase-settings.local.js");
{
  const sandbox = { window: {} };
  vm.runInNewContext(read("firebase-settings.example.js"), sandbox);
  const example = sandbox.window.MYLOCALAI_FIREBASE;
  for (const [key, value] of Object.entries(example.config)) {
    assert.match(value, /YOUR_/, `example config ${key} must be a placeholder`);
  }
  assert.equal(example.appCheckDebugToken, "", "the example must not carry an App Check debug token");
}

// ===== docs/remoteconfig.template.json matches what the extension reads =====
// The file is imported into the Firebase console (Remote Config → Publish from a file), so a
// renamed parameter or a typo would silently leave the built-in names in use.
{
  const template = JSON.parse(read("docs/remoteconfig.template.json"));
  const { PARAMS } = (() => { const s = { window: {} }; vm.runInNewContext(read("providers/firebase-remote-config.js"), s); return s.window.MyLocalAIFirebaseRemoteConfig; })();
  const { CLOUD_MODELS } = (() => { const s = { window: {} }; vm.runInNewContext(settingsJs, s); return s.window.MyLocalAIFirebaseSettings; })();
  assert.deepEqual(Object.keys(template.parameters).sort(), Object.values(PARAMS).sort(),
    "the template has exactly the parameters firebase-remote-config.js reads");
  for (const [key, param] of Object.entries(PARAMS)) {
    const entry = template.parameters[param];
    assert.equal(entry.valueType, "STRING", `${param} is a string parameter`);
    assert.equal(entry.defaultValue.value, CLOUD_MODELS[key].id, `${param} matches the built-in free-tier model`);
  }
}

// ===== First launch asks "Private only" or "Hybrid" before Firebase loads =====
{
  const html = read("sidebar.html");
  for (const id of ["firebase-launch-choice", "btn-launch-private", "btn-launch-hybrid"]) {
    assert.ok(html.includes(`id="${id}"`), `sidebar.html should have #${id} for the first-launch question`);
  }
  assert.match(html, /Private only \(Nano\)/);
  assert.match(html, /Hybrid \(Nano, then cloud if needed\)/);
  const initBody = backendJs.slice(backendJs.indexOf("async function init("));
  const asked = initBody.indexOf("await askLaunchChoice()");
  assert.ok(asked > 0, "init() waits for the first-launch choice");
  assert.ok(asked < initBody.indexOf("await ensureFirebaseServices()"), "the choice comes before Firebase is loaded");
}

// ===== Firebase AI Logic is imported and actually called at runtime =====
const entryJs = read("tools/firebase-bundle/entry.js");
assert.match(entryJs, /from "firebase\/ai"/, "the bundle imports firebase/ai");
assert.match(entryJs, /from "firebase\/app-check"/, "the bundle imports firebase/app-check");
assert.match(entryJs, /from "firebase\/remote-config"/, "the bundle imports firebase/remote-config");
const bundle = read("vendor/firebase-ai.js");
assert.match(bundle, /MyLocalAIFirebase/, "the bundle exposes window.MyLocalAIFirebase");
assert.match(bundle, /firebasevertexai\.googleapis\.com/, "the bundled SDK calls the Firebase AI Logic endpoint");
assert.match(bundle, /firebaseremoteconfig\.googleapis\.com/, "the bundled SDK includes Remote Config");
{
  const remoteConfigJs = read("providers/firebase-remote-config.js");
  for (const call of ["sdk.getRemoteConfig(", "sdk.fetchAndActivate(", "sdk.getValue(", "sdk.onConfigUpdate(", "sdk.activate("]) {
    assert.ok(remoteConfigJs.includes(call), `firebase-remote-config.js should call ${call}`);
  }
  // Without these exports the live watcher would throw "sdk.onConfigUpdate is not a function".
  assert.match(entryJs, /onConfigUpdate,\s*\n\s*activate,/, "the bundle exposes onConfigUpdate and activate");
  assert.match(bundle, /firebaseremoteconfigrealtime\.googleapis\.com/, "the bundled SDK includes real-time Remote Config");
}
for (const call of ["sdk.initializeApp(", "sdk.getAI(", "new sdk.GoogleAIBackend()", "sdk.getGenerativeModel(",
  ".generateContentStream(", "sdk.initializeAppCheck(", ".initializeDeviceModel("]) {
  assert.ok(backendJs.includes(call), `firebase-backend.js should call ${call}`);
}
assert.match(backendJs, /inCloudParams:/, "cloud options use the documented inCloudParams key");
// The SDK's InferenceSource values are "on_device"/"in_cloud", not the key names (found in a browser run).
assert.equal(/=== "ON_DEVICE"|=== "IN_CLOUD"/.test(backendJs), false, "compare inference sources with sdk.InferenceSource");
assert.match(backendJs, /sdk\.InferenceSource\.ON_DEVICE/, "the footer label must use the SDK constant");
assert.match(backendJs, /onDeviceParams:/, "on-device options use the documented onDeviceParams key");

// ===== App Check stays enabled =====
assert.match(backendJs, /FIREBASE_APPCHECK_DEBUG_TOKEN = /, "App Check uses a debug token in the extension");
assert.equal(/FIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*false/.test(backendJs), false, "App Check must not be disabled");

// ===== Models: free-tier only =====
assert.match(settingsJs, /id: "gemini-3\.5-flash-lite"/, "fast cloud model");
assert.match(settingsJs, /id: "gemini-4-hydrogen"/, "frontier cloud model");
for (const source of [backendJs, settingsJs, sidebarHtml]) {
  assert.equal(/gemini-2\.5|gemini-4-(neon|carbon|argon)|imagen|gemini-[\w.-]*image/i.test(source), false,
    "no paid (Blaze), retiring or image models");
}

// ===== Cloud is opt-in, off by default, and labelled =====
assert.match(settingsJs, /const DEFAULT_ROUTE = "device";/, "the default route must be on-device only");
assert.match(settingsJs, /device: \{ mode: "ONLY_ON_DEVICE", usesCloud: false/, "the device route never uses the cloud");
assert.match(sidebarHtml, /<select id="firebase-route"[^>]*>\s*<option value="device">On-device only \(default, private\)/,
  "the first (default) route option is on-device only");
assert.match(sidebarHtml, /<section id="firebase-settings" class="settings-card hidden"/, "the Firebase card is hidden outside this edition");
assert.match(sidebarHtml, /Cloud options send your messages/, "the settings explain what the cloud route sends");
assert.match(sidebarHtml, /id="firebase-cloud-optin" class="status-optin hidden"[\s\S]*Sends your messages to Google/,
  "the overlay opt-in explains what it sends");

// ===== sidebar/ only has the generic provider hook =====
for (const forbidden of ["MyLocalAIFirebase", "getGenerativeModel", "firebase/", '=== "firebase"', "edition ==="]) {
  assert.equal(sidebarJs.includes(forbidden), false, `sidebar/ must not contain ${forbidden}`);
}
assert.match(sidebarJs, /function streamProvider\(/, "the provider hook sits next to the other stream functions");
assert.ok(sidebarJs.indexOf("function streamOllama(") < sidebarJs.indexOf("function streamProvider("), "hook placement");
{
  const configTag = sidebarHtml.indexOf('src="config.js"');
  const backendTag = sidebarHtml.indexOf('src="providers/firebase-backend.js"');
  const sidebarTag = sidebarHtml.indexOf('src="sidebar/');
  assert.ok(configTag < backendTag && backendTag < sidebarTag, "firebase-backend.js loads after config.js, before the sidebar scripts");
  for (const helper of ["firebase-prompt", "firebase-settings", "firebase-routing"]) {
    const tag = sidebarHtml.indexOf(`src="providers/${helper}.js"`);
    assert.ok(tag > configTag && tag < backendTag, `${helper}.js loads before firebase-backend.js, which reads it at load time`);
  }
  assert.equal(sidebarHtml.includes('src="vendor/firebase-ai.js"'), false, "the SDK is loaded lazily, never in other editions");
}

// ===== Provider interface and the multi-turn → single-prompt builder =====
{
  const sandbox = { window: {}, console };
  loadProvider(sandbox);
  const provider = sandbox.window.MYLOCALAI_PROVIDERS.firebase;
  for (const method of ["init", "stream", "generateJson", "unload", "describe", "supportsImages", "statusLine", "errorTitle", "helpLines", "bindSettingsUI",
    "listModels", "selectModel"]) {
    assert.equal(typeof provider[method], "function", `provider.${method} should exist`);
  }
  assert.equal(provider.id, "firebase");

  // Each side of the hybrid model is told which model it is (firebase-prompt.js).
  const { withCloudIdentity, withDeviceIdentity } = sandbox.window.MyLocalAIFirebasePrompt;
  assert.match(withCloudIdentity("Be brief.", "gemini-3.5-flash-lite"),
    /^Be brief\.\n\nAbout you: .*the model answering is gemini-3\.5-flash-lite, a Google Gemini model running in Google's cloud through Firebase AI Logic\./);
  assert.match(withDeviceIdentity("Be brief."), /^Be brief\.\n\nAbout you: .*the model answering is Google's on-device model built into Chrome, run through Firebase AI Logic/);
  assert.match(withDeviceIdentity(""), /^About you:/, "an empty prompt leaves just the identity line");

  const build = provider.buildConversationPrompt;
  assert.equal(build([{ role: "user", content: "Hi" }]), "Hi", "a first message is sent as-is");

  const twoTurns = build([
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "And times 3?", images: ["aGVsbG8="] },
  ]);
  assert.match(twoTurns, /User: What is 2\+2\?\nAssistant: 4/, "earlier turns are folded into the prompt");
  assert.match(twoTurns, /latest message:\nAnd times 3\?$/, "the current message comes last");
  assert.equal(twoTurns.includes("aGVsbG8="), false, "image data never goes into the text prompt");

  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  long.push({ role: "user", content: "now" });
  const kept = build(long).split("\n").filter((line) => /^(User|Assistant): /.test(line));
  assert.equal(kept.length, 20, "only the last 20 earlier messages are kept (where the panel compacts a chat)");
  assert.equal(kept.at(-1), "Assistant: m29", "the newest earlier turns are the ones kept");

  // A compacted chat: the summary always goes in, before the turns; compacted turns never do.
  const compacted = build([
    { role: "user", content: "old question", compacted: true },
    { role: "assistant", content: "old answer", compacted: true },
    { role: "summary", content: "- The user is planning a trip to Goa." },
    { role: "user", content: "x".repeat(20000) },
    { role: "assistant", content: "ok" },
    { role: "user", content: "Which beach?" },
  ]);
  assert.match(compacted, /^Summary of the earlier conversation:\n- The user is planning a trip to Goa\.\n/, "the summary comes first");
  assert.equal(compacted.includes("old question"), false, "compacted messages are not sent again");
  assert.match(compacted, /Assistant: ok\n\nReply to the user's latest message:\nWhich beach\?$/);
  assert.match(build([{ role: "summary", content: "- s" }, { role: "user", content: "q" }]),
    /^Summary of the earlier conversation:\n- s\n\nReply to the user's latest message:\nq$/, "a summary with no other turns still goes in");

  const huge = [{ role: "user", content: "x".repeat(20000) }, { role: "assistant", content: "ok" }, { role: "user", content: "q" }];
  assert.equal(build(huge).includes("x".repeat(100)), false, "turns past the character budget are dropped");
}

// ===== Per-request routing (providers/firebase-routing.js) =====
{
  const sandbox = { window: {} };
  vm.runInNewContext(routingJs, sandbox);
  const routing = sandbox.window.MyLocalAIFirebaseRouting;
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const short = { promptText: "Hi", systemPrompt: "Be brief." };
  const long = { promptText: "x".repeat(30000), systemPrompt: "Be brief." };
  for (const mode of ["ONLY_ON_DEVICE", "PREFER_ON_DEVICE", "PREFER_IN_CLOUD"]) {
    assert.deepEqual(plain(routing.chooseRequestMode({ mode }, short)), { mode, reason: "" }, `a short prompt keeps ${mode}`);
  }
  assert.deepEqual(plain(routing.chooseRequestMode({ mode: "PREFER_ON_DEVICE" }, long)), { mode: "ONLY_IN_CLOUD", reason: "too-long" });
  assert.deepEqual(plain(routing.chooseRequestMode({ mode: "ONLY_ON_DEVICE" }, long)), { mode: "ONLY_ON_DEVICE", reason: "too-long-no-cloud" },
    "on-device only never switches to the cloud");
  assert.deepEqual(plain(routing.chooseRequestMode({ mode: "PREFER_IN_CLOUD" }, long)), { mode: "PREFER_IN_CLOUD", reason: "" });
  assert.equal(routing.ON_DEVICE_CONTEXT_TOKENS, 9216, "Gemini Nano's documented on-device limit");
  assert.ok(routing.estimateTokens("abcd".repeat(300)) >= 300, "the estimate never undercounts English (~4 chars/token)");
  // The system prompt counts too: a prompt that fits alone can overflow with a long one.
  const nearLimit = { promptText: "x".repeat(20000), systemPrompt: "" };
  assert.equal(routing.chooseRequestMode({ mode: "PREFER_ON_DEVICE" }, nearLimit).reason, "");
  assert.equal(routing.chooseRequestMode({ mode: "PREFER_ON_DEVICE" }, { ...nearLimit, systemPrompt: "s".repeat(4000) }).reason, "too-long");

  const schema = {
    type: "object",
    properties: { tags: { type: "array", items: { type: "string", maxLength: 9 } }, kind: { type: "string", enum: ["a", "b"] } },
    required: ["kind"],
    additionalProperties: false,
  };
  assert.deepEqual(plain(routing.toCloudSchema(schema)), {
    type: "object",
    properties: { tags: { type: "array", items: { type: "string" } }, kind: { type: "string", enum: ["a", "b"] } },
    required: ["kind"],
  }, "the cloud schema drops unsupported keywords at every level");
  const output = routing.structuredOutputParams(schema);
  assert.equal(output.devicePromptOptions.responseConstraint, schema, "Nano gets the schema unchanged");
  assert.equal(output.cloudGenerationConfig.responseMimeType, "application/json");
  assert.equal(schema.additionalProperties, false, "the caller's schema is not modified");

  assert.equal(routing.describeAnswerSource({ onDevice: true }).kind, "device");
  // "Cloud first" answering on the device means the SDK swallowed a cloud error.
  assert.equal(routing.reasonAfterAnswer({ mode: "PREFER_IN_CLOUD", reason: "" }, true), "cloud-failed");
  assert.equal(routing.reasonAfterAnswer({ mode: "PREFER_IN_CLOUD", reason: "" }, false), "");
  assert.equal(routing.reasonAfterAnswer({ mode: "PREFER_ON_DEVICE", reason: "" }, true), "", "on-device first on the device is normal");
  assert.equal(routing.reasonAfterAnswer({ mode: "ONLY_IN_CLOUD", reason: "too-long" }, false), "too-long");
  const failed = routing.describeAnswerSource({ onDevice: true, cloudModelId: "m", reason: "cloud-failed" });
  assert.equal(failed.kind, "device");
  assert.match(failed.label, /cloud failed/);
  assert.match(failed.title, /request to m failed/);
  assert.match(routing.describeAnswerSource({ onDevice: false, cloudModelId: "m", reason: "" }).label, /^☁️ Cloud · m$/);
}
assert.match(backendJs, /\.generateContent\(prompt/, "structured output calls Firebase AI Logic's generateContent");

// ===== "Answer length": the cloud route gets maxOutputTokens only when there is a cap =====
{
  const sandbox = { window: {}, console };
  loadProvider(sandbox);
  const { cloudGenerationConfig } = sandbox.window.MYLOCALAI_PROVIDERS.firebase;
  assert.deepEqual({ ...cloudGenerationConfig({ temperature: 0.5, topK: 3, maxOutputTokens: 400 }) },
    { temperature: 0.5, topK: 3, maxOutputTokens: 400 }, "Short/Normal cap the paid cloud answer");
  assert.equal("maxOutputTokens" in cloudGenerationConfig({ temperature: 0.5, topK: 3, maxOutputTokens: null }), false,
    "Long leaves the model's own limit");
  assert.match(backendJs, /inCloudParams: \{[\s\S]*generationConfig: cloudGenerationConfig\(settings\)/, "the cloud params use it");
}

// ===== Prompt-bar model switcher: the provider lists its models and applies a choice =====
{
  const stored = new Map();
  const routeSelect = { value: "", disabled: false };
  const modelSelect = { value: "", disabled: false };
  const sandbox = {
    window: {},
    console,
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    document: { getElementById: (id) => ({ "firebase-route": routeSelect, "firebase-cloud-model": modelSelect })[id] ?? null },
  };
  loadProvider(sandbox);
  const provider = sandbox.window.MYLOCALAI_PROVIDERS.firebase;

  let listing = provider.listModels();
  assert.deepEqual([...listing.options.map((o) => o.id)], ["device", "cloud:fast", "cloud:frontier"], "on-device plus both cloud models");
  assert.equal(listing.currentId, "device", "the default is on-device only");
  assert.equal(listing.options[0].label, "Gemini Nano");
  for (const cloud of listing.options.slice(1)) {
    assert.match(cloud.detail, /☁️ Cloud/, "cloud choices are marked as cloud");
    assert.match(cloud.detail, /sends messages to Google/, "cloud choices say what leaves the device");
  }
  assert.deepEqual([...listing.options.slice(1).map((o) => o.label)], ["gemini-3.5-flash-lite", "gemini-4-hydrogen"], "free-tier models only");

  provider.selectModel("cloud:frontier");
  assert.equal(stored.get("firebaseRoute"), "prefer-cloud", "picking a cloud model is an explicit cloud opt-in");
  assert.equal(stored.get("firebaseCloudModel"), "frontier");
  assert.equal(provider.listModels().currentId, "cloud:frontier");
  assert.equal(routeSelect.value, "prefer-cloud", "the settings card follows the switcher");
  assert.equal(modelSelect.value, "frontier");
  assert.equal(modelSelect.disabled, false, "the cloud model select is usable on a cloud route");

  provider.selectModel("device");
  assert.equal(stored.get("firebaseRoute"), "device", "choosing Gemini Nano goes back to on-device only");
  assert.equal(provider.listModels().currentId, "device");
  assert.equal(routeSelect.value, "device");
  assert.equal(modelSelect.disabled, true, "no cloud model to pick on the device route");

  stored.set("firebaseRoute", "prefer-device");
  listing = provider.listModels();
  assert.equal(listing.currentId, "device", "device-first still counts as the Gemini Nano choice");
  assert.match(listing.options[0].detail, /cloud fallback on/, "…and the menu says the fallback is on");

  const before = new Map(stored);
  assert.throws(() => provider.selectModel("cloud:bogus"), /Unknown model/);
  assert.throws(() => provider.selectModel("nonsense"), /Unknown model/);
  assert.deepEqual([...stored], [...before], "an unknown model changes nothing");
}

// ===== "Cloud & internet" switch: off means on-device only, whatever was chosen before =====
{
  const stored = new Map([["firebaseRoute", "prefer-cloud"], ["firebaseCloudModel", "frontier"]]);
  const routeSelect = { value: "", disabled: false, addEventListener() { } };
  const modelSelect = { value: "", disabled: false, addEventListener() { } };
  const cloudSwitch = { checked: true, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const card = { classList: { remove() { } } };
  const elements = { "firebase-settings": card, "firebase-route": routeSelect, "firebase-cloud-model": modelSelect, "firebase-cloud-switch": cloudSwitch };
  const sandbox = {
    window: {},
    console,
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    document: { getElementById: (id) => elements[id] ?? null },
  };
  const provider = loadProvider(sandbox);
  assert.equal(provider.isCloudAllowed(), true, "the switch is on by default, so existing choices keep working");

  let restarts = 0;
  provider.bindSettingsUI({ onSettingsChanged: () => { restarts += 1; } });
  cloudSwitch.checked = false;
  cloudSwitch.listeners.change({ target: cloudSwitch });
  assert.equal(stored.get("firebaseCloudSwitch"), "off", "the switch is saved");
  assert.equal(restarts, 1, "turning it off rebuilds the model at once");
  assert.equal(provider.isCloudAllowed(), false);
  assert.deepEqual([...provider.listModels().options.map((o) => o.id)], ["device"], "no cloud model is offered");
  assert.equal(provider.listModels().currentId, "device", "a saved cloud route is overridden");
  assert.throws(() => provider.selectModel("cloud:fast"), /Cloud & internet is off/, "cloud models can't be picked");
  assert.equal(routeSelect.value, "device", "the settings show the route in effect");
  assert.equal(routeSelect.disabled, true, "and can't be changed while off");
  assert.equal(modelSelect.disabled, true);
  assert.equal(provider.describe().usesCloud, false, "the sidebar may now say answers stay on the device");
  assert.equal(provider.describe().badge, "Firebase Hybrid", "the header keeps one short name; the route shows in the hint");
  assert.equal(stored.get("firebaseRoute"), "prefer-cloud", "the earlier choice is remembered for when it's turned on");

  cloudSwitch.checked = true;
  cloudSwitch.listeners.change({ target: cloudSwitch });
  assert.equal(provider.listModels().currentId, "cloud:frontier", "turning it on restores the earlier choice");
  assert.equal(routeSelect.disabled, false);
  assert.equal(restarts, 2);
}
assert.match(sidebarHtml, /<input id="firebase-cloud-switch" type="checkbox" role="switch" checked \/>/,
  "the switch is a real, labelled checkbox");
assert.match(sidebarJs, /bindSettingsUI\?\.\(\{ onSettingsChanged: reloadExternalProvider \}\)/,
  "the sidebar applies the switch without Apply & Restart");

// ===== Pre-commit runs this file too =====
assert.match(read(".githooks/pre-commit"), /node tests\/firebase-checks\.mjs/, "the pre-commit hook should run firebase checks");

console.log("Firebase checks passed");
