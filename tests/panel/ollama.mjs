// The Ollama backend, run against the booted panel with a fake Ollama server.
// Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeOllama } from "./fake-models.mjs";

const savedChats = (panel) => JSON.parse(panel.evaluate('localStorage.getItem("chatSessions")') || "[]");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ollamaPanel(options) {
  const ollama = fakeOllama(options);
  const panel = bootPanel({ globals: { fetch: ollama.fetch } });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  return { ollama, panel };
}

// Fails the test instead of hanging when a reply never ends.
function withinOneSecond(promise, what) {
  return Promise.race([promise, pause(1000).then(() => { throw new Error(`${what} never finished`); })]);
}

// ===================== STOP WORKS ONCE THE REPLY HAS STARTED =====================
{
  const { ollama, panel } = await ollamaPanel({ answer: ["Half ", "an answer"], waitForStop: true });
  const sending = panel.evaluate('sendMessage("long question")');
  await until(() => ollama.chatBodies.length === 1, "the request to Ollama");
  await pause(20); // let the first frames arrive, as in a reply that is streaming
  panel.evaluate("stopGeneration()");
  await withinOneSecond(sending, "the stopped Ollama reply");

  assert.equal(panel.evaluate("isGenerating"), false, "Stop ends the reply");
  const [chat] = savedChats(panel);
  assert.deepEqual(chat.history.map((m) => m.content), ["long question", "Half an answer"], "what was written before Stop is saved");
}

// ===================== "NEW CHAT" DURING AN OLLAMA REPLY =====================
{
  const { ollama, panel } = await ollamaPanel({ answer: ["Old answer"], waitForStop: true });
  const sending = panel.evaluate('sendMessage("old question")');
  await until(() => ollama.chatBodies.length === 1, "the request to Ollama");
  await pause(20);
  await panel.evaluate("startNewChat()");
  await withinOneSecond(sending, "the interrupted Ollama reply");

  assert.equal(panel.evaluate("chatHistory.length"), 0, "the old answer does not land in the new chat");
  assert.deepEqual(savedChats(panel)[0].history.map((m) => m.content), ["old question", "Old answer"]);
}

// ===================== TYPED "__IMG__" STAYS TEXT =====================
{
  const { ollama, panel } = await ollamaPanel();
  await panel.evaluate('sendMessage("what does __IMG__ mean?")');
  const sent = ollama.chatBodies[0].messages.at(-1);
  assert.equal(sent.content, "what does __IMG__ mean?");
  assert.equal(sent.images, undefined, "no image is made out of typed text");
}

// ===================== CHATS SAVED IN THE OLD IMAGE FORMAT STILL OPEN =====================
{
  const { ollama, panel } = await ollamaPanel();
  panel.evaluate(`localStorage.setItem("chatSessions", JSON.stringify([{ id: "legacy", title: "t", timestamp: 1,
    history: [{ role: "user", content: "look__IMG__QUFB" }, { role: "assistant", content: "a cat" }] }]))`);
  panel.evaluate("loadSessions()");
  panel.evaluate('loadConversation("legacy")');
  await panel.evaluate('sendMessage("and now?")');
  const [first] = ollama.chatBodies[0].messages.slice(1);
  assert.deepEqual([first.content, first.images], ["look", ["QUFB"]], "the old image is sent as an image again");
}

// ===================== UNKNOWN MODEL IS FLAGGED =====================
{
  const { panel } = await ollamaPanel({ models: ["llama3:8b"], knowsModel: false });
  assert.equal(panel.evaluate("isOllamaModelValid"), false);
  assert.match(panel.element("#header-badge").textContent, /not found in Ollama/, "the header warns about the model");
}
{
  const { panel } = await ollamaPanel();
  assert.doesNotMatch(panel.element("#header-badge").textContent, /not found/, "a model Ollama has gets no warning");
}
