/**
 * MyLocalAI — Firebase Remote Config: the cloud model names.
 *
 * Firebase's AI Logic production checklist recommends Remote Config for model names, so a
 * retired model can be replaced from the console without shipping a new extension. Set the
 * parameters below under Firebase console → Remote Config (Client); unset ones keep the names
 * built into firebase-settings.js.
 *
 * Only fetched (and only watched for live changes) when the user's route can reach the cloud:
 * "On-device only" stays offline.
 * providers/firebase-backend.js calls it through window.MyLocalAIFirebaseRemoteConfig.
 */
(() => {
  "use strict";

  // Keys match CLOUD_MODELS in firebase-settings.js.
  const PARAMS = { fast: "cloud_model_fast", frontier: "cloud_model_frontier" };
  // Within this interval the SDK answers from its cache (IndexedDB) without a request.
  const MIN_FETCH_INTERVAL_MS = 60 * 60 * 1000;
  // A slow network must not hold up the panel; the built-in names are used meanwhile.
  const FETCH_TIMEOUT_MS = 5000;

  // Returns the names the console sets, e.g. { fast: "gemini-…" }; {} when none or on failure.
  async function fetchCloudModelNames(sdk, app) {
    try {
      const remoteConfig = sdk.getRemoteConfig(app);
      remoteConfig.settings.minimumFetchIntervalMillis = MIN_FETCH_INTERVAL_MS;
      remoteConfig.settings.fetchTimeoutMillis = FETCH_TIMEOUT_MS;
      await sdk.fetchAndActivate(remoteConfig);
      return readCloudModelNames(sdk, remoteConfig);
    } catch (e) {
      console.warn("[MyLocalAI] Remote Config unavailable, using built-in model names:", e.message);
      return {};
    }
  }

  // Only values the console actually set ("remote"); defaults and empty strings are skipped.
  function readCloudModelNames(sdk, remoteConfig) {
    const names = {};
    for (const [key, param] of Object.entries(PARAMS)) {
      const value = sdk.getValue(remoteConfig, param);
      const name = value.asString().trim();
      if (value.getSource() === "remote" && name) names[key] = name;
    }
    return names;
  }

  // Real-time Remote Config: a publish in the console reaches an open panel within seconds,
  // instead of after MIN_FETCH_INTERVAL_MS. On connecting, the server also reports its latest
  // template version, so a cached copy older than the console's is replaced right away.
  // Calls onNames with the new names (same shape as fetchCloudModelNames) when one of PARAMS
  // changed. Returns a function that closes the stream.
  function watchCloudModelNames(sdk, app, onNames) {
    try {
      const remoteConfig = sdk.getRemoteConfig(app);
      const watched = new Set(Object.values(PARAMS));
      return sdk.onConfigUpdate(remoteConfig, {
        next: async (update) => {
          if (![...update.getUpdatedKeys()].some((key) => watched.has(key))) return;
          await sdk.activate(remoteConfig);
          onNames(readCloudModelNames(sdk, remoteConfig));
        },
        error: (e) => console.warn("[MyLocalAI] Remote Config live updates stopped:", e.message),
        complete: () => { },
      });
    } catch (e) {
      console.warn("[MyLocalAI] Remote Config live updates unavailable:", e.message);
      return () => { };
    }
  }

  window.MyLocalAIFirebaseRemoteConfig = { PARAMS, fetchCloudModelNames, watchCloudModelNames };
})();
