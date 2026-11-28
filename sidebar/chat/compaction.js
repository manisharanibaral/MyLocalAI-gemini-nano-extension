// Auto-compact: when a chat grows large, the model summarises its older messages, and from
// then on the backends get that summary plus the newest messages. Without it the oldest
// messages are simply dropped once they no longer fit. Compacted messages stay in the chat
// and in History: only what the model reads gets shorter.
"use strict";

// History holds at most one summary message, { role: "summary", content, compactedCount },
// placed right after the newest message it covers; covered messages get compacted: true.
// Keeping both inside the history means saving, reopening and trimming a chat need nothing new.
const CHAT_SUMMARY_ROLE = "summary";

const CHAT_SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string", maxLength: CHAT_SUMMARY_MAX_CHARS } },
  required: ["summary"],
  additionalProperties: false,
};

// The chat and message count of the last failed summary (see compactionRecentlyFailed).
let lastCompactionFailure = null;

// ===================== WHAT THE MODEL IS SENT =====================
// { summary, turns }: the chat's summary ("" until it is compacted) and the user/assistant
// messages it does not cover, oldest first. Every backend builds its request from this.
function modelHistory(history) {
  const summary = history.find(m => m.role === CHAT_SUMMARY_ROLE);
  const turns = history.filter(m => (m.role === "user" || m.role === "assistant") && !m.compacted);
  return { summary: summary ? messageText(summary) : "", turns };
}

// How Nano and Ollama are given the summary (the Firebase prompt builder words its own).
function chatSummaryBlock(summary) {
  return `Summary of the earlier part of this chat:\n${summary}`;
}

// ===================== WHEN TO COMPACT =====================
function chatNeedsCompaction(history) {
  const { turns } = modelHistory(history);
  const chars = turns.reduce((sum, m) => sum + messageText(m).length, 0);
  const isLarge = chars > CHAT_COMPACT_AT_CHARS || turns.length > CHAT_COMPACT_AT_MESSAGES;
  // Fewer than two old messages are not worth an extra model call.
  return isLarge && turnsToCompact(turns).length >= 2;
}

// The older turns to fold into the summary. The newest ones stay as they are: at most
// CHAT_COMPACT_KEEP_MESSAGES within CHAT_COMPACT_KEEP_CHARS, but always the latest exchange,
// so the model still sees the question it just answered word for word.
function turnsToCompact(turns) {
  let keep = 0;
  let chars = 0;
  while (keep < turns.length && keep < CHAT_COMPACT_KEEP_MESSAGES) {
    chars += messageText(turns[turns.length - 1 - keep]).length;
    if (keep >= 2 && chars > CHAT_COMPACT_KEEP_CHARS) break;
    keep += 1;
  }
  return turns.slice(0, turns.length - keep);
}

function compactionRecentlyFailed(chat) {
  return lastCompactionFailure?.chatId === chat.id &&
    chat.history.length < lastCompactionFailure.length + CHAT_COMPACT_RETRY_MESSAGES;
}

