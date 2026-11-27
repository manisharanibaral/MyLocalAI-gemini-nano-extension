// Saving and reopening chats, run against the booted panel (fake browser, fake models).
// Part of tests/structure-checks.mjs. Each block reproduces one way a chat used to get lost.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeNano, fakeOllama } from "./fake-models.mjs";

const savedChats = (panel) => JSON.parse(panel.evaluate('localStorage.getItem("chatSessions")') || "[]");
// Values from the panel's realm, copied so assert.deepEqual compares them as plain data.
const valueOf = (panel, expression) => JSON.parse(panel.evaluate(`JSON.stringify(${expression})`));
const savedTexts = (chat) => chat.history.map((m) => `${m.role}: ${m.content}`);

async function send(panel, text) {
  await panel.evaluate(`sendMessage(${JSON.stringify(text)})`);
  await until(() => !panel.evaluate("isGenerating"), "the reply to finish");
}

// ===================== "APPLY & RESTART" KEEPS THE OLD CHAT =====================
{
  const panel = bootPanel({ globals: { fetch: fakeOllama().fetch } });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  await send(panel, "first chat");
  await panel.evaluate("restartSession()");
  await until(() => panel.evaluate("activeBackend") === "ollama", "Ollama after the restart");
  await send(panel, "second chat");

  const chats = savedChats(panel);
  assert.equal(chats.length, 2, "the restart starts a new chat instead of overwriting the old one");
  assert.deepEqual(chats.map((c) => c.history[0].content).sort(), ["first chat", "second chat"]);
}

// A full Nano context now stays in the same chat: see tests/panel/context-budget.mjs.

// ===================== A STOPPED REPLY IS SAVED =====================
{
  const nano = fakeNano({ answer: ["Partial answer"], waitForStop: true });
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  const sending = panel.evaluate('sendMessage("stop me")');
  await until(() => nano.streaming > 0, "the answer to start");
  panel.evaluate("stopGeneration()");
  await sending;

  const [chat] = savedChats(panel);
  assert.deepEqual(savedTexts(chat), ["user: stop me", "assistant: Partial answer"],
    "the question and what was written before Stop are both saved");
}
{
  const nano = fakeNano({ answer: [], waitForStop: true }); // stopped before any text
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  const sending = panel.evaluate('sendMessage("stopped at once")');
  await until(() => nano.streaming > 0, "the answer to start");
  panel.evaluate("stopGeneration()");
  await sending;
  assert.deepEqual(savedTexts(savedChats(panel)[0]), ["user: stopped at once"], "the first question is saved even with no answer");
}

// ===================== "NEW CHAT" DURING A REPLY =====================
{
  const nano = fakeNano({ answer: ["Old answer"], waitForStop: true });
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  const sending = panel.evaluate('sendMessage("old question")');
  await until(() => nano.streaming > 0, "the answer to start");
  await panel.evaluate("startNewChat()");
  await sending;

  assert.equal(panel.evaluate("chatHistory.length"), 0, "the new chat stays empty");
  const chats = savedChats(panel);
  assert.equal(chats.length, 1);
  assert.deepEqual(savedTexts(chats[0]), ["user: old question", "assistant: Old answer"], "the answer went to the chat it belongs to");
  assert.notEqual(chats[0].id, panel.evaluate("currentSessionId"));
}

// ===================== TWO WINDOWS =====================
{
  const panel = bootPanel({ globals: { fetch: fakeOllama().fetch } });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  await send(panel, "this window");
  // The panel in another window saves its own chat to the same storage.
  panel.evaluate(`localStorage.setItem("chatSessions", JSON.stringify([
    { id: "other-window", title: "x", history: [{ role: "user", content: "other window" }], timestamp: 1 },
    ...JSON.parse(localStorage.getItem("chatSessions")),
  ]))`);
  panel.fireWindowEvent("storage", { key: "chatSessions" });
  assert.equal(panel.evaluate("chatSessions.length"), 2, "History learns about the other window's chat");

  await send(panel, "this window again");
  const ids = savedChats(panel).map((c) => c.id);
  assert.ok(ids.includes("other-window"), "saving here keeps the other window's chat");
  assert.equal(ids.length, 2);

  panel.evaluate(`deleteConversation(${JSON.stringify(panel.evaluate("currentSessionId"))})`);
  assert.deepEqual(savedChats(panel).map((c) => c.id), ["other-window"], "deleting here keeps the other window's chat");
}

// ===================== NANO REMEMBERS A REOPENED CHAT =====================
{
  const nano = fakeNano({ answer: ["Paris"] });
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  await send(panel, "capital of France?");
  const id = panel.evaluate("currentSessionId");
  await panel.evaluate("startNewChat()");
  nano.appended.length = 0;

  panel.evaluate(`loadConversation(${JSON.stringify(id)})`);
  await until(() => nano.appended.length > 0, "the chat to be given back to Nano");
  assert.deepEqual(nano.appended[0], [
    { role: "user", content: "capital of France?" },
    { role: "assistant", content: "Paris" },
  ], "the reopened chat's turns go back into Nano's new session");
}
{
  const nano = fakeNano({ answer: ["fine"], canAppend: false }); // older Chrome: no append()
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  await send(panel, "hello");
  const id = panel.evaluate("currentSessionId");
  await panel.evaluate("startNewChat()");
  panel.evaluate(`loadConversation(${JSON.stringify(id)})`);
  const notes = () => panel.element("#messages").children.filter((el) => el.className === "msg-note");
  await until(() => notes().length === 1, "a note that Nano can't see the chat");
  assert.match(notes()[0].textContent, /can't see the earlier messages/);
}
{
  // Text that does not fit Nano's context is left out, oldest turns first.
  const panel = bootPanel({ globals: { LanguageModel: fakeNano().LanguageModel } });
  const kept = valueOf(panel, `newestTurnsWithin([
    { role: "user", content: "aaaa" }, { role: "assistant", content: "bbbb" }, { role: "user", content: "cc" }], 6)`);
  assert.deepEqual(kept.map((t) => t.content), ["bbbb", "cc"]);
}

// ===================== ENTER TWICE =====================
{
  const nano = fakeNano({ answer: ["once"], measureDelayMs: 30 });
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  await Promise.all([panel.evaluate('sendMessage("twice?")'), panel.evaluate('sendMessage("twice?")')]);
  assert.deepEqual(valueOf(panel, "chatHistory.map(m => m.content)"), ["twice?", "once"], "the message is sent once");
  assert.equal(nano.prompts, 1);
}
