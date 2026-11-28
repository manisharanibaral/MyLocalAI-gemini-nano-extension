# Firebase AI Logic — hybrid inference reference (Web / Chrome)

Researched 2026-11-28 from the official docs (paraphrased; code is condensed from the
documented API names). Re-check the source page before relying on a detail that matters.

| Source | URL |
|---|---|
| Hybrid web get-started | https://firebase.google.com/docs/ai-logic/hybrid/web/get-started?api=dev |
| Hybrid overview | https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference?api=dev |
| Hybrid configuration options | https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options |
| Hybrid structured output | https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output |
| Hybrid docs index (LLM-friendly) | https://firebase.google.com/docs/ai-logic/hybrid/llms.txt |
| App Check for AI Logic | https://firebase.google.com/docs/ai-logic/app-check |
| Production checklist | https://firebase.google.com/docs/ai-logic/production-checklist |
| Remote Config for model names | https://firebase.google.com/docs/ai-logic/change-model-name-remotely |
| Remote Config solutions | https://firebase.google.com/docs/ai-logic/solutions/remote-config |
| Supported models | https://firebase.google.com/docs/ai-logic/models |
| Firebase Agent Skills | https://firebase.google.com/docs/ai-assistance/agent-skills |

Tip: most Firebase doc pages also serve plain Markdown at `<url>.md.txt`, which fetches
more reliably than the HTML page.

## Requirements

- Firebase JS SDK **v12.5.0+** for on-device inference and `inferenceSource`; **v13.0.0+**
  makes `gemini-3.5-flash-lite` the default cloud model; **v12.14.0+** for limited-use App
  Check tokens. This repo bundles **firebase 13.4.0** (`tools/firebase-bundle`).
- **Chrome desktop 139+**. On-device uses Chrome's Prompt API. Users may need
  `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`.
- Hybrid is Web only in the JS SDK (Android/iOS have their own hybrid guides).

## Core API

```js
import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema } from "firebase/ai";

const ai = getAI(app, { backend: new GoogleAIBackend() /*, useLimitedUseAppCheckTokens: true */ });
const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: { model: "gemini-3.5-flash-lite", systemInstruction, generationConfig: { maxOutputTokens, temperature, topK } },
  onDeviceParams: {
    createOptions: { expectedInputs, expectedOutputs, initialPrompts: [{ role: "system", content }] /*, temperature, topK */ },
    promptOptions: { responseConstraint /* JSON schema */ },
  },
});
await model.initializeDeviceModel((fraction) => { /* 0..1 download progress */ }); // needs a user gesture
const result = await model.generateContentStream(promptOrParts, { signal });
for await (const chunk of result.stream) { chunk.text(); chunk.inferenceSource; }
```

- A model's config is fixed for its lifetime: build a new model to change mode or params.
- `result.response.inferenceSource` (or `chunk.inferenceSource`) says where it ran. **The
  values are lowercase strings (`"on_device"`, `"in_cloud"`); compare with the
  `InferenceSource` constants, not the key names** (found in a real browser run).

### InferenceMode

| Mode | Behaviour |
|---|---|
| `PREFER_ON_DEVICE` | Nano if available, else cloud |
| `ONLY_ON_DEVICE` | Nano or throw |
| `PREFER_IN_CLOUD` | Cloud if available, else Nano |
| `ONLY_IN_CLOUD` | Cloud or throw |

While Nano is still downloading, `PREFER_*` answers from the cloud and `ONLY_ON_DEVICE`
waits (can take minutes).

## What runs where

| Capability | On-device (Nano) | Notes |
|---|---|---|
| Single-turn text, streaming or not | ✅ | |
| Text + image | ✅ JPEG/PNG only, inline data only | |
| Structured output (JSON, enums) | ✅ | same schema both sides |
| Context size | **9,216 tokens** (text + image) | the SDK does *not* check prompt size before choosing Nano |
| Multi-turn chat | ❌ | fold history into one prompt (see `providers/firebase-prompt.js`) |
| Audio, video, PDF, file URLs | ❌ | |
| Tools: function calling, code execution, URL context, Search/Maps grounding | ❌ | |
| Image generation | ❌ | |

Unsupported input: `ONLY_ON_DEVICE` throws; `PREFER_*` falls back to the cloud. The docs
recommend calling a cloud-only model directly for cloud-only features.

**Not supported in hybrid at all:** Live API, server prompt templates, `countTokens`
(counts differ between models). Estimate prompt size yourself (~4 chars/token in English;
MyLocalAI uses 3 to err towards "too long").

AI monitoring in the console shows **no data for on-device** requests; cloud requests are
monitored as usual.

## Structured output in hybrid

- On-device: `onDeviceParams.promptOptions.responseConstraint` (a `Schema` or plain JSON
  Schema).
- Cloud: `inCloudParams.generationConfig.responseMimeType: "application/json"` (or
  `"text/x.enum"`) plus `responseSchema`.
- Pass the same schema to both. Cloud `responseSchema` is an OpenAPI-style subset: keep
  `type, properties, required, enum, items, description, nullable`; drop JSON Schema
  extras such as `additionalProperties` / `maxLength` (see `toCloudSchema` in
  `providers/firebase-routing.js`). *This trimming is our inference, not verified in a
  real cloud call yet.*
- Helpers: `Schema.object({ properties, optionalProperties })`, `Schema.array`,
  `Schema.string`, `Schema.number`, `Schema.enumString({ enum })`.

