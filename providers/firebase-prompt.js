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
  const MAX_HISTORY_MESSAGES = 10;
  const MAX_HISTORY_CHARS = 12000;

  // chatHistory entries are { role: "user"|"assistant", content, images? }. Images are sent
  // separately (the backend's buildRequest), never as text. The last entry is the message being answered.
  function buildConversationPrompt(history) {
    const turns = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: String(m.content ?? "").trim() }));
    const current = turns.pop();
    if (!current) return "";
    const earlier = recentTurnsWithinBudget(turns);
    if (earlier.length === 0) return current.text;
    return [
      "Conversation so far (oldest first):",
      ...earlier.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`),
      "",
      "Reply to the user's latest message:",
      current.text,
    ].join("\n");
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

  window.MyLocalAIFirebasePrompt = { buildConversationPrompt };
})();
