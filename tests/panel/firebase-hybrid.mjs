// Firebase hybrid edition, end to end in the booted panel: the real providers/firebase-*.js
// files run against a fake Firebase AI Logic SDK (fake-firebase.mjs). Covers where each answer
// runs (and the chip that says so), long messages going to the cloud, and hybrid structured
// output for the memory tool. Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeFirebaseSdk, firebasePanelOptions, InferenceMode } from "./fake-firebase.mjs";

async function firebasePanel({ route, jsonAnswer, remoteValues, cloudFails } = {}) {
  const { sdk, calls, publishRemoteValues } = fakeFirebaseSdk({ jsonAnswer, remoteValues, cloudFails });
  const panel = bootPanel(firebasePanelOptions(sdk, route ? { firebaseRoute: route } : {}));
  await until(() => panel.evaluate("activeBackend") === "firebase", "the Firebase provider");
  return { panel, calls, publishRemoteValues };
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
  for (const refused of ["gemini-nano-banana-2.1", "gemini-3.8-flash-tts", "gemini-3.1-flash-live-preview", "gemini-flash-latest", "gpt-4"]) {
    const { panel } = await firebasePanel({ route: "prefer-cloud", remoteValues: { cloud_model_fast: refused } });
    assert.equal(panel.evaluate("externalProvider.listModels().options[1].label"), "gemini-3.5-flash-lite",
      `Remote Config can't switch the chat to ${refused}`);
  }
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
  assert.equal(calls.liveWatchers, 0, "and opens no live Remote Config stream");
}

// ===================== REMOTE CONFIG: A CONSOLE PUBLISH REACHES THE OPEN PANEL =====================
{
  const { panel, calls, publishRemoteValues } = await firebasePanel({ route: "prefer-cloud" });
  assert.equal(calls.liveWatchers, 1, "a cloud route listens for Remote Config changes");
  await publishRemoteValues({ cloud_model_fast: "gemini-3.5-flash" });
  await until(() => panel.evaluate("externalProvider.listModels().options[1].label") === "gemini-3.5-flash", "the live model name");
  await until(() => /gemini-3\.5-flash(?!-)/.test(panel.evaluate("backendHint.textContent")), "the header hint redrawn");
  await panel.evaluate('sendMessage("Hi")');
  assert.equal(calls.streams.at(-1).params.inCloudParams.model, "gemini-3.5-flash", "the next answer uses the published name");
  assert.equal(calls.remoteConfigFetches, 1, "without a second fetch");

  await publishRemoteValues({ cloud_model_fast: "gemini-3.6-flash-preview" });
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  assert.equal(panel.evaluate("externalProvider.listModels().options[1].label"), "gemini-3.5-flash",
    "a live update is checked like a fetched one: a preview model is refused");
  await publishRemoteValues({ some_other_param: "x" });
  assert.equal(panel.evaluate("externalProvider.listModels().options[1].label"), "gemini-3.5-flash", "other parameters are ignored");

  panel.evaluate('localStorage.setItem("firebaseRoute", "device")');
  await panel.evaluate("reloadExternalProvider()");
  assert.equal(calls.liveStops, 1, "switching to On-device only closes the live stream");
  panel.evaluate('localStorage.setItem("firebaseRoute", "prefer-cloud")');
  await panel.evaluate("reloadExternalProvider()");
  assert.equal(calls.liveWatchers, 2, "and a cloud route opens it again");
}