## App Check (required)

- **Auto-enforced for AI Logic in all projects since Nov 2, 2026.** Can be un-enforced only
  until Jan 21, 2027.
- Web attestation is reCAPTCHA Enterprise, which a Manifest V3 extension cannot load
  (remote script). So this repo uses the **debug token** flow:
  `self.FIREBASE_APPCHECK_DEBUG_TOKEN = <token or true>` before `initializeAppCheck`, then
  register the token in Firebase console → Security → App Check → Manage debug tokens.
  The hackathon accepts debug tokens. Never commit or zip the token.
- Recommended for production: limited-use tokens (replay protection):
  `getAI(app, { backend, useLimitedUseAppCheckTokens: true })`, 5-minute tokens, extra latency.
- Errors: 403 `PERMISSION_DENIED` = App Check missing/invalid (or project deactivated).

## Remote Config (recommended for model names)

```js
import { getRemoteConfig, fetchAndActivate, getValue, onConfigUpdate, activate } from "firebase/remote-config";
const rc = getRemoteConfig(app);
rc.settings.minimumFetchIntervalMillis = 3600000; // low value while developing
rc.defaultConfig = { model_name: "gemini-4-hydrogen" };
await fetchAndActivate(rc);
const name = getValue(rc, "model_name").asString(); // .getSource(): "remote" | "default" | "static"
```

- Set parameters in console → Remote Config (Client template). Other useful parameters:
  system instructions, prompt text, max output tokens, safety settings, a
  `minimum_version`, a limited-use-token flag.
- For hybrid, the name goes into `inCloudParams.model` (our inference; the docs' snippet
  uses a cloud-only model).
- Remote Config values are readable by end users: no secrets.
- Network: `firebaseremoteconfig.googleapis.com` and `firebaseinstallations.googleapis.com`.
- **Real-time (2026-11-28, read from the SDK source `@firebase/remote-config` 0.10.0, firebase 13.4.0;
  the web guide is not published yet, per a TODO in that source):** `onConfigUpdate(rc, { next, error, complete })`
  opens a stream to `firebaseremoteconfigrealtime.googleapis.com/.../namespaces/firebase:streamFetchInvalidations`.
  On connect the server sends `latestTemplateVersionNumber`; if it is newer than the SDK's, the
  SDK fetches (bypassing `minimumFetchIntervalMillis`) and calls `next` with `getUpdatedKeys()`.
  The new values are fetched but **not activated**: call `activate(rc)` in `next`. The stream is
  paused while the page is hidden. Without it, `fetchAndActivate` serves the cached copy until
  `minimumFetchIntervalMillis` passes, which is why a console change "did nothing" for up to an hour.
- **Hybrid `PREFER_IN_CLOUD` fallback (SDK source, `callCloudOrDevice`):** a cloud `AIError` in
  `errorsCausingFallback` (incl. `FETCH_ERROR`, e.g. App Check 403) silently switches to
  on-device if Nano is available; only `inferenceSource` reveals it.

## Production checklist (summary)

1. Separate Firebase projects for dev / test / prod.
2. Enforce App Check; register a production attestation provider; consider replay protection.
3. Restrict the API key (HTTP referrer / app restrictions); API restrictions must include
   `firebasevertexai.googleapis.com` (plus Remote Config / Installations if used).
4. Consider requiring Firebase Authentication (unauthenticated calls then get `401`).
5. Turn on AI monitoring; set per-user rate limits (default 100 RPM) and review quotas;
   on Blaze, set budget alerts.
6. **Stable model names only** — no `-preview`, `-exp`, `-latest`. Control them with Remote
   Config or server prompt templates.

## Models (Gemini Developer API, Nov 2026)

| Model | Billing | Use |
|---|---|---|
| `gemini-4-hydrogen` | not required | flagship efficiency; this repo's "Frontier" |
| `gemini-3.8-flash` | not required | frontier-class, fast; good alternative |
| `gemini-3.5-flash-lite` | not required | high-volume, cheapest; default hybrid cloud model; this repo's "Fast" |
| `gemini-4-neon`, `gemini-4-carbon` | **required** | don't use (free-tier rule in this repo) |
| `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3-pro-image` | required | image generation |
| `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts` | not required | text-to-speech |
| `gemini-3.1-flash-live-preview` | not required | Live API (not usable in hybrid) |

Gemini 2.5 models are deprecated/shut down (Developer API reroutes 2.5 Flash/Pro from
Dec 1, 2026). Gemini 4 / 3.x Flash input limit is 1,048,576 tokens, so long documents fit
easily in the cloud. Model naming: stable has no suffix, preview `-preview`, experimental
`-exp-MM-DD`.

## Firebase Agent Skills and MCP

- Install in Claude Code: `claude plugin marketplace add firebase/agent-skills`, then
  `claude plugin install firebase@firebase`; update with
  `claude plugin marketplace update firebase`.
- Relevant skills: `firebase-ai-logic-basics`, `firebase-remote-config-basics`,
  `firebase-auth-basics`, `firebase-firestore-standard`, `firestore-security-rules-auditor`,
  `firebase-basics`, `firebase-local-env-setup`.
- The Firebase MCP server (`.mcp.json` in this repo, pinned `firebase-tools`) gives
  project access plus `developerknowledge_*` doc search — the doc search needs
  `firebase login` first (it failed with "not logged in" during this research).
