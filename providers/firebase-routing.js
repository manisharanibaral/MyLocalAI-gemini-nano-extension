/**
 * MyLocalAI — Firebase AI Logic: per-request routing decisions.
 *
 * The user picks a route (on-device only, on-device first, cloud first). This file decides what
 * one request does within that choice, and how to label where the answer came from. Pure
 * functions with no Firebase calls, so tests run them in a vm; providers/firebase-backend.js
 * uses them through window.MyLocalAIFirebaseRouting.
 */
(() => {
  "use strict";

  // Firebase's hybrid docs: on-device Gemini Nano takes at most 9,216 tokens (text + image).
  const ON_DEVICE_CONTEXT_TOKENS = 9216;
  // Left free for the answer, so a prompt that only just fits still has room to be answered.
  const ON_DEVICE_ANSWER_RESERVE_TOKENS = 1500;
  // English averages ~4 characters per token. Counting 3 errs towards "too long", so a borderline
  // prompt goes to the cloud instead of failing on the device. The hybrid SDK has no countTokens.
  const CHARS_PER_TOKEN = 3;

  const REASONS = { none: "", tooLongForDevice: "too-long", tooLongAndCloudOff: "too-long-no-cloud" };

  function estimateTokens(text) {
    return Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN);
  }

  function fitsOnDevice({ promptText, systemPrompt }) {
    const needed = estimateTokens(promptText) + estimateTokens(systemPrompt);
    return needed <= ON_DEVICE_CONTEXT_TOKENS - ON_DEVICE_ANSWER_RESERVE_TOKENS;
  }

  // Returns { mode, reason }: the InferenceMode key for this request and why it differs from the
  // route's own mode. Only a prompt too long for Nano changes anything:
  //  - "On-device first": it goes straight to the cloud. The SDK only checks that Nano exists,
  //    so it would pick Nano and fail with a context overflow instead of falling back.
  //  - "On-device only": it stays on the device (the user said no cloud); the reason lets the
  //    backend explain the failure instead of showing the Prompt API's error.
  function chooseRequestMode(route, request) {
    if (fitsOnDevice(request)) return { mode: route.mode, reason: REASONS.none };
    if (route.mode === "PREFER_ON_DEVICE") return { mode: "ONLY_IN_CLOUD", reason: REASONS.tooLongForDevice };
    if (route.mode === "ONLY_ON_DEVICE") return { mode: route.mode, reason: REASONS.tooLongAndCloudOff };
    return { mode: route.mode, reason: REASONS.none };
  }

  function tooLongForDeviceMessage(request) {
    const tokens = estimateTokens(request.promptText) + estimateTokens(request.systemPrompt);
    return `This message is too long for on-device Gemini Nano (~${tokens.toLocaleString("en-US")} tokens; ` +
      `about ${(ON_DEVICE_CONTEXT_TOKENS - ON_DEVICE_ANSWER_RESERVE_TOKENS).toLocaleString("en-US")} fit). ` +
      "Shorten it, or choose \"On-device first, cloud Gemini fallback\" in Settings so long documents go to the cloud.";
  }

  // The chip under each answer, so the user always sees whether their text left the device.
  function describeAnswerSource({ onDevice, cloudModelId, reason }) {
    if (onDevice) {
      return { kind: "device", label: "⚡ On-device · Gemini Nano", title: "Answered by Gemini Nano on this computer; the message did not leave it." };
    }
    const why = reason === REASONS.tooLongForDevice ? " · too long for on-device" : "";
    return {
      kind: "cloud",
      label: `☁️ Cloud · ${cloudModelId}${why}`,
      title: "Answered by Google's Gemini API through Firebase AI Logic; the message was sent to Google.",
    };
  }

  // Cloud structured output takes an OpenAPI-style schema, which rejects some JSON Schema
  // keywords (additionalProperties, maxLength). On-device responseConstraint takes the full
  // schema, so only the cloud copy is trimmed; the prompt still states the limits.
  const CLOUD_SCHEMA_KEYS = ["type", "properties", "required", "enum", "items", "description", "nullable"];

  function toCloudSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    const out = {};
    for (const key of CLOUD_SCHEMA_KEYS) {
      if (!(key in schema)) continue;
      if (key === "properties") {
        out.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => [name, toCloudSchema(value)]));
      } else if (key === "items") {
        out.items = toCloudSchema(schema.items);
      } else {
        out[key] = schema[key];
      }
    }
    return out;
  }

  // Firebase hybrid structured output: one schema, given to each side in its own key.
  function structuredOutputParams(schema) {
    return {
      cloudGenerationConfig: { responseMimeType: "application/json", responseSchema: toCloudSchema(schema) },
      devicePromptOptions: { responseConstraint: schema },
    };
  }

  window.MyLocalAIFirebaseRouting = {
    REASONS,
    ON_DEVICE_CONTEXT_TOKENS,
    estimateTokens,
    chooseRequestMode,
    tooLongForDeviceMessage,
    describeAnswerSource,
    toCloudSchema,
    structuredOutputParams,
  };
})();
