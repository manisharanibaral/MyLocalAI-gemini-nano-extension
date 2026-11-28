// The system prompt, saved prompts, instant settings and privacy wording, run against the
// booted panel. Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeNano, fakeOllama } from "./fake-models.mjs";

async function ollamaPanel({ storage = {}, globals = {} } = {}) {
  const ollama = fakeOllama();
  const panel = bootPanel({ globals: { fetch: ollama.fetch, ...globals }, storage });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  return { ollama, panel };
}
const stored = (panel, key) => panel.evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
const systemPromptSent = (ollama) => ollama.chatBodies.at(-1).messages[0].content;
// The applied prompt, before the line naming the model (modelIdentityLine) that every backend adds.
const userPart = (systemPrompt) => systemPrompt.split("\n\nAbout you:")[0];

// ===================== "RESPONSES AT ONCE" SAVES ONLY ITSELF =====================
{
  const { panel } = await ollamaPanel({ storage: { sysPrompt: "Applied prompt." } });
  panel.element("#sys-prompt").value = "Half-typed, not applied";
  const [one, two] = panel.evaluate("[...responseCountInputs]");
  one.checked = false;
  two.checked = true;
  two.fire("change");
  assert.equal(stored(panel, "responseCount"), "2", "the new count is saved");
  assert.equal(stored(panel, "sysPrompt"), "Applied prompt.", "an unapplied prompt edit is not saved with it");
}

// ===================== THE SYSTEM PROMPT TAKES EFFECT ON APPLY, FOR EVERY BACKEND =====================
{
  const { ollama, panel } = await ollamaPanel({
    storage: { sysPrompt: "Be formal.", savedPromptList: JSON.stringify([{ name: "Brief", content: "Be brief." }]) },
  });
  panel.element("#saved-prompts").fire("change", { target: { value: "Be brief." } });
  assert.equal(panel.element("#sys-prompt").value, "Be brief.", "picking a saved prompt fills the box");
  assert.equal(stored(panel, "sysPrompt"), "Be formal.", "picking alone does not apply it");
  await panel.evaluate('sendMessage("hi")');
  assert.equal(userPart(systemPromptSent(ollama)), "Be formal.", "Ollama keeps the applied prompt until Apply");

  panel.element("#btn-apply-settings").fire("click");
  await until(() => ollama.connects === 2 && panel.evaluate("activeBackend") === "ollama", "the restart");
  assert.equal(stored(panel, "sysPrompt"), "Be brief.", "Apply saves the prompt");
  await panel.evaluate('sendMessage("hi again")');
  assert.equal(userPart(systemPromptSent(ollama)), "Be brief.", "after Apply the picked prompt is used");
}
{
  const created = [];
  const nano = fakeNano();
  const LanguageModel = { ...nano.LanguageModel, create: async (options) => { created.push(options); return nano.LanguageModel.create(); } };
  const panel = bootPanel({ globals: { LanguageModel }, storage: { sysPrompt: "Nano rules." } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  assert.equal(userPart(created[0].initialPrompts[0].content), "Nano rules.", "Nano's session gets the applied prompt");
  panel.element("#sys-prompt").value = "Unapplied";
  await panel.evaluate("restartSession()");
  assert.equal(userPart(created.at(-1).initialPrompts[0].content), "Nano rules.", "only Apply (which saves first) changes Nano's prompt");
}

// ===================== THE MODEL KNOWS WHICH MODEL IT IS =====================
// Without this line it called itself only "MyLocalAI" and denied being a Google model.
{
  const { ollama, panel } = await ollamaPanel({ storage: { sysPrompt: "Be formal.", ollamaModel: "llama3.2:3b" } });
  await panel.evaluate('sendMessage("which model are you?")');
  assert.match(systemPromptSent(ollama), /\n\nAbout you: .*the model answering is llama3\.2:3b, running locally through Ollama/,
    "Ollama's prompt names the chosen Ollama model, after a custom prompt too");
  assert.match(systemPromptSent(ollama), /If asked what model you are or who made you, say so plainly\./);
  assert.equal(panel.evaluate("getSystemPrompt()").includes("About you:"), false,
    "without a backend (what providers get) there is no line, so a hybrid provider can add its own per side");
}
{
  const created = [];
  const nano = fakeNano();
  const LanguageModel = { ...nano.LanguageModel, create: async (options) => { created.push(options); return nano.LanguageModel.create(); } };
  const panel = bootPanel({ globals: { LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  assert.match(created[0].initialPrompts[0].content, /the model answering is Gemini Nano, Google's on-device model built into Chrome/,
    "Nano's session is told it is Gemini Nano");
}

// ===================== DELETING ONE SAVED PROMPT =====================
{
  const prompts = [{ name: "Brief", content: "Be brief." }, { name: "Code", content: "Write code." }];
  const { panel } = await ollamaPanel({
    storage: { savedPromptList: JSON.stringify(prompts) },
    globals: { confirm: () => true, alert() { } },
  });
  panel.element("#saved-prompts").value = "Write code.";
  panel.element("#btn-delete-prompt").fire("click");
  assert.deepEqual(JSON.parse(stored(panel, "savedPromptList")).map((p) => p.name), ["Brief"], "only the picked prompt is deleted");
  assert.equal(panel.evaluate("savedPromptList.length"), 1);
}
{
  let alerted = "";
  const { panel } = await ollamaPanel({
    storage: { savedPromptList: JSON.stringify([{ name: "Brief", content: "Be brief." }]) },
    globals: { confirm: () => true, alert: (text) => { alerted = text; } },
  });
  panel.element("#saved-prompts").value = "";
  panel.element("#btn-delete-prompt").fire("click");
  assert.match(alerted, /Pick a saved prompt/, "with nothing picked, nothing is deleted");
  assert.equal(panel.evaluate("savedPromptList.length"), 1);
}

// ===================== PRIVACY CLAIMS MATCH WHERE MESSAGES GO =====================
{
  const { panel } = await ollamaPanel();
  assert.match(panel.element("#backend-hint").textContent, /100% local/);
  assert.equal(panel.evaluate("answersStayOnDevice()"), true);
  assert.match(panel.evaluate("tabAccessNeededMessage()"), /stays on your device/);
}
{
  const { panel } = await ollamaPanel({ storage: { ollamaUrl: "http://192.168.1.20:11434" } });
  assert.equal(/100% local/.test(panel.element("#backend-hint").textContent), false, "a remote Ollama is not called local");
  assert.match(panel.element("#backend-hint").textContent, /on 192\.168\.1\.20:11434/);
  assert.equal(panel.evaluate("answersStayOnDevice()"), false);
  assert.equal(/stays on your device/.test(panel.evaluate("tabAccessNeededMessage()")), false, "no privacy promise off-device");
}
{
  const { panel } = await ollamaPanel({ storage: { ollamaModel: "kimi-k2:cloud" } });
  assert.equal(panel.evaluate("answersStayOnDevice()"), false, "Ollama cloud models leave the device");
}
{
  const panel = bootPanel({ globals: { LanguageModel: fakeNano().LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  assert.equal(panel.evaluate("answersStayOnDevice()"), true, "Gemini Nano stays on the device");
}
