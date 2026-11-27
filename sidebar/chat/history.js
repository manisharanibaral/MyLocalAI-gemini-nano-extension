// Opening, listing, deleting and starting chats.
"use strict";

function loadConversation(id) {
  const sessionToLoad = chatSessions.find(s => s.id === id);
  if (!sessionToLoad) return;

  currentSessionId = sessionToLoad.id;
  chatHistory = [...sessionToLoad.history];

  // Update UI
  messagesEl.innerHTML = "";
  welcomeScreen.classList.add("hidden");
  messagesEl.classList.remove("hidden");

  chatHistory.forEach(msg => {
    if (msg.role === "user" || msg.role === "assistant") {
      const role = msg.role === "assistant" ? "ai" : "user";
      let displayContent = msg.content;
      if (msg.role === "user" && displayContent.includes("User Question:\n")) {
        displayContent = displayContent.split("User Question:\n")[1];
      }
      if (msg.role === "assistant" && msg.variants?.length > 1) {
        appendSavedResponseGroup(msg);
        return;
      }
      appendMessage(role, displayContent, false, msg.reasoning, msg.images);
    }
  });

  scrollToBottom(true);
  updateTokenInfo();
  historyPanel.classList.add("hidden");

  // Nano keeps the conversation inside its session, so the reopened chat gets a fresh one
  // (the previous chat's turns must not leak in) with this chat's turns put back into it.
  if (activeBackend === "nano" && session) {
    resetNanoChat()
      .then(() => restoreNanoContext(chatHistory))
      .then(showNanoMemoryNote)
      .then(hideStatus)
      .catch((err) => console.warn("[MyLocalAI] Could not reset Nano chat:", err.message));
  }
}

function renderHistoryList() {
  historyList.innerHTML = "";
  if (chatSessions.length === 0) {
    historyList.innerHTML = `<div class="history-empty">No past chats found.</div>`;
    return;
  }

  chatSessions.forEach(s => {
    const el = document.createElement("div");
    el.className = `history-item ${s.id === currentSessionId ? "active" : ""}`;

    const dateStr = new Date(s.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const contentDiv = document.createElement("div");
    contentDiv.className = "history-item-content";
    // Reachable with Tab and opened with Enter or Space, like a button; a plain div is mouse-only.
    contentDiv.setAttribute("role", "button");
    contentDiv.tabIndex = 0;
    if (s.id === currentSessionId) contentDiv.setAttribute("aria-current", "true");

    const titleDiv = document.createElement("div");
    titleDiv.className = "history-item-title";
    // Recompute from history so chats saved before titles were cleaned don't show image data.
    const title = s.history?.length ? extractTitle(s.history) : s.title;
    titleDiv.title = title;
    titleDiv.textContent = title;
    
    const dateDiv = document.createElement("div");
    dateDiv.className = "history-item-date";
    dateDiv.textContent = dateStr;
    
    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(dateDiv);
    
    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete-chat";
    delBtn.dataset.id = s.id;
    delBtn.title = "Delete chat";
    delBtn.setAttribute("aria-label", "Delete chat");

    // Parsed as XML, the <svg> needs its namespace; without it the browser draws nothing
    // and the button is an invisible click target.
    const doc = new DOMParser().parseFromString(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `, "image/svg+xml");
    delBtn.appendChild(doc.documentElement);
    
    el.appendChild(contentDiv);
    el.appendChild(delBtn);

    const openChat = () => {
      if (isGenerating) return;
      loadConversation(s.id);
    };
    contentDiv.addEventListener("click", openChat);
    contentDiv.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault(); // Space would otherwise scroll the list
      openChat();
    });

    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isGenerating) return;
      if (!confirmDeleteChat(title)) return;
      deleteConversation(s.id);
    });

    historyList.appendChild(el);
  });
}

// Deleting has no undo, so the user confirms first, as they do for saved prompts.
// Kept out of deleteConversation so code (and tests) can still delete without a dialog.
function confirmDeleteChat(title) {
  return confirm(`Delete the chat "${title}"? This cannot be undone.`);
}

function deleteConversation(id) {
  chatSessions = readStoredSessions().filter(s => s.id !== id);
  saveAllSessions();
  renderHistoryList();

  if (id === currentSessionId) {
    startNewChat();
  }
}

async function startNewChat() {
  if (isGenerating) stopGeneration();
  startNewChatRecord();
  clearContext();
  clearAttachedImage();
  clearChatView();

  try {
    if (activeBackend === "nano") {
      await resetNanoChat();
      hideStatus();
    }
  } catch (_) { }
  updateTokenInfo();
  refreshAutoScreenshot("open"); // a new chat starts with the page you're on
}

function clearChatView() {
  messagesEl.innerHTML = "";
  messagesEl.classList.add("hidden");
  welcomeScreen.classList.remove("hidden");
}