// ===================== THE SUMMARY REQUEST =====================
// The previous summary goes in too, so each compaction extends it instead of losing it.
function buildCompactionPrompt(previousSummary, turns) {
  const transcript = turns
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${compactionTurnText(m)}`)
    .join("\n\n");
  return [
    "Summarise this chat so it can go on without the full messages.",
    "Keep the user's goals and questions, decisions and conclusions, and any facts, names, numbers, code or settings that later messages may refer to. Note what is still open.",
    `Leave out greetings and repetition. Write short bullet points, at most ${CHAT_SUMMARY_MAX_CHARS} characters in total.`,
    "",
    ...(previousSummary ? ["Summary so far:", previousSummary, ""] : []),
    "Messages:",
    `"""\n${transcript.slice(-CHAT_COMPACT_INPUT_CHARS)}\n"""`,
    "",
    'Reply with JSON only: {"summary":"..."}',
  ].join("\n");
}

// One message, cut to CHAT_COMPACT_TURN_CHARS; images are mentioned, never sent.
function compactionTurnText(message) {
  const text = messageText(message);
  const cut = text.length > CHAT_COMPACT_TURN_CHARS ? `${text.slice(0, CHAT_COMPACT_TURN_CHARS)}…` : text;
  return message.images?.length ? `${cut} ${earlierImagesNote(message.images.length)}` : cut;
}

// Nano and Ollama are held to the JSON schema; a provider only promises text, so a reply
// with no JSON in it is taken as the summary itself, while broken JSON is not.
// Returns "" when nothing usable came back.
function parseCompactionSummary(text) {
  const raw = String(text ?? "").trim();
  const match = /\{[\s\S]*\}/.exec(raw);
  let summary = raw.includes("{") ? "" : raw;
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed?.summary === "string") summary = parsed.summary;
    } catch (_) { }
  }
  return summary.trim().slice(0, CHAT_SUMMARY_MAX_CHARS);
}

// Marks the turns compacted and moves the one summary message to just after the newest of them.
function applyCompaction(history, compacted, summary) {
  compacted.forEach(m => { m.compacted = true; });
  const oldSummary = history.findIndex(m => m.role === CHAT_SUMMARY_ROLE);
  if (oldSummary >= 0) history.splice(oldSummary, 1);
  const message = { role: CHAT_SUMMARY_ROLE, content: summary, compactedCount: history.filter(m => m.compacted).length };
  history.splice(history.indexOf(compacted.at(-1)) + 1, 0, message);
  return message;
}

// ===================== AFTER A REPLY =====================
// sendMessage awaits this while its Send button is still blocked, so no message can be sent
// halfway through; Stop (signal) cancels it. If it fails, the chat goes on as before.
// Returns true when the chat was compacted.
async function compactChatIfLarge(chat, signal) {
  const answered = chat.history.at(-1)?.role === "assistant";
  if (!activeBackend || signal?.aborted || !answered) return false;
  if (!chatNeedsCompaction(chat.history) || compactionRecentlyFailed(chat)) return false;

  const { summary, turns } = modelHistory(chat.history);
  const compacted = turnsToCompact(turns);
  const note = chat.id === currentSessionId ? appendChatNote("🗜️ Compacting chat…") : null;
  let newSummary = "";
  try {
    const prompt = buildCompactionPrompt(summary, compacted);
    const answer = await askActiveBackendForJson(prompt, CHAT_SUMMARY_SCHEMA, { timeoutMs: CHAT_COMPACT_TIMEOUT_MS, signal });
    newSummary = parseCompactionSummary(answer);
  } catch (err) {
    console.warn("[MyLocalAI] Could not compact the chat:", err.message);
  }
  if (!newSummary) {
    reportCompactionFailure(chat, note, signal?.aborted);
    return false;
  }

  const summaryMessage = applyCompaction(chat.history, compacted, newSummary);
  saveConversation(chat.id, chat.history);
  note?.replaceChildren(createCompactDetails(summaryMessage));
  if (chat.id === currentSessionId) await giveNanoCompactedChat(chat.history);
  return true;
}

// Stopping is the user's choice, so the next reply tries again; a real failure waits a while.
function reportCompactionFailure(chat, note, stopped) {
  if (!stopped) lastCompactionFailure = { chatId: chat.id, length: chat.history.length };
  if (note) {
    note.textContent = stopped
      ? "🗜️ Compacting stopped."
      : "🗜️ Couldn't compact this chat. The oldest messages are left out when it gets too long.";
  }
}

// Nano still holds the whole chat in its session, so it gets a fresh one with the summary and
// the newest messages: that is what frees its small context window.
async function giveNanoCompactedChat(history) {
  if (activeBackend !== "nano" || !session) return;
  try {
    await resetNanoChat();
    showNanoMemoryNote(await restoreNanoContext(history));
  } catch (err) {
    console.warn("[MyLocalAI] Could not give Nano the compacted chat:", err.message);
  }
  updateTokenInfo();
}