// ===================== CLOUD FIRST: A FAILED CLOUD CALL IS NOT HIDDEN =====================
{
  // The real SDK answers on-device when "Cloud first" can't reach the cloud (App Check 403…).
  const { panel, calls } = await firebasePanel({ route: "prefer-cloud", cloudFails: true });
  await panel.evaluate('sendMessage("What is your name?")');
  assert.equal(calls.streams.at(-1).params.mode, InferenceMode.PREFER_IN_CLOUD);
  const chip = chips(panel).at(-1);
  assert.match(chip.textContent, /On-device · Gemini Nano · cloud failed/, "the chip says the cloud model did not answer");
  assert.match(chip.title, /App Check/, "and points at the usual cause");
  assert.match(panel.evaluate("tokenInfo.textContent"), /last answer: on-device \(Gemini Nano\) · cloud failed/);
}
{
  const { panel } = await firebasePanel({ route: "prefer-device" });
  await panel.evaluate('sendMessage("Hi")');
  assert.doesNotMatch(chips(panel).at(-1).textContent, /cloud failed/, "On-device first answering on the device is normal");
}

// ===================== FIRST LAUNCH: "PRIVATE ONLY" OR "HYBRID" =====================
// A first panel (nothing saved) asks before Firebase loads, so no request can happen first.
async function firstLaunchPanel() {
  const { sdk, calls } = fakeFirebaseSdk({ remoteValues: { cloud_model_fast: "gemini-3.6-flash-lite" } });
  const panel = bootPanel(firebasePanelOptions(sdk));
  await until(() => panel.element("#status-title").textContent === "How should MyLocalAI run?", "the first-launch question");
  // Wait a few more turns: if init() did not wait for the answer, the backend would start now.
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  assert.equal(panel.evaluate("activeBackend"), null, "no backend before the user picks");
  assert.equal(calls.apps, 0, "Firebase is not even initialized before the choice");
  assert.equal(calls.remoteConfigFetches, 0, "and nothing is fetched");
  return { panel, calls };
}
const stored = (panel, key) => panel.evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
{
  const { panel, calls } = await firstLaunchPanel();
  panel.element("#btn-launch-private").fire("click");
  await until(() => panel.evaluate("activeBackend") === "firebase", "the Firebase provider after Private only");
  assert.equal(panel.element("#firebase-launch-choice").classList.contains("hidden"), true, "the question goes away");
  assert.equal(stored(panel, "firebaseCloudSwitch"), "off", "Private only turns Cloud & internet off");
  assert.equal(stored(panel, "firebaseRoute"), "device");
  assert.equal(calls.remoteConfigFetches, 0, "Private only never asks Remote Config");
  await panel.evaluate('sendMessage("Hi")');
  assert.equal(calls.streams.at(-1).params.mode, InferenceMode.ONLY_ON_DEVICE, "answers stay on the device");
}
{
  const { panel, calls } = await firstLaunchPanel();
  panel.element("#btn-launch-hybrid").fire("click");
  await until(() => panel.evaluate("activeBackend") === "firebase", "the Firebase provider after Hybrid");
  assert.equal(stored(panel, "firebaseCloudSwitch"), "on", "Hybrid turns Cloud & internet on");
  assert.equal(stored(panel, "firebaseRoute"), "prefer-device", "Hybrid is on-device first, cloud fallback");
  assert.equal(calls.remoteConfigFetches, 1, "a cloud-capable route reads the model names");
  await panel.evaluate('sendMessage("Hi")');
  assert.equal(calls.streams.at(-1).params.mode, InferenceMode.PREFER_ON_DEVICE);
  panel.element("#btn-launch-private").fire("click");
  assert.equal(stored(panel, "firebaseRoute"), "prefer-device", "a stale button cannot change the answer later");
}
{
  // Panels from before this question keep their saved setting and are not asked.
  const { sdk } = fakeFirebaseSdk();
  const panel = bootPanel(firebasePanelOptions(sdk, { firebaseCloudSwitch: "on" }));
  await until(() => panel.evaluate("activeBackend") === "firebase", "the Firebase provider with a saved switch");
  assert.notEqual(panel.element("#status-title").textContent, "How should MyLocalAI run?", "an existing user is not asked again");
  assert.equal(stored(panel, "firebaseLaunchChoice"), null, "and no answer is invented for them");
}
