// Long selections are capped before they reach the model, and "Answer length" reaches every
// backend: a token cap where one exists, a hint in the system prompt for all of them.
// Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeNano, fakeOllama } from "./fake-models.mjs";

async function ollamaPanel({ storage = {}, models } = {}) {
  const ollama = fakeOllama(models ? { models } : {});
  const panel = bootPanel({ globals: { fetch: ollama.fetch }, storage });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  return { ollama, panel };
}
const lastBody = (ollama) => ollama.chatBodies.at(-1);
const lastUserMessage = (ollama) => lastBody(ollama).messages.at(-1).content;

// ===================== A LONG SELECTION IS CAPPED, AND THE USER IS TOLD =====================
{
  const { ollama, panel } = await ollamaPanel();
  const max = panel.evaluate("MAX_CONTEXT_CHARS");
  const article = "lorem ipsum ".repeat(2000); // 24,000 characters, like a whole selected page
  panel.evaluate(`setContextFromSelection(${JSON.stringify(article)})`);

  assert.ok(panel.evaluate("currentContextText.length") <= max, "only the first MAX_CONTEXT_CHARS are kept");
  const note = panel.element("#context-note");
  assert.equal(note.classList.contains("hidden"), false, "the card says the text was cut");
  assert.match(note.textContent, /first [\d,.\s]+ of 23[,.\s]?999 characters/, "the note gives both sizes");
  assert.ok(panel.element("#context-text").title.length <= max, "the hover text is the capped text, not the whole page");

  await panel.evaluate('sendMessage("summarise")');
  const sent = lastUserMessage(ollama);
  assert.match(sent, /^Context \(the first \d+ of 23999 characters of the selected text\):/, "the model is told it sees only the start");
  assert.ok(sent.length < max + 200, "the prompt holds the capped text only");
  assert.equal(note.classList.contains("hidden"), true, "sending clears the note with the card");
}
{
  const { ollama, panel } = await ollamaPanel();
  panel.evaluate('setContextFromSelection("a short quote")');
  assert.equal(panel.element("#context-note").classList.contains("hidden"), true, "a short selection shows no note");
  await panel.evaluate('sendMessage("explain")');
  assert.match(lastUserMessage(ollama), /^Context:\n"""\na short quote\n"""/, "a short selection is sent as before");
}

// ===================== ANSWER LENGTH: OLLAMA =====================
{
  const { ollama, panel } = await ollamaPanel();
  await panel.evaluate('sendMessage("hi")');
  assert.equal(lastBody(ollama).options.num_predict, 1500, "Normal is the default cap");
  assert.equal(lastBody(ollama).messages[0].content, panel.evaluate('`${DEFAULT_SYSTEM_PROMPT}\\n\\n${modelIdentityLine("ollama")}`'), "Normal adds no hint");
}
{
  const { ollama, panel } = await ollamaPanel({ storage: { answerLength: "short", sysPrompt: "Be formal." } });
  await panel.evaluate('sendMessage("hi")');
  assert.equal(lastBody(ollama).options.num_predict, 400, "Short caps the reply");
  assert.match(lastBody(ollama).messages[0].content, /^Be formal\.\n\nKeep every answer short/, "a custom prompt gets the hint too");
}
{
  const { ollama, panel } = await ollamaPanel({ storage: { answerLength: "long" } });
  await panel.evaluate('sendMessage("hi")');
  assert.equal("num_predict" in lastBody(ollama).options, false, "Long leaves the model's own limit");
  assert.match(lastBody(ollama).messages[0].content, /thorough, detailed answers/);
}
{
  const { ollama, panel } = await ollamaPanel({ storage: { answerLength: "huge" } });
  await panel.evaluate('sendMessage("hi")');
  assert.equal(lastBody(ollama).options.num_predict, 1500, "an unknown saved value falls back to Normal");
}
{
  // Thinking is on by default; the test saves it explicitly so it doesn't depend on that default.
  const { ollama, panel } = await ollamaPanel({ storage: { answerLength: "short", ollamaThinking: "on" } });
  panel.evaluate("modelSupportsThinking = true");
  await panel.evaluate('sendMessage("hi")');
  assert.equal(lastBody(ollama).options.num_predict, 400 + panel.evaluate("THINKING_TOKEN_ALLOWANCE"),
    "a thinking model gets room to reason before the answer");
}

// ===================== ANSWER LENGTH TAKES EFFECT ON APPLY =====================
{
  const { ollama, panel } = await ollamaPanel();
  panel.element("#answer-length").value = "short";
  await panel.evaluate('sendMessage("before apply")');
  assert.equal(lastBody(ollama).options.num_predict, 1500, "picking alone changes nothing");
  assert.equal(panel.evaluate('localStorage.getItem("answerLength")'), null, "and saves nothing");

  panel.element("#btn-apply-settings").fire("click");
  await until(() => ollama.connects === 2 && panel.evaluate("activeBackend") === "ollama", "the restart");
  assert.equal(panel.evaluate('localStorage.getItem("answerLength")'), "short", "Apply saves it");
  await panel.evaluate('sendMessage("after apply")');
  assert.equal(lastBody(ollama).options.num_predict, 400, "after Apply the new length is used");
}

// ===================== ANSWER LENGTH: GEMINI NANO AND PROVIDERS =====================
{
  const created = [];
  const nano = fakeNano();
  const LanguageModel = { ...nano.LanguageModel, create: async (options) => { created.push(options); return nano.LanguageModel.create(); } };
  const panel = bootPanel({ globals: { LanguageModel }, storage: { answerLength: "short" } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  assert.match(created[0].initialPrompts[0].content, /Keep every answer short/, "Nano has no token cap, so the prompt asks for brevity");
  assert.equal("maxTokens" in created[0], false, "nothing unknown is passed to Chrome's create()");

  assert.equal(panel.evaluate("providerRequestSettings().maxOutputTokens"), 400, "providers (Firebase) get the cap");
  assert.match(panel.evaluate("providerRequestSettings().systemPrompt"), /Keep every answer short/, "and the hint for on-device");
}
