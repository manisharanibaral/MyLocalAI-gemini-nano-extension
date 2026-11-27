// Saved chats in localStorage.
"use strict";

// ===================== CONVERSATION STORAGE =====================
function loadSessions() {
  try {
    if (localStorage.getItem("chatSessions") !== null) {
      chatSessions = readStoredSessions();
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

// The saved list as it is in storage right now. Another window's panel writes the same key,
// so every change starts from this instead of from the copy loaded when this panel opened.
function readStoredSessions() {
  try {
    return JSON.parse(localStorage.getItem("chatSessions")) || [];
  } catch (e) {
    console.warn("[MyLocalAI] Could not read saved chats", e);
    return chatSessions; // unreadable storage must not wipe the list we have
  }
}

// Keeps History current while another window's panel saves or deletes chats.
// The storage event fires only in the other extension pages, never in the one that wrote.
function watchSessionsFromOtherPanels() {
  window.addEventListener("storage", (event) => {
    if (event.key !== "chatSessions" && event.key !== null) return; // null: storage was cleared
    chatSessions = readStoredSessions();
    if (!historyPanel.classList.contains("hidden")) renderHistoryList();
  });
}

// Ids are timestamps; two chats started in the same millisecond must still get their own.
function createSessionId() {
  let id = Date.now();
  while (String(id) === currentSessionId || chatSessions.some(s => s.id === String(id))) id += 1;
  return String(id);
}

// The open chat becomes a new, empty record. The previous chat keeps its id, so it stays
// in History instead of being overwritten by the next save.
function startNewChatRecord() {
  chatHistory = [];
  currentSessionId = createSessionId();
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

// A reply can finish after the user started or opened another chat, so the caller passes the
// chat the reply belongs to; by default that is the open one.
function saveConversation(sessionId = currentSessionId, history = chatHistory) {
  if (history.length === 0) return;

  chatSessions = readStoredSessions();
  const existingIndex = chatSessions.findIndex(s => s.id === sessionId);
  const sessionData = {
    id: sessionId,
    title: extractTitle(history),
    history: history.slice(-MAX_CHAT_MESSAGES),
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

// The text of a message without its images.
function messageText(message) {
  return String(message.content).split("__IMG__")[0];
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
