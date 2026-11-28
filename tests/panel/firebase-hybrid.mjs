// Firebase hybrid edition, end to end in the booted panel: the real providers/firebase-*.js
// files run against a fake Firebase AI Logic SDK (fake-firebase.mjs). Covers where each answer
// runs (and the chip that says so), long messages going to the cloud, and hybrid structured
// output for the memory tool. Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeFirebaseSdk, firebasePanelOptions, InferenceMode } from "./fake-firebase.mjs";

async function firebasePanel({ route, jsonAnswer, remoteValues } = {}) {
  const { sdk, calls } = fakeFirebaseSdk({ jsonAnswer, remoteValues });
  const panel = bootPanel(firebasePanelOptions(sdk, route ? { firebaseRoute: route } : {}));
  await until(() => panel.evaluate("activeBackend") === "firebase", "the Firebase provider");
  return { panel, calls };
}

function findAll(element, test, found = []) {
  for (const child of element.children || []) {
    if (test(child)) found.push(child);
    findAll(child, test, found);
  }
  return found;
}
const chips = (panel) => findAll(panel.element("#messages"), (el) => String(el.className).startsWith("msg-source"));
// The fake DOMParser renders nothing, so answer text is read where the panel finalizes it.
function recordFinalTexts(panel) {
  panel.evaluate(`globalThis.finalTexts = [];
    { const finalize = finalizeMessage; finalizeMessage = (bubble, text, reasoning) => { finalTexts.push(text); return finalize(bubble, text, reasoning); }; }`);
  return () => panel.evaluate("finalTexts.join('\\n')");
}
// Longer than on-device Gemini Nano's 9,216-token window, at the router's 3 characters per token.
const LONG_DOCUMENT = "The quarterly report covers revenue, hiring and risks. ".repeat(600);

// ===================== ON-DEVICE FIRST: SHORT → DEVICE, LONG → CLOUD =====================
{
  const { panel, calls } = await firebasePanel({ route: "prefer-device" });
  await panel.evaluate('sendMessage("Hi there")');
  assert.equal(calls.streams.at(-1).params.mode, InferenceMode.PREFER_ON_DEVICE, "a short message keeps the user's route");
  assert.equal(chips(panel).length, 1, "the answer says where it ran");
  assert.match(chips(panel)[0].textContent, /On-device · Gemini Nano/);
  assert.equal(chips(panel)[0].className, "msg-source msg-source-device");

  await panel.evaluate(`sendMessage(${JSON.stringify(LONG_DOCUMENT)})`);
  const longCall = calls.streams.at(-1);
  assert.equal(longCall.params.mode, InferenceMode.ONLY_IN_CLOUD,
    "a message too long for Nano goes straight to the cloud instead of overflowing on the device");
  assert.equal(longCall.params.inCloudParams.model, "gemini-3.5-flash-lite", "on the user's cloud model");
  const cloudChip = chips(panel).at(-1);
  assert.match(cloudChip.textContent, /Cloud · gemini-3\.5-flash-lite · too long for on-device/, "and the chip says why");
  assert.equal(cloudChip.className, "msg-source msg-source-cloud");
  assert.match(cloudChip.title, /sent to Google/, "the chip's tooltip says the message left the device");

  await panel.evaluate('sendMessage("Thanks, and a short follow-up?")');
  assert.equal(calls.streams.at(-1).params.mode, InferenceMode.PREFER_ON_DEVICE, "the next short message is back on the device");
  assert.match(panel.evaluate("tokenInfo.textContent"), /last answer: on-device/, "the footer follows the last answer");
}

// ===================== ON-DEVICE ONLY: A LONG MESSAGE NEVER REACHES THE CLOUD =====================
{
  const { panel, calls } = await firebasePanel({ route: "device" });
  const textIn = recordFinalTexts(panel);
  await panel.evaluate('sendMessage("Hello")');
  assert.equal(calls.streams.at(-1).params.mode, InferenceMode.ONLY_ON_DEVICE);
  const before = calls.streams.length;
  await panel.evaluate(`sendMessage(${JSON.stringify(LONG_DOCUMENT)})`);
  assert.equal(calls.streams.length, before, "nothing is sent, so nothing can fall back to the cloud");
  assert.match(textIn(), /too long for on-device Gemini Nano/, "the user is told why");
  assert.match(textIn(), /On-device first, cloud Gemini fallback/, "and how to send long documents");
  assert.equal(calls.models.some((params) => params.mode === InferenceMode.ONLY_IN_CLOUD), false, "no cloud model is ever built");
}

