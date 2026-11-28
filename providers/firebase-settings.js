/**
 * MyLocalAI — Firebase AI Logic: the user's choices (where answers run, which cloud model,
 * the "Cloud & internet" switch) and the controls that change them.
 *
 * Owns localStorage keys, the Settings card and the prompt-bar model list. No Firebase calls,
 * so it works (and is tested) without the SDK. providers/firebase-backend.js reads everything
 * through window.MyLocalAIFirebaseSettings; sidebar.html loads this file before it.
 */
(() => {
  "use strict";

  // ===================== CHOICES =====================
  // Free-tier cloud models only (hackathon constraint: no Blaze-plan or retiring models).
  const CLOUD_MODELS = {
    fast: { id: "gemini-3.5-flash-lite", label: "Fast · gemini-3.5-flash-lite" },
    frontier: { id: "gemini-4-hydrogen", label: "Frontier · gemini-4-hydrogen" },
  };
  const DEFAULT_CLOUD_MODEL = "fast";
  const TIER_LABELS = { fast: "Fast", frontier: "Frontier" };

  // Names Remote Config may set (firebase-remote-config.js): stable Gemini text models only.
  // The production checklist rules out preview, experimental and -latest names, and image,
  // speech and Live models do not fit a text chat.
  const ALLOWED_MODEL_NAME = /^gemini-[a-z0-9.-]+$/;
  const REJECTED_MODEL_NAME = /preview|exp|latest|image|tts|live|audio/;

  // Where answers run. "device" is the default and the only route that keeps chat text local.
  const ROUTES = {
    device: { mode: "ONLY_ON_DEVICE", usesCloud: false, badge: "On-device only" },
    "prefer-device": { mode: "PREFER_ON_DEVICE", usesCloud: true, badge: "On-device · cloud fallback" },
    "prefer-cloud": { mode: "PREFER_IN_CLOUD", usesCloud: true, badge: "Cloud first · on-device fallback" },
  };
  const DEFAULT_ROUTE = "device";

  const STORAGE_KEYS = {
    route: "firebaseRoute", cloudModel: "firebaseCloudModel", cloudSwitch: "firebaseCloudSwitch", launchChoice: "firebaseLaunchChoice",
  };
  // "Cloud & internet" switch. Off overrides every cloud choice without forgetting it.
  const CLOUD_SWITCH = { on: true, off: false };

  // ===================== STORAGE AND SETTINGS CARD =====================
  const $ = (id) => document.getElementById(id);
  let settingsBound = false; // applyEditionUI runs on every restart; bind listeners once

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

  function isCloudAllowed() { return readStored(STORAGE_KEYS.cloudSwitch, CLOUD_SWITCH, "on") === "on"; }
  // With the switch off, every request is on-device only, so no chat text can reach the cloud.
  function currentRoute() { return isCloudAllowed() ? readStored(STORAGE_KEYS.route, ROUTES, DEFAULT_ROUTE) : DEFAULT_ROUTE; }
  function currentCloudModel() { return readStored(STORAGE_KEYS.cloudModel, CLOUD_MODELS, DEFAULT_CLOUD_MODEL); }

  // Fills and wires the "Firebase AI Logic" settings card and the overlay's cloud opt-in button.
  // onSettingsChanged: the sidebar's way to rebuild the model (and its UI) right away.
  function bindSettingsUI({ onSettingsChanged } = {}) {
    const card = $("firebase-settings");
    const routeSelect = $("firebase-route");
    const modelSelect = $("firebase-cloud-model");
    if (settingsBound || !card || !routeSelect || !modelSelect) return;
    settingsBound = true;
    card.classList.remove("hidden");
    syncSettingsControls();

    $("firebase-cloud-switch")?.addEventListener("change", (event) => {
      setCloudAllowed(event.target.checked);
      onSettingsChanged?.();
    });

    // Saved immediately; "Apply & Restart Session" (or Retry) rebuilds the model with them.
    routeSelect.addEventListener("change", () => { storeSetting(STORAGE_KEYS.route, routeSelect.value); syncSettingsControls(); });
    modelSelect.addEventListener("change", () => storeSetting(STORAGE_KEYS.cloudModel, modelSelect.value));

    $("btn-firebase-enable-cloud")?.addEventListener("click", () => {
      // The user explicitly opts in to the cloud fallback from the error overlay.
      storeSetting(STORAGE_KEYS.cloudSwitch, "on");
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
    const cloudSwitch = $("firebase-cloud-switch");
    if (cloudSwitch) cloudSwitch.checked = isCloudAllowed();
    routeSelect.value = currentRoute();
    routeSelect.disabled = !isCloudAllowed();
    for (const option of modelSelect.options || []) {
      if (Object.hasOwn(CLOUD_MODELS, option.value)) option.textContent = CLOUD_MODELS[option.value].label;
    }
    modelSelect.value = currentCloudModel();
    // The cloud model only matters when the route can reach the cloud.
    modelSelect.disabled = !ROUTES[currentRoute()].usesCloud;
  }

  // Replaces the built-in cloud model names with Remote Config's. Returns the ones applied;
  // a name outside the allowed set is ignored, so a typo in the console cannot break chat.
  function applyCloudModelNames(names) {
    const applied = {};
    for (const [key, id] of Object.entries(names)) {
      if (!Object.hasOwn(CLOUD_MODELS, key)) continue;
      if (!ALLOWED_MODEL_NAME.test(id) || REJECTED_MODEL_NAME.test(id)) {
        console.warn(`[MyLocalAI] Ignoring Remote Config model name "${id}": not a stable Gemini text model`);
        continue;
      }
      CLOUD_MODELS[key].id = id;
      CLOUD_MODELS[key].label = `${TIER_LABELS[key]} · ${id}`;
      applied[key] = id;
    }
    syncSettingsControls();
    return applied;
  }

  function setCloudAllowed(allowed) {
    storeSetting(STORAGE_KEYS.cloudSwitch, allowed ? "on" : "off");
    if (!allowed) setCloudOptInVisible(false);
    syncSettingsControls();
  }

  function setCloudOptInVisible(visible) {
    $("firebase-cloud-optin")?.classList.toggle("hidden", !visible);
  }

  // ===================== FIRST LAUNCH: PRIVATE OR HYBRID =====================
  // The first panel asks once, before Firebase loads, so nothing can reach the network until
  // the user has picked. Each choice is just a preset of the switch and route above.
  const LAUNCH_CHOICES = {
    private: { cloudSwitch: "off", route: "device" },
    hybrid: { cloudSwitch: "on", route: "prefer-device" },
  };
  let pendingLaunchChoice = null; // one question even if init() runs again (Retry) meanwhile

  // Panels from before this question have their switch or route saved; don't ask them again.
  function needsLaunchChoice() {
    try {
      return [STORAGE_KEYS.launchChoice, STORAGE_KEYS.cloudSwitch, STORAGE_KEYS.route]
        .every((key) => localStorage.getItem(key) === null);
    } catch (_) {
      return false; // no storage: nothing could be remembered, keep the private default
    }
  }

  function applyLaunchChoice(choiceId) {
    const choice = LAUNCH_CHOICES[choiceId];
    storeSetting(STORAGE_KEYS.cloudSwitch, choice.cloudSwitch);
    storeSetting(STORAGE_KEYS.route, choice.route);
    storeSetting(STORAGE_KEYS.launchChoice, choiceId);
    syncSettingsControls();
  }

  // Shows the two buttons in the status card and resolves with the choice once one is clicked.
  // The click is also the user gesture Chrome needs to start a Gemini Nano download.
  function askLaunchChoice() {
    if (pendingLaunchChoice) return pendingLaunchChoice;
    const panel = $("firebase-launch-choice");
    if (!panel) return Promise.resolve(null);
    panel.classList.remove("hidden");
    pendingLaunchChoice = new Promise((resolve) => {
      for (const choiceId of Object.keys(LAUNCH_CHOICES)) {
        $(`btn-launch-${choiceId}`)?.addEventListener("click", () => {
          if (!pendingLaunchChoice) return; // already answered
          applyLaunchChoice(choiceId);
          panel.classList.add("hidden");
          pendingLaunchChoice = null;
          resolve(choiceId);
        });
      }
    });
    return pendingLaunchChoice;
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
    if (!isCloudAllowed()) return { options, currentId: DEVICE_MODEL_ID }; // the switch hides cloud models
    for (const [key, model] of Object.entries(CLOUD_MODELS)) {
      const tier = TIER_LABELS[key];
      options.push({ id: `${CLOUD_MODEL_ID_PREFIX}${key}`, label: model.id, detail: `☁️ Cloud · ${tier} · sends messages to Google` });
    }
    return { options, currentId: currentModelId() };
  }

  // Stores the choice only; the sidebar then calls init() to rebuild the model with it.
  function selectModel(id) {
    if (id === DEVICE_MODEL_ID) {
      storeSetting(STORAGE_KEYS.route, "device");
    } else if (id.startsWith(CLOUD_MODEL_ID_PREFIX) && !isCloudAllowed()) {
      throw new Error("Cloud & internet is off in Settings");
    } else if (id.startsWith(CLOUD_MODEL_ID_PREFIX) && Object.hasOwn(CLOUD_MODELS, id.slice(CLOUD_MODEL_ID_PREFIX.length))) {
      storeSetting(STORAGE_KEYS.route, "prefer-cloud");
      storeSetting(STORAGE_KEYS.cloudModel, id.slice(CLOUD_MODEL_ID_PREFIX.length));
    } else {
      throw new Error(`Unknown model: ${id}`);
    }
    syncSettingsControls();
  }


  window.MyLocalAIFirebaseSettings = {
    ROUTES,
    CLOUD_MODELS,
    isCloudAllowed,
    currentRoute,
    currentCloudModel,
    applyCloudModelNames,
    bindSettingsUI,
    setCloudOptInVisible,
    needsLaunchChoice,
    askLaunchChoice,
    listModels,
    selectModel,
  };
})();
