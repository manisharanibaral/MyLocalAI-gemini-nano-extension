// Auto-compact: when a chat grows large its older messages are summarised by the model, the
// chat shows a "Chat compacted" note, and every backend is sent the summary plus the newest
// messages. Runs against the booted panel with fake models. Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeNano, fakeOllama } from "./fake-models.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (panel, code) => plain(panel.evaluate(code));
const turns = (count) => Array.from({ length: count }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
const savedChats = (...chats) => ({ chatSessions: JSON.stringify(chats.map((c) => ({ title: "t", timestamp: 1, ...c }))) });
const stored = (panel) => JSON.parse(panel.evaluate('localStorage.getItem("chatSessions")') || "[]");
const notes = (panel) => panel.element("#messages").children.filter((c) => c.className === "msg-note");
const compactNotes = (panel) => notes(panel).map((n) => n.children[0]).filter((c) => c?.className === "compact-note");

async function ollamaPanel(options = {}, storage = {}) {
  const ollama = fakeOllama(options);
  const panel = bootPanel({ globals: { fetch: ollama.fetch }, storage });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  return { ollama, panel };
}

// ===================== WHEN A CHAT IS LARGE ENOUGH, AND WHAT IS SUMMARISED =====================
{
  const { panel } = await ollamaPanel();
  const needs = (history) => panel.evaluate(`chatNeedsCompaction(${JSON.stringify(history)})`);
  assert.equal(needs(turns(20)), false, "20 short messages are not large yet");
  assert.equal(needs(turns(21)), true, "more than CHAT_COMPACT_AT_MESSAGES are");
  assert.equal(needs([...turns(4), { role: "user", content: "x".repeat(10001) }]), true, "so are more than CHAT_COMPACT_AT_CHARS");
  assert.equal(needs([{ role: "user", content: "x".repeat(20000) }, { role: "assistant", content: "ok" }]), false,
    "one huge exchange has nothing older to summarise");

  const compacted = call(panel, `turnsToCompact(${JSON.stringify(turns(22))})`).map((m) => m.content);
  assert.equal(compacted.length, 16, "the newest CHAT_COMPACT_KEEP_MESSAGES stay as they are");
  assert.equal(compacted.at(-1), "m15");
  const long = [...turns(10), { role: "user", content: "y".repeat(3000) }, { role: "assistant", content: "z".repeat(3000) }];
  assert.equal(call(panel, `turnsToCompact(${JSON.stringify(long)})`).length, 10,
    "long newest messages keep fewer, but always the latest question and answer");

  const parse = (text) => panel.evaluate(`parseCompactionSummary(${JSON.stringify(text)})`);
  assert.equal(parse('```json\n{"summary":"- a"}\n```'), "- a", "JSON in a code fence is read");
  assert.equal(parse("- plain text summary"), "- plain text summary", "a provider's plain text is the summary");
  assert.equal(parse('{"summary": 3}'), "", "a wrong field type is no summary");
  assert.equal(parse("{broken"), "", "broken JSON is no summary");
  assert.equal(parse('{"oops":'), "", "nor is cut-off JSON");
  assert.equal(parse(`{"summary":"${"s".repeat(3000)}"}`).length, panel.evaluate("CHAT_SUMMARY_MAX_CHARS"), "the summary is capped");

  const prompt = panel.evaluate(`buildCompactionPrompt("- old summary", ${JSON.stringify([
    { role: "user", content: "q".repeat(5000), images: ["A"] }, { role: "assistant", content: "answer" }])})`);
  assert.match(prompt, /Summary so far:\n- old summary/, "the previous summary is extended, not lost");
  assert.match(prompt, /User: q+…  ?\(1 image was shown earlier\.\)/, "long messages are cut and images only mentioned");
  assert.equal(prompt.includes("q".repeat(1501)), false);
  assert.equal(prompt.includes('"A"'), false, "image data never goes into the summary request");
}

// ===================== OLLAMA: A LARGE CHAT IS COMPACTED AFTER THE REPLY =====================
{
  const { ollama, panel } = await ollamaPanel({}, savedChats({ id: "c1", history: turns(20) }));
  panel.evaluate('loadConversation("c1")');
  await panel.evaluate('sendMessage("next")');

  assert.equal(ollama.summaryBodies.length, 1, "one summary request");
  const request = ollama.summaryBodies[0];
  assert.equal(request.stream, false);
  assert.equal(request.format.properties.summary.type, "string", "the reply is held to the summary schema");
  assert.match(request.messages[0].content, /User: m0\n\nAssistant: m1/, "the oldest messages are summarised");
  assert.equal(request.messages[0].content.includes("next"), false, "the newest messages are not");
  assert.equal(ollama.chatBodies.length, 1, "the summary request is not part of the chat");

  const history = call(panel, "chatHistory");
  assert.equal(history.length, 23, "every message stays in the chat, plus the summary");
  assert.equal(history.filter((m) => m.compacted).length, 16);
  assert.deepEqual(history[16], { role: "summary", content: "- Earlier the user asked about m-messages.", compactedCount: 16 },
    "the summary sits right after the newest message it covers");
  assert.equal(stored(panel)[0].history[16].role, "summary", "and is saved with the chat");

  const [note] = compactNotes(panel);
  assert.ok(note, "the user sees a compacted note");
  assert.match(note.children[0].textContent, /Chat compacted: the model now reads a summary of the 16 earlier messages/);
  assert.equal(note.children[1].textContent, "- Earlier the user asked about m-messages.", "with the summary one click away");

  await panel.evaluate('sendMessage("after")');
  const messages = ollama.chatBodies.at(-1).messages;
  assert.match(messages[0].content, /Summary of the earlier part of this chat:\n- Earlier the user asked about m-messages\.$/,
    "the next request carries the summary in its system message");
  assert.deepEqual(messages.slice(1).map((m) => m.content), ["m16", "m17", "m18", "m19", "next", "Hello there", "after"],
    "and only the messages after it");
  assert.equal(ollama.summaryBodies.length, 1, "a compacted chat is not compacted again right away");
}
{
  // A chat that never gets large is never summarised.
  const { ollama, panel } = await ollamaPanel();
  await panel.evaluate('sendMessage("hello")');
  assert.equal(ollama.summaryBodies.length, 0);
  assert.equal(compactNotes(panel).length, 0);
}

// ===================== A FAILED OR STOPPED SUMMARY =====================
{
  const { ollama, panel } = await ollamaPanel({ summaryCall: {} }, savedChats({ id: "c1", history: turns(20) }));
  panel.evaluate('loadConversation("c1")');
  await panel.evaluate('sendMessage("next")');
  assert.equal(ollama.summaryBodies.length, 1);
  assert.equal(call(panel, "chatHistory").some((m) => m.compacted || m.role === "summary"), false, "nothing is compacted");
  assert.match(notes(panel).at(-1).textContent, /Couldn't compact this chat/, "the user is told");

  await panel.evaluate('sendMessage("two")');
  await panel.evaluate('sendMessage("three")');
  assert.equal(ollama.summaryBodies.length, 1, "no retry on every message after a failure");
  await panel.evaluate('sendMessage("four")');
  assert.equal(ollama.summaryBodies.length, 2, "it tries again after CHAT_COMPACT_RETRY_MESSAGES more messages");
}
{
  const { ollama, panel } = await ollamaPanel();
  const chat = JSON.stringify({ id: "x", history: turns(22) });
  const compacted = await panel.evaluate(`(() => { const c = new AbortController(); c.abort(); return compactChatIfLarge(${chat}, c.signal); })()`);
  assert.equal(compacted, false, "Stop before it starts means no summary");
  assert.equal(ollama.summaryBodies.length, 0);
}

// ===================== REOPENING A COMPACTED CHAT =====================
{
  const history = [...turns(4).map((m) => ({ ...m, compacted: true })), { role: "summary", content: "- Trip to Goa.", compactedCount: 4 },
    { role: "user", content: "m4" }, { role: "assistant", content: "m5" }];
  const { ollama, panel } = await ollamaPanel({}, savedChats({ id: "c2", history }));
  panel.evaluate('loadConversation("c2")');
  const [note] = compactNotes(panel);
  assert.match(note.children[0].textContent, /summary of the 4 earlier messages/, "the reopened chat shows where it was compacted");

  await panel.evaluate('sendMessage("which beach?")');
  const messages = ollama.chatBodies.at(-1).messages;
  assert.match(messages[0].content, /- Trip to Goa\.$/);
  assert.deepEqual(messages.slice(1).map((m) => m.content), ["m4", "m5", "which beach?"], "compacted messages are not sent again");

  // The Firebase provider gets the same view: the summary entry, then the newer messages.
  assert.deepEqual(call(panel, "providerHistory(chatHistory)").map((m) => m.role + ":" + m.content).slice(0, 3),
    ["summary:- Trip to Goa.", "user:m4", "assistant:m5"]);
}

// ===================== GEMINI NANO: A FRESH SESSION WITH THE SUMMARY =====================
{
  const nano = fakeNano({ toolAnswer: '{"summary":"- Nano summary."}' });
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel }, storage: savedChats({ id: "c1", history: turns(20) }) });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  panel.evaluate('loadConversation("c1")');
  await until(() => nano.appended.length === 1, "the reopened chat's replay");
  assert.equal(nano.appended[0].length, 20, "before compacting, Nano gets every message back");

  await panel.evaluate('sendMessage("next")');
  const summaryPrompt = nano.toolPrompts.find((p) => p.options.responseConstraint?.properties?.summary);
  assert.ok(summaryPrompt, "Nano is asked for a summary, held to the schema");
  const replay = nano.appended.at(-1);
  assert.equal(replay[0].role, "user");
  assert.equal(replay[0].content, "Summary of the earlier part of this chat:\n- Nano summary.", "the new session starts with the summary");
  assert.deepEqual(replay.slice(1).map((t) => t.content), ["m16", "m17", "m18", "m19", "next", "ok"], "then the newest messages");
  assert.equal(compactNotes(panel).length, 1);

  // With little room the summary still goes in; older turns are the ones left out.
  // The summary block is 45 characters, which leaves 5: room for the two newest 2-character turns.
  const tight = call(panel, `nanoReplayTurns("- s", ${JSON.stringify(turns(6))}, 50)`);
  assert.equal(tight[0].isSummary, true);
  assert.deepEqual(tight.slice(1).map((t) => t.content), ["m4", "m5"]);
  assert.equal(call(panel, `nanoReplayTurns("- s", ${JSON.stringify(turns(2))}, 10)`).some((t) => t.isSummary), false,
    "a summary too big for the room is left out rather than overflowing Nano");
}
