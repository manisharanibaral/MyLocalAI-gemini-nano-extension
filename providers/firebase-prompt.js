/**
 * MyLocalAI — Firebase AI Logic: multi-turn chat → one prompt.
 *
 * Firebase on-device inference is single-turn, so earlier turns are folded into one prompt.
 * Pure functions with no Firebase calls; providers/firebase-backend.js uses them and re-exports
 * buildConversationPrompt for the tests.
 */
(() => {
  "use strict";

  // On-device Gemini Nano accepts about 9k tokens; ~12k characters of history (~3k tokens)
  // leaves room for the system prompt, page context and the answer.
  // 20 messages matches the point where the panel compacts a chat (CHAT_COMPACT_AT_MESSAGES).
  const MAX_HISTORY_MESSAGES = 20;
  const MAX_HISTORY_CHARS = 12000;

  // chatHistory entries are { role: "user"|"assistant", content, images? }. Images are sent
  // separately (the backend's buildRequest), never as text. The last entry is the message being answered.
  // A compacted chat also has one { role: "summary", content } entry for its older messages;
  // it always goes in, before the turns (which the budget may trim).
  function buildConversationPrompt(history) {
    const turns = history
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.compacted)
      .map((m) => ({ role: m.role, text: String(m.content ?? "").trim() }));
    const current = turns.pop();
    if (!current) return "";
    const summary = String(history.find((m) => m.role === "summary")?.content ?? "").trim();
    const earlier = recentTurnsWithinBudget(turns);
    const context = [
      ...(summary ? ["Summary of the earlier conversation:", summary, ""] : []),
      ...(earlier.length
        ? ["Conversation so far (oldest first):", ...earlier.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`), ""]
        : []),
    ];
    if (context.length === 0) return current.text;
    return [...context, "Reply to the user's latest message:", current.text].join("\n");
  }

  // Keeps the newest turns that fit both limits; older turns are dropped first.
  function recentTurnsWithinBudget(turns) {
    const kept = [];
    let chars = 0;
    for (let i = turns.length - 1; i >= 0 && kept.length < MAX_HISTORY_MESSAGES; i--) {
      chars += turns[i].text.length;
      if (chars > MAX_HISTORY_CHARS) break;
      kept.unshift(turns[i]);
    }
    return kept;
  }

  // Each side of the hybrid model gets a line naming itself, so an answer says which model
  // really wrote it (the cloud one otherwise denies being a Google model). Same wording as
  // the sidebar's modelIdentityLine for Nano and Ollama.
  const IDENTITY_PREFIX = "About you: MyLocalAI is this Chrome extension; the model answering is";
  const IDENTITY_SUFFIX = "If asked what model you are or who made you, say so plainly.";

  function withCloudIdentity(systemPrompt, modelName) {
    return joinPrompt(systemPrompt, `${IDENTITY_PREFIX} ${modelName}, a Google Gemini model running in Google's cloud through Firebase AI Logic. ${IDENTITY_SUFFIX}`);
  }

  function withDeviceIdentity(systemPrompt) {
    return joinPrompt(systemPrompt, `${IDENTITY_PREFIX} Google's on-device model built into Chrome, run through Firebase AI Logic, so chats stay on this device. ${IDENTITY_SUFFIX}`);
  }

  function joinPrompt(systemPrompt, line) {
    return [String(systemPrompt ?? "").trim(), line].filter(Boolean).join("\n\n");
  }

  window.MyLocalAIFirebasePrompt = { buildConversationPrompt, withCloudIdentity, withDeviceIdentity };
})();
