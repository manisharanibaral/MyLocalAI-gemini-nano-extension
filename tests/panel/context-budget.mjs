// Keeping each request inside the model's memory: Ollama gets images only with the newest
// message, history that fits a token budget, num_ctx, the thinking switch and real token
// counts in the footer; a full Nano context is trimmed in the same chat.
// Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeNano, fakeOllama } from "./fake-models.mjs";

const savedChats = (panel) => JSON.parse(panel.evaluate('localStorage.getItem("chatSessions")') || "[]");
const lastBody = (ollama) => ollama.chatBodies.at(-1);

async function send(panel, text) {
  await panel.evaluate(`sendMessage(${JSON.stringify(text)})`);
  await until(() => !panel.evaluate("isGenerating"), "the reply to finish");
}

async function ollamaPanel(options = {}, storage = {}) {
  const ollama = fakeOllama(options);
  const panel = bootPanel({ globals: { fetch: ollama.fetch }, storage });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  return { ollama, panel };
}

async function nanoPanel() {
  const nano = fakeNano({ answer: ["ok"] });
  const panel = bootPanel({ globals: { LanguageModel: nano.LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  return { nano, panel };
}

// ===================== OLLAMA: OLD IMAGES ARE NOT SENT AGAIN =====================
{
  const { ollama, panel } = await ollamaPanel();
  panel.evaluate(`chatHistory.push({ role: "user", content: "this page", images: ["QQ==", "Qg=="] },
    { role: "assistant", content: "It is a recipe." })`);
  await send(panel, "and the oven temperature?");
  const [, earlier, , latest] = lastBody(ollama).messages;
  assert.equal(earlier.images, undefined, "the earlier screenshot is not uploaded again");
  assert.equal(earlier.content, "this page\n\n(2 images were shown earlier.)", "the model is told images were shown");
  assert.equal(latest.content, "and the oven temperature?");
  assert.equal(panel.evaluate("chatHistory[0].images.length"), 2, "the saved chat still has its images");
}

// ===================== OLLAMA: HISTORY FITS THE BUDGET, AND num_ctx IS SET =====================
{
  const { ollama, panel } = await ollamaPanel();
  panel.evaluate(`for (let i = 0; i < 40; i++) chatHistory.push(
    { role: i % 2 ? "assistant" : "user", content: "turn " + i + " " + "x".repeat(3000) })`);
  await send(panel, "latest question");
  const { messages, options } = lastBody(ollama);
  const contextTokens = panel.evaluate("OLLAMA_CONTEXT_TOKENS");

  assert.equal(options.num_ctx, contextTokens, "the context size is chosen, not left to Ollama's default");
  assert.equal(messages[0].role, "system", "the system prompt always comes first");
  assert.equal(messages.at(-1).content, "latest question", "the new message is always sent");
  assert.ok(messages.length < 42, "older turns that do not fit are left out");
  assert.match(messages.at(-2).content, /^turn 39 /, "the newest earlier turns are the ones kept");
  const sentChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const charsPerToken = panel.evaluate("CHARS_PER_TOKEN");
  assert.ok(sentChars / charsPerToken + options.num_predict <= contextTokens, "prompt and reply fit in num_ctx");
}

// ===================== OLLAMA: THINKING SWITCH =====================
{
  const { ollama, panel } = await ollamaPanel({ capabilities: ["thinking"] });
  await send(panel, "quick one");
  assert.equal(lastBody(ollama).think, false, "thinking is off by default, and said so, since Ollama would think otherwise");
  assert.equal(lastBody(ollama).options.num_predict, 1500, "no thinking means no extra token allowance");

  panel.element("#ollama-thinking").value = "on";
  panel.evaluate("saveOllamaThinkingSetting()");
  await send(panel, "hard one");
  assert.equal(lastBody(ollama).think, true, "turning it on applies from the next message");
  assert.equal(lastBody(ollama).options.num_predict, 1500 + panel.evaluate("THINKING_TOKEN_ALLOWANCE"));
  assert.equal(panel.evaluate('localStorage.getItem("ollamaThinking")'), "on", "the choice is remembered");
}
{
  const { ollama, panel } = await ollamaPanel({ capabilities: ["thinking"] }, { ollamaThinking: "on" });
  await send(panel, "hi");
  assert.equal(lastBody(ollama).think, true, "a saved On is loaded at start");
}
{
  const { ollama, panel } = await ollamaPanel({}, { ollamaThinking: "on" });
  await send(panel, "hi");
  assert.equal("think" in lastBody(ollama), false, "a model that cannot think gets no think flag, whatever the setting");
}

// ===================== OLLAMA: REAL TOKEN COUNTS IN THE FOOTER =====================
{
  const { panel } = await ollamaPanel({ usage: { input: 1840, output: 320 } });
  panel.evaluate("updateTokenInfo()");
  assert.match(panel.element("#token-info").textContent, /^0 messages$/, "before any reply the footer counts messages");
  await send(panel, "hi");
  assert.equal(panel.element("#token-info").textContent, "1,840 in · 320 out tokens");
  await panel.evaluate("startNewChat()");
  panel.evaluate("updateTokenInfo()");
  assert.equal(panel.element("#token-info").textContent, "0 messages", "another chat does not show these counts");
}

// ===================== NANO: A FULL CONTEXT IS TRIMMED IN THE SAME CHAT =====================
{
  const { nano, panel } = await nanoPanel();
  await send(panel, "short question");
  const chatId = panel.evaluate("currentSessionId");
  panel.evaluate("session.contextUsage = 8995"); // 5 of 9,000 tokens left
  nano.promptTokens = 100;
  await send(panel, "next question");

  assert.equal(panel.evaluate("currentSessionId"), chatId, "the chat continues instead of a new one starting");
  assert.equal(nano.prompts, 2, "the message is sent, not left for the user to send again");
  assert.deepEqual(nano.appended.at(-1).map((t) => t.content), ["short question", "ok"],
    "the fresh session gets back the newest turns that fit");
  const chats = savedChats(panel);
  assert.equal(chats.length, 1, "still one chat");
  assert.deepEqual(chats[0].history.map((m) => m.content), ["short question", "ok", "next question", "ok"]);
}
{
  const { nano, panel } = await nanoPanel();
  await send(panel, "short question");
  nano.promptTokens = 10_000; // more than the whole 9,000-token window
  // The fake page renders no Markdown, so record the text of the messages the panel shows.
  panel.evaluate(`var shownTexts = []; var showMessage = appendMessage;
    appendMessage = (role, text, ...rest) => { shownTexts.push(text); return showMessage(role, text, ...rest); }`);
  await send(panel, "huge question");

  assert.equal(nano.prompts, 1, "a prompt that can never fit is not sent");
  assert.equal(savedChats(panel).length, 1, "no new chat is started");
  assert.deepEqual(JSON.parse(panel.evaluate("JSON.stringify(chatHistory.map((m) => m.content))")), ["short question", "ok"]);
  assert.match(panel.evaluate("shownTexts.join()"), /too long for Gemini Nano/, "the user is told to shorten it");
}
