// Saved chats in localStorage.
"use strict";

// ===================== CONVERSATION STORAGE =====================
function loadSessions() {
  try {
    const saved = localStorage.getItem("chatSessions");
    if (saved) {
      chatSessions = JSON.parse(saved) || [];
    } else {
      // Migration: Check for old single-chat format
      const oldSaved = localStorage.getItem("chatHistory");
      if (oldSaved) {
        const oldHistory = JSON.parse(oldSaved);
        if (oldHistory && oldHistory.length > 0) {
          chatSessions = [{
            // Own id, not currentSessionId: the fresh chat opened at startup uses that
            // one and would overwrite the migrated history on its first save.
            id: `migrated-${Date.now()}`,
            title: extractTitle(oldHistory),
            history: oldHistory,
            timestamp: Date.now()
          }];
          localStorage.removeItem("chatHistory");
          saveAllSessions();
        }
      }
    }
  } catch (e) {
    console.warn("[MyLocalAI] Could not load sessions", e);
  }
}

function saveAllSessions() {
  try {
    localStorage.setItem("chatSessions", JSON.stringify(chatSessions));
  } catch (e) {
    // Quota errors should not break chat.
    if (!freeSessionStorage()) console.warn("[MyLocalAI] Could not save sessions", e);
  }
}

function tryWriteSessions() {
  try {
    localStorage.setItem("chatSessions", JSON.stringify(chatSessions));
    return true;
  } catch (_) {
    return false;
  }
}

// Images are far larger than text, so they go first (oldest chat first): a few full-page
// screenshots must not wipe the chat history. Whole chats are dropped only after that.
function freeSessionStorage() {
  for (let i = chatSessions.length - 1; i >= 0; i -= 1) {
    chatSessions[i] = withoutImages(chatSessions[i]);
    if (tryWriteSessions()) return true;
  }
  while (chatSessions.length > 1) {
    chatSessions.pop();
    if (tryWriteSessions()) return true;
  }
  return false;
}

// A copy, because the open chat shares its message objects and still needs its images.
function withoutImages(savedSession) {
  const history = savedSession.history.map(m =>
    m.role === "user" ? { ...m, content: m.content.split("__IMG__")[0] } : m);
  return { ...savedSession, history };
}

function saveConversation() {
  if (chatHistory.length === 0) return;

  const existingIndex = chatSessions.findIndex(s => s.id === currentSessionId);
  const sessionData = {
    id: currentSessionId,
    title: extractTitle(chatHistory),
    history: chatHistory.slice(-MAX_CHAT_MESSAGES),
    timestamp: Date.now()
  };

  if (existingIndex >= 0) {
    chatSessions[existingIndex] = sessionData;
  } else {
    chatSessions.unshift(sessionData); // Add to top
  }

  chatSessions = chatSessions.slice(0, MAX_SAVED_SESSIONS);

  saveAllSessions();
  if (!historyPanel.classList.contains("hidden")) {
    renderHistoryList();
  }
}

function extractTitle(history) {
  const firstUserMsg = history.find(m => m.role === "user");
  if (!firstUserMsg) return "New Chat";
  // Image messages are stored as "<text>__IMG__<base64>"; only the text belongs in a title.
  let content = firstUserMsg.content.split("__IMG__")[0];
  if (content.includes("User Question:\n")) {
    content = content.split("User Question:\n")[1];
  }
  content = content.trim();
  return content.length > 35 ? content.substring(0, 35) + "..." : content;
}
