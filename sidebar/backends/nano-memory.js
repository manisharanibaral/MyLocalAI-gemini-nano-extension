// Putting a saved chat back into Gemini Nano's memory.
"use strict";

// Nano remembers a conversation only inside its session. A reopened chat, or the same chat
// after the model was reloaded, starts in a new session, so the chat's recent turns are
// added back with append(). Images are left out: they take far more context than text.
// reserveTokens keeps room for a prompt about to be sent (see makeRoomInNano).
// Returns { kept, total } messages so the caller can tell the user what Nano still knows.
async function restoreNanoContext(history, reserveTokens = 0) {
  const turns = history
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({ role: m.role, content: messageText(m) }))
    .filter(t => t.content.trim());
  if (turns.length === 0 || !session) return { kept: 0, total: 0 };
  if (typeof session.append !== "function") return { kept: 0, total: turns.length };

  const kept = newestTurnsWithin(turns, nanoReplayBudgetChars(reserveTokens));
  if (kept.length === 0) return { kept: 0, total: turns.length };
  try {
    await session.append(kept);
    updateTokenInfo();
    return { kept: kept.length, total: turns.length };
  } catch (err) {
    console.warn("[MyLocalAI] Could not give Nano the earlier messages:", err.message);
    return { kept: 0, total: turns.length };
  }
}

// About half of the free context (after reserveTokens), at ~4 characters per token, so the
// next messages still fit.
function nanoReplayBudgetChars(reserveTokens = 0) {
  return Math.max(0, nanoWindow() - nanoUsed() - reserveTokens) * 2;
}

// Keeps the newest turns whose text fits in budgetChars; older turns are dropped first.
// Also used for Ollama's history (ollama-request.js).
function newestTurnsWithin(turns, budgetChars) {
  const kept = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    used += turns[i].content.length;
    if (used > budgetChars) break;
    kept.unshift(turns[i]);
  }
  return kept;
}

// Says so when Nano could not get the whole chat back, since it then "forgets" those messages.
function showNanoMemoryNote(memory) {
  const { kept, total } = memory || {};
  if (!total || kept === total) return;
  appendChatNote(kept === 0
    ? "Gemini Nano can't see the earlier messages of this chat. It continues from here."
    : `Gemini Nano remembers only the last ${kept} of the ${total} earlier messages of this chat.`);
}