// ===================== MEMORY TOOL: FIREBASE HYBRID STRUCTURED OUTPUT =====================
{
  const jsonAnswer = JSON.stringify({ action: "create", title: "Name", description: "The user is called Asha." });
  const { panel, calls } = await firebasePanel({ route: "prefer-device", jsonAnswer });
  await panel.evaluate('sendMessage("My name is Asha, please remember it")');
  await until(() => calls.json.length > 0, "the memory tool call");
  const { params, request } = calls.json[0];
  const schema = JSON.parse(JSON.stringify(panel.evaluate("MEMORY_TOOL_SCHEMA")));
  assert.deepEqual(params.onDeviceParams.promptOptions.responseConstraint, schema, "Nano gets the full JSON schema");
  assert.equal(params.inCloudParams.generationConfig.responseMimeType, "application/json", "the cloud is asked for JSON");
  const cloudSchema = params.inCloudParams.generationConfig.responseSchema;
  assert.deepEqual(cloudSchema.required, ["action"]);
  assert.deepEqual(cloudSchema.properties.action.enum, schema.properties.action.enum, "the action list reaches the cloud");
  assert.equal("additionalProperties" in cloudSchema, false, "keywords the cloud schema rejects are left out");
  assert.equal("maxLength" in cloudSchema.properties.title, false);
  assert.equal(params.mode, InferenceMode.PREFER_ON_DEVICE, "the tool call follows the chat's route");
  assert.match(String(request), /My name is Asha/, "the prompt holds the typed text");
  assert.equal(calls.streams.filter((call) => /keep a short memory/.test(JSON.stringify(call.request))).length, 0,
    "the tool prompt is not sent as a chat message");
  await until(() => JSON.parse(panel.evaluate('localStorage.getItem("memories")') || "[]").length === 1, "the saved memory");
  assert.equal(JSON.parse(panel.evaluate('localStorage.getItem("memories")'))[0].description, "The user is called Asha.");
  assert.equal(calls.models.at(-1).onDeviceParams.promptOptions?.responseConstraint !== undefined, true,
    "the JSON model is its own model…");
  await panel.evaluate('sendMessage("Hi again")');
  assert.equal(calls.streams.at(-1).params.onDeviceParams.promptOptions, undefined, "…so chat answers are never JSON-constrained");
}

// ===================== REMOTE CONFIG: CLOUD MODEL NAMES =====================
{
  const remoteValues = { cloud_model_fast: "gemini-3.6-flash-lite", cloud_model_frontier: "gemini-5-preview" };
  const { panel, calls } = await firebasePanel({ route: "prefer-cloud", remoteValues });
  assert.equal(calls.remoteConfigFetches, 1, "a cloud route reads the model names from Remote Config");
  await panel.evaluate('sendMessage("Hi")');
  assert.equal(calls.streams.at(-1).params.inCloudParams.model, "gemini-3.6-flash-lite", "the console's name is used");
  const labels = JSON.parse(JSON.stringify(panel.evaluate("externalProvider.listModels().options.map((o) => o.label)")));
  assert.deepEqual(labels, ["Gemini Nano", "gemini-3.6-flash-lite", "gemini-4-hydrogen"],
    "the model menu follows Remote Config; a preview model is refused and the built-in name kept");
  await panel.evaluate("reloadExternalProvider()");
  assert.equal(calls.remoteConfigFetches, 1, "asked once per panel");
}
{
  const { calls } = await firebasePanel({ route: "device", remoteValues: { cloud_model_fast: "gemini-3.6-flash-lite" } });
  assert.equal(calls.remoteConfigFetches, 0, "On-device only makes no Remote Config request");
}
