/**
 * MyLocalAI — Firebase AI Logic hybrid backend.
 *
 * Registers the "firebase" provider in window.MYLOCALAI_PROVIDERS. The sidebar only talks to it
 * through that interface (init / stream / describe…), so the Nano and Ollama code is untouched.
 *
 * Hybrid inference (Firebase AI Logic Web SDK, bundled in vendor/firebase-ai.js):
 *   - On-device: Gemini Nano through Chrome's Prompt API, driven by the Firebase SDK.
 *   - Cloud: Gemini Developer API through the Firebase AI Logic proxy
 *     (firebasevertexai.googleapis.com), protected by App Check.
 * Cloud is OPT-IN: the default route is on-device only, which never sends chat text anywhere.
 *
 * Nothing here runs unless the edition's config.js lists "firebase" in `backends`; the SDK and
 * the git-ignored firebase-settings.local.js are loaded lazily by init().
 */
(() => {
  "use strict";

  // ===================== CONSTANTS =====================
  const SDK_PATH = "vendor/firebase-ai.js";
  const SETTINGS_PATH = "firebase-settings.local.js";

  // Free-tier cloud models only (hackathon constraint: no Blaze-plan or retiring models).
  const CLOUD_MODELS = {
    fast: { id: "gemini-3.5-flash-lite", label: "Fast · gemini-3.5-flash-lite" },
    frontier: { id: "gemini-4-hydrogen", label: "Frontier · gemini-4-hydrogen" },
  };
  const DEFAULT_CLOUD_MODEL = "fast";

  // Where answers run. "device" is the default and the only route that keeps chat text local.
  const ROUTES = {
    device: { mode: "ONLY_ON_DEVICE", usesCloud: false, badge: "On-device only" },
    "prefer-device": { mode: "PREFER_ON_DEVICE", usesCloud: true, badge: "On-device · cloud fallback" },
    "prefer-cloud": { mode: "PREFER_IN_CLOUD", usesCloud: true, badge: "Cloud first · on-device fallback" },
  };
  const DEFAULT_ROUTE = "device";

  // Firebase on-device inference is single-turn, so earlier turns are folded into one prompt.
  // On-device Gemini Nano accepts about 9k tokens; ~12k characters of history (~3k tokens)
  // leaves room for the system prompt, page context and the answer.
  const MAX_HISTORY_MESSAGES = 10;
  const MAX_HISTORY_CHARS = 12000;

  const STORAGE_KEYS = { route: "firebaseRoute", cloudModel: "firebaseCloudModel" };

  const TEXT_IO = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
  const VISION_IO = {
    expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  };

  // ===================== STATE =====================
  let firebaseServices = null;      // { sdk, ai } — created once per page (App Check can't be re-initialized)
  let deviceModel = { status: "unknown", vision: false, limits: null };
  let cachedModel = null;           // { key, model } — reused so the SDK keeps a single on-device session
  let answerQueue = Promise.resolve();
  let lastInferenceSource = "";     // an sdk.InferenceSource value, for the footer label
  let lastSetupError = "";
  let settingsBound = false;        // applyEditionUI runs on every restart; bind listeners once

  // ===================== SETTINGS (owned by this file) =====================
  const $ = (id) => document.getElementById(id);

  function readStored(key, allowed, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value !== null && Object.hasOwn(allowed, value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function storeSetting(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { console.warn("[MyLocalAI] Could not save Firebase setting", e); }
  }

  function currentRoute() { return readStored(STORAGE_KEYS.route, ROUTES, DEFAULT_ROUTE); }
  function currentCloudModel() { return readStored(STORAGE_KEYS.cloudModel, CLOUD_MODELS, DEFAULT_CLOUD_MODEL); }

  // Fills and wires the "Firebase AI Logic" settings card and the overlay's cloud opt-in button.
  function bindSettingsUI() {
    const card = $("firebase-settings");
    const routeSelect = $("firebase-route");
    const modelSelect = $("firebase-cloud-model");
    if (settingsBound || !card || !routeSelect || !modelSelect) return;
    settingsBound = true;
    card.classList.remove("hidden");
    syncSettingsControls();

    // Saved immediately; "Apply & Restart Session" (or Retry) rebuilds the model with them.
    routeSelect.addEventListener("change", () => { storeSetting(STORAGE_KEYS.route, routeSelect.value); syncSettingsControls(); });
    modelSelect.addEventListener("change", () => storeSetting(STORAGE_KEYS.cloudModel, modelSelect.value));

    $("btn-firebase-enable-cloud")?.addEventListener("click", () => {
      // The user explicitly opts in to the cloud fallback from the error overlay.
      storeSetting(STORAGE_KEYS.route, "prefer-device");
      syncSettingsControls();
      setCloudOptInVisible(false);
      $("status-retry-btn")?.click(); // Retry re-runs init() with the new route
    });
  }

  // Shows the stored route/model in the settings card. Also used after the prompt-bar model
  // switcher changes them, so the two never disagree.
  function syncSettingsControls() {
    const routeSelect = $("firebase-route");
    const modelSelect = $("firebase-cloud-model");
    if (!routeSelect || !modelSelect) return;
    routeSelect.value = currentRoute();
    modelSelect.value = currentCloudModel();
    // The cloud model only matters when the route can reach the cloud.
    modelSelect.disabled = !ROUTES[currentRoute()].usesCloud;
  }

  function setCloudOptInVisible(visible) {
    $("firebase-cloud-optin")?.classList.toggle("hidden", !visible);
  }

  // ===================== LOADING =====================
  // Extension pages may only run scripts shipped with the extension; these are local files.
  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = path;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${path}`));
      document.head.appendChild(script);
    });
  }

  async function loadFirebaseSettings() {
    if (!window.MYLOCALAI_FIREBASE) {
      try {
        await loadScript(SETTINGS_PATH);
      } catch (_) {
        throw setupError("FIREBASE_NOT_CONFIGURED");
      }
    }
    const settings = window.MYLOCALAI_FIREBASE || {};
    if (!isRealFirebaseConfig(settings.config)) throw setupError("FIREBASE_NOT_CONFIGURED");
    return settings;
  }

  // The example file ships with "YOUR_…" placeholders; refuse those instead of calling Firebase.
  function isRealFirebaseConfig(config) {
    if (!config) return false;
    return ["apiKey", "projectId", "appId"].every((key) =>
      typeof config[key] === "string" && config[key].trim() && !config[key].startsWith("YOUR_"));
  }

  async function ensureFirebaseServices() {
    if (firebaseServices) return firebaseServices;
    const settings = await loadFirebaseSettings();
    if (!window.MyLocalAIFirebase) await loadScript(SDK_PATH);
    const sdk = window.MyLocalAIFirebase;

    const app = sdk.initializeApp(settings.config);
    initializeAppCheckForExtension(sdk, app, settings.appCheckDebugToken);
    const ai = sdk.getAI(app, { backend: new sdk.GoogleAIBackend() });
    firebaseServices = { sdk, ai };
    return firebaseServices;
  }

  // App Check stays ON (Firebase AI Logic enforces it). Chrome extensions have no web attestation
  // provider: reCAPTCHA is a remote script, which MV3 forbids. So this uses App Check's debug
  // token flow: a token registered in the Firebase console (Security → App Check → Manage debug
  // tokens). With no token configured, the SDK generates one and prints it to the console once.
  // The CustomProvider is never asked for a token while a debug token is set.
  function initializeAppCheckForExtension(sdk, app, debugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = typeof debugToken === "string" && debugToken.trim() ? debugToken.trim() : true;
    sdk.initializeAppCheck(app, {
      provider: new sdk.CustomProvider({
        getToken: () => Promise.reject(new Error("No App Check attestation provider for Chrome extensions; register a debug token.")),
      }),
      // Fetch a token only when a cloud request needs one, so on-device-only use makes no network calls.
      isTokenAutoRefreshEnabled: false,
    });
  }

  // ===================== ON-DEVICE MODEL =====================
  // Same availability check the Firebase SDK runs, done here so the UI can explain what's missing.
  async function checkDeviceModel() {
    if (typeof LanguageModel === "undefined") return { status: "unavailable", vision: false, limits: null };
    try {
      const vision = await LanguageModel.availability(VISION_IO);
      if (vision === "available") return { status: vision, vision: true, limits: await readDeviceLimits() };
      const text = await LanguageModel.availability(TEXT_IO);
      return { status: text, vision: false, limits: text === "available" ? await readDeviceLimits() : null };
    } catch (e) {
      console.warn("[MyLocalAI] LanguageModel.availability failed:", e.message);
      return { status: "unavailable", vision: false, limits: null };
    }
  }

  async function readDeviceLimits() {
    try { return typeof LanguageModel.params === "function" ? await LanguageModel.params() : null; } catch (_) { return null; }
  }

  // Downloading needs a user gesture (Chrome rule, repeated in the Firebase docs). Retry is one.
  async function downloadDeviceModel(settings, showProgress) {
    const model = await getModel(settings);
    showProgress("Downloading Gemini Nano…", "Firebase AI Logic is preparing the on-device model. This can take a while.");
    await model.initializeDeviceModel((loaded) => {
      const pct = Math.round((loaded || 0) * 100);
      showProgress(pct >= 100 ? "Preparing Gemini Nano…" : `Downloading Gemini Nano… ${pct}%`, "Keep this panel open.");
    });
    deviceModel = await checkDeviceModel();
  }

  // With cloud allowed, the first message (a user gesture) can start the download in the
  // background; until it finishes, answers come from the cloud.
  function startBackgroundDownload(settings) {
    if (deviceModel.status !== "downloadable" || !navigator.userActivation?.isActive) return;
    deviceModel.status = "downloading";
    getModel(settings)
      .then((model) => model.initializeDeviceModel())
      .then(checkDeviceModel)
      .then((status) => { deviceModel = status; })
      .catch((e) => console.warn("[MyLocalAI] Background Gemini Nano download failed:", e.message));
  }

  // ===================== MODEL =====================
  // Both routes get the same system prompt and sampling settings, in each side's own format.
  function buildModelParams(settings, routeId, cloudModelId) {
    const { sdk } = firebaseServices;
    return {
      mode: sdk.InferenceMode[ROUTES[routeId].mode],
      inCloudParams: {
        model: CLOUD_MODELS[cloudModelId].id,
        systemInstruction: settings.systemPrompt,
        generationConfig: { temperature: settings.temperature, topK: settings.topK },
      },
      onDeviceParams: {
        createOptions: {
          ...(deviceModel.vision ? VISION_IO : TEXT_IO),
          initialPrompts: [{ role: "system", content: settings.systemPrompt }],
          ...deviceSamplingOptions(settings),
        },
      },
    };
  }

  // Chrome accepts temperature/topK only together and only within its params() limits;
  // without known limits, leave Chrome's defaults rather than risk a failing create().
  function deviceSamplingOptions(settings) {
    const limits = deviceModel.limits;
    if (!limits?.maxTopK || !limits?.maxTemperature) return {};
    return {
      temperature: Math.min(settings.temperature, limits.maxTemperature),
      topK: Math.max(1, Math.min(settings.topK, limits.maxTopK)),
    };
  }

  async function getModel(settings) {
    const { sdk, ai } = await ensureFirebaseServices();
    const params = buildModelParams(settings, currentRoute(), currentCloudModel());
    const key = JSON.stringify(params);
    if (cachedModel?.key !== key) cachedModel = { key, model: sdk.getGenerativeModel(ai, params) };
    return cachedModel.model;
  }

  // ===================== MULTI-TURN → SINGLE PROMPT =====================
  // chatHistory entries are { role: "user"|"assistant", content, images? }. Images are sent
  // separately (buildRequest), never as text. The last entry is the message being answered.
  function buildConversationPrompt(history) {
    const turns = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: String(m.content ?? "").trim() }));
    const current = turns.pop();
    if (!current) return "";
    const earlier = recentTurnsWithinBudget(turns);
    if (earlier.length === 0) return current.text;
    return [
      "Conversation so far (oldest first):",
      ...earlier.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`),
      "",
      "Reply to the user's latest message:",
      current.text,
    ].join("\n");
  }

  // Keeps the newest turns that fit both limits; older turns are dropped first.
  function recentTurnsWithinBudget(turns) {
    const kept = [];
    let chars = 0;
    for (let i = turns.length - 1; i >= 0 && kept.length < MAX_HISTORY_MESSAGES; i--) {
      chars += turns[i].text.length;
      if (chars > MAX_HISTORY_CHARS) break;
      kept.unshift(turns[i]);
    }
    return kept;
  }

  function buildRequest(prompt, images = []) {
    if (images.length === 0) return prompt;
    // Images are re-encoded as JPEG by the sidebar, one of the two types on-device accepts.
    return [prompt, ...images.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }))];
  }

  // ===================== STREAMING =====================
  // The SDK replaces (and destroys) its on-device session on every call, so parallel answers
  // ("Responses at once") would cancel each other. Answers therefore run one after another.
  function stream(args) {
    const run = answerQueue.then(() => streamOnce(args));
    answerQueue = run.catch(() => { });
    return run;
  }

  async function streamOnce({ history, images, signal, onText, settings }) {
    throwIfAborted(signal);
    startBackgroundDownload(settings);
    const model = await getModel(settings);
    const result = await model.generateContentStream(buildRequest(buildConversationPrompt(history), images), { signal });

    let fullText = "";
    for await (const chunk of result.stream) {
      // The on-device stream ignores the signal, so stop reading it ourselves.
      throwIfAborted(signal);
      fullText += chunk.text();
      if (chunk.inferenceSource) lastInferenceSource = chunk.inferenceSource;
      onText(fullText);
    }
    return { content: fullText, reasoning: "" };
  }

  // "Free memory when idle": drop the model so its on-device session can be released.
  // The SDK has no public destroy(); the next answer rebuilds the model (and session) lazily.
  function unload() {
    cachedModel = null;
  }

  // ===================== MODEL SWITCHER (prompt bar) =====================
  // The prompt-bar switcher shows three choices: Gemini Nano on-device, or one of the cloud
  // models. Picking a cloud model is an explicit opt-in to the cloud, so it is labelled ☁️.
  const DEVICE_MODEL_ID = "device";
  const CLOUD_MODEL_ID_PREFIX = "cloud:";

  function currentModelId() {
    return currentRoute() === "prefer-cloud" ? `${CLOUD_MODEL_ID_PREFIX}${currentCloudModel()}` : DEVICE_MODEL_ID;
  }

  // Synchronous: everything comes from settings, no network.
  function listModels() {
    const deviceDetail = currentRoute() === "prefer-device"
      ? "On-device · cloud fallback on"
      : "On-device · private";
    const options = [{ id: DEVICE_MODEL_ID, label: "Gemini Nano", detail: deviceDetail }];
    for (const [key, model] of Object.entries(CLOUD_MODELS)) {
      const tier = key === "fast" ? "Fast" : "Frontier";
      options.push({ id: `${CLOUD_MODEL_ID_PREFIX}${key}`, label: model.id, detail: `☁️ Cloud · ${tier} · sends messages to Google` });
    }
    return { options, currentId: currentModelId() };
  }

  // Stores the choice only; the sidebar then calls init() to rebuild the model with it.
  function selectModel(id) {
    if (id === DEVICE_MODEL_ID) {
      storeSetting(STORAGE_KEYS.route, "device");
    } else if (id.startsWith(CLOUD_MODEL_ID_PREFIX) && Object.hasOwn(CLOUD_MODELS, id.slice(CLOUD_MODEL_ID_PREFIX.length))) {
      storeSetting(STORAGE_KEYS.route, "prefer-cloud");
      storeSetting(STORAGE_KEYS.cloudModel, id.slice(CLOUD_MODEL_ID_PREFIX.length));
    } else {
      throw new Error(`Unknown model: ${id}`);
    }
    syncSettingsControls();
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException("Generation stopped", "AbortError");
  }

  // ===================== INIT =====================
  async function init({ showProgress, settings }) {
    lastSetupError = "";
    setCloudOptInVisible(false);
    try {
      await ensureFirebaseServices();
      deviceModel = await checkDeviceModel();
      const route = ROUTES[currentRoute()];
      if (!route.usesCloud) await requireDeviceModel(settings, showProgress);
      cachedModel = null; // settings may have changed (Apply & Restart)
      await getModel(settings);
    } catch (err) {
      lastSetupError = err.code || err.message;
      // Offer the cloud opt-in only when on-device is the problem and the config is fine.
      setCloudOptInVisible(err.code === "DEVICE_UNAVAILABLE" || err.code === "DEVICE_NEEDS_GESTURE");
      throw err;
    }
  }

  async function requireDeviceModel(settings, showProgress) {
    if (deviceModel.status === "available") return;
    if (deviceModel.status === "unavailable") throw setupError("DEVICE_UNAVAILABLE");
    if (!navigator.userActivation?.isActive) throw setupError("DEVICE_NEEDS_GESTURE");
    await downloadDeviceModel(settings, showProgress);
    if (deviceModel.status !== "available") throw setupError("DEVICE_UNAVAILABLE");
  }

  function setupError(code) {
    const err = new Error(code);
    err.code = code;
    return err;
  }

  // ===================== UI TEXT =====================
  function describe() {
    const routeId = currentRoute();
    const route = ROUTES[routeId];
    const cloud = CLOUD_MODELS[currentCloudModel()].id;
    const onDevice = deviceModel.status === "available";
    return {
      badge: `Firebase Hybrid · ${route.badge}`,
      hint: route.usesCloud
        ? `Firebase AI Logic · Gemini Nano${onDevice ? "" : " (not ready)"} + cloud ${cloud}`
        : "Firebase AI Logic · Gemini Nano · on-device",
      welcome: route.usesCloud
        ? `Powered by Firebase AI Logic. Answers run on-device with Gemini Nano when possible; otherwise your messages go to Google's ${cloud}.`
        : "Powered by Firebase AI Logic with Gemini Nano, on your device. Cloud fallback is off.",
      title: "MyLocalAI — Firebase Hybrid",
    };
  }

  // Images work wherever the request can actually be served: on-device vision, or the cloud
  // when it will be used for this request (device not ready, or cloud preferred).
  function supportsImages() {
    const route = ROUTES[currentRoute()];
    if (deviceModel.vision) return true;
    return route.usesCloud && (currentRoute() === "prefer-cloud" || deviceModel.status !== "available");
  }

  function statusLine(messageCount) {
    if (!lastInferenceSource) return `${messageCount} messages`;
    // Compare with the SDK's constant: its values ("on_device") differ from the key names.
    const where = lastInferenceSource === firebaseServices?.sdk.InferenceSource.ON_DEVICE
      ? "on-device (Gemini Nano)"
      : `cloud (${CLOUD_MODELS[currentCloudModel()].id})`;
    return `${messageCount} messages · last answer: ${where}`;
  }

  function errorTitle() {
    return lastSetupError === "FIREBASE_NOT_CONFIGURED" ? "Firebase Not Configured" : "Gemini Nano Not Available";
  }

  function helpLines() {
    if (lastSetupError === "FIREBASE_NOT_CONFIGURED") {
      return [
        "Add your Firebase web app config:",
        "1. Copy firebase-settings.example.js to firebase-settings.local.js",
        "2. Fill in the config from Firebase console → Project settings → Your apps",
        "3. Run: node scripts/build.mjs firebase-hybrid",
        "4. Reload the extension, then click Retry",
      ];
    }
    if (lastSetupError === "DEVICE_NEEDS_GESTURE") {
      return ["Gemini Nano is ready to download. Click Retry to start the download (Chrome needs a click)."];
    }
    if (lastSetupError === "DEVICE_UNAVAILABLE") {
      return [
        "On-device Gemini Nano isn't available in this Chrome, and cloud fallback is off.",
        "",
        "Needs Chrome desktop 139+ with chrome://flags/#prompt-api-for-gemini-nano-multimodal-input enabled.",
        "Or allow the cloud fallback below: your messages are then sent to Google's Gemini API.",
      ];
    }
    return [`Firebase AI Logic could not start: ${lastSetupError || "unknown error"}`];
  }

  // ===================== REGISTRATION =====================
  window.MYLOCALAI_PROVIDERS = window.MYLOCALAI_PROVIDERS || {};
  window.MYLOCALAI_PROVIDERS.firebase = {
    id: "firebase",
    statusMessage: "Starting Firebase AI Logic (hybrid)",
    init,
    stream,
    unload,
    describe,
    supportsImages,
    statusLine,
    errorTitle,
    helpLines,
    bindSettingsUI,
    listModels,
    selectModel,
    buildConversationPrompt, // exposed for tests/firebase-checks.mjs
    buildRequest,            // exposed for tests/full-page-checks.mjs
  };
})();
