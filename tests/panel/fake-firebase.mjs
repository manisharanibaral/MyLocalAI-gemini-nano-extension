// A stand-in for the bundled Firebase AI Logic SDK (window.MyLocalAIFirebase), so the real
// providers/firebase-backend.js can run in the booted panel. It records every model it builds
// and every request, and answers from "the device" whenever the mode allows it.
export const InferenceMode = {
  PREFER_ON_DEVICE: "prefer_on_device",
  ONLY_ON_DEVICE: "only_on_device",
  PREFER_IN_CLOUD: "prefer_in_cloud",
  ONLY_IN_CLOUD: "only_in_cloud",
};
// The real SDK's values differ from the key names; the backend must compare with the constants.
export const InferenceSource = { ON_DEVICE: "on_device", IN_CLOUD: "in_cloud" };

const plain = (value) => JSON.parse(JSON.stringify(value));

// remoteValues: Remote Config parameters "set in the console", e.g. { cloud_model_fast: "gemini-…" }.
// cloudFails: the cloud call fails (e.g. App Check 403); like the real SDK, "Cloud first" then
// answers on-device without saying why.
export function fakeFirebaseSdk({ jsonAnswer = '{"action":"none"}', remoteValues = {}, cloudFails = false } = {}) {
  const calls = { apps: 0, models: [], streams: [], json: [], remoteConfigFetches: 0, liveWatchers: 0, liveStops: 0 };
  const liveObservers = new Set();

  function sourceFor(mode) {
    if (mode === InferenceMode.ONLY_IN_CLOUD) return InferenceSource.IN_CLOUD;
    if (mode === InferenceMode.PREFER_IN_CLOUD) return cloudFails ? InferenceSource.ON_DEVICE : InferenceSource.IN_CLOUD;
    return InferenceSource.ON_DEVICE;
  }

  // A publish in the console while the panel is open: the values change, then every live
  // observer hears which keys changed (the real SDK has fetched them but not activated them).
  async function publishRemoteValues(values) {
    Object.assign(remoteValues, values);
    for (const observer of liveObservers) await observer.next({ getUpdatedKeys: () => new Set(Object.keys(values)) });
  }

  const sdk = {
    InferenceMode,
    InferenceSource,
    initializeApp: (config) => { calls.apps += 1; return { config }; },
    initializeAppCheck() { },
    CustomProvider: class { },
    GoogleAIBackend: class { },
    getAI: (app) => ({ app }),
    getRemoteConfig: () => ({ settings: {} }),
    fetchAndActivate: async () => { calls.remoteConfigFetches += 1; return true; },
    activate: async () => true,
    onConfigUpdate(_remoteConfig, observer) {
      calls.liveWatchers += 1;
      liveObservers.add(observer);
      return () => { calls.liveStops += 1; liveObservers.delete(observer); };
    },
    getValue: (_remoteConfig, key) => ({
      asString: () => remoteValues[key] ?? "",
      getSource: () => (key in remoteValues ? "remote" : "static"),
    }),
    getGenerativeModel(_ai, params) {
      calls.models.push(plain(params));
      const source = sourceFor(params.mode);
      return {
        initializeDeviceModel: async () => { },
        async generateContentStream(request) {
          calls.streams.push({ params: plain(params), request: plain(request) });
          async function* chunks() {
            yield { text: () => "Hello ", inferenceSource: source };
            yield { text: () => "there", inferenceSource: source };
          }
          return { stream: chunks() };
        },
        async generateContent(request) {
          calls.json.push({ params: plain(params), request: plain(request) });
          return { response: { text: () => jsonAnswer, inferenceSource: source } };
        },
      };
    },
  };
  return { sdk, calls, publishRemoteValues };
}

// Everything the panel needs to boot as the firebase-hybrid edition with this fake SDK.
export function firebasePanelOptions(sdk, storage = {}) {
  return {
    storage,
    globals: {
      MyLocalAIFirebase: sdk,
      MYLOCALAI_FIREBASE: { config: { apiKey: "test-key", projectId: "test-project", appId: "test-app" }, appCheckDebugToken: "" },
      LanguageModel: { availability: async () => "available", params: async () => ({ maxTopK: 8, maxTemperature: 2 }) },
      self: {},
    },
    afterScripts: { "config.js": 'window.MYLOCALAI_CONFIG = { edition: "firebase-hybrid", backends: ["firebase"] };' },
  };
}
