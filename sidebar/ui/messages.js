// Chat message bubbles and multi-answer tabs.
"use strict";

// ===================== DOM HELPERS =====================
function appendMessage(role, text, streaming = false, reasoning = "") {
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = role === "user" ? "You" : "MyLocalAI";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (streaming) {
    bubble.innerHTML = `<span class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
  } else {
    if (role === "user" && text.includes("__IMG__")) {
      const [typedText, ...images] = text.split("__IMG__");
      bubble.textContent = typedText;
      bubble.appendChild(createMessageImages(images));
    } else {
      let html = "";
      if (reasoning) {
        html += `<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">${formatResponseText(reasoning)}</div></details>`;
      }
      html += role === "ai" ? formatResponseText(text) : escapeHtml(text);
      setSafeHtml(bubble, html || text);
    }
  }

  msg.appendChild(label);
  msg.appendChild(bubble);
  if (role === "ai") {
    // While streaming the text is incomplete, so finalizeMessage reveals the row.
    msg.appendChild(createResponseActions(bubble, !streaming));
  }
  messagesEl.appendChild(msg);
  scrollToBottom(true);
  return bubble;
}

// A short line from MyLocalAI itself (not the model); shown in the chat but never saved.
function appendChatNote(text) {
  const note = document.createElement("div");
  note.className = "msg-note";
  note.textContent = text;
  messagesEl.appendChild(note);
  scrollToBottom(true);
}

// The images of a sent message; several (a full-page screenshot) are laid out as a grid.
function createMessageImages(images) {
  const container = document.createElement("div");
  container.className = images.length > 1 ? "msg-images msg-images-grid" : "msg-images";
  images.forEach((base64, i) => {
    const img = document.createElement("img");
    img.src = `data:image/jpeg;base64,${base64}`;
    img.alt = images.length > 1 ? `Attached image ${i + 1} of ${images.length}` : "Attached image";
    container.appendChild(img);
  });
  return container;
}

// ── Multi-answer replies ("Responses at once") ──
// A reply is a "group" of one or more answer bubbles. With one answer it is a normal message;
// with several, one message holds numbered tabs and one pane (bubble + actions) per answer,
// so N answers take the space of one instead of stacking down the chat.
function appendResponseGroup(count) {
  if (count <= 1) return singleResponseGroup(appendMessage("ai", "", true));

  const msg = document.createElement("div");
  msg.className = "msg ai multi";

  const header = document.createElement("div");
  header.className = "variant-header";
  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = "MyLocalAI";
  const tabs = document.createElement("div");
  tabs.className = "variant-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Answers");
  header.append(label, tabs);
  msg.appendChild(header);

  const group = { bubbles: [], tabs: [], panes: [], onSelect: null };
  for (let i = 0; i < count; i++) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "variant-tab streaming";
    tab.setAttribute("role", "tab");
    tab.textContent = String(i + 1);
    tab.title = `Answer ${i + 1} of ${count}. The chat continues from the selected answer.`;
    tab.addEventListener("click", () => {
      group.setActive(i);
      group.onSelect?.(i);
    });

    const pane = document.createElement("div");
    pane.className = "variant-pane";
    pane.setAttribute("role", "tabpanel");
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = `<span class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
    pane.append(bubble, createResponseActions(bubble, false));

    tabs.appendChild(tab);
    msg.appendChild(pane);
    group.tabs.push(tab);
    group.panes.push(pane);
    group.bubbles.push(bubble);
  }

  group.setActive = (index) => {
    group.tabs.forEach((tab, i) => {
      tab.classList.toggle("active", i === index);
      tab.setAttribute("aria-selected", String(i === index));
    });
    group.panes.forEach((pane, i) => pane.classList.toggle("hidden", i !== index));
  };
  group.markDone = (index) => group.tabs[index].classList.remove("streaming");
  group.markFailed = (index) => group.tabs[index].classList.add("failed");

  group.setActive(0);
  messagesEl.appendChild(msg);
  scrollToBottom(true);
  return group;
}

// Same interface as a multi-answer group, so sendMessage() needs no special case.
function singleResponseGroup(bubble) {
  return { bubbles: [bubble], onSelect: null, setActive() { }, markDone() { }, markFailed() { } };
}

// Rebuilds a saved multi-answer reply with its tabs and selected answer.
function appendSavedResponseGroup(entry) {
  const group = appendResponseGroup(entry.variants.length);
  entry.variants.forEach((variant, i) => {
    finalizeMessage(group.bubbles[i], variant.content, variant.reasoning);
    group.markDone(i);
    if (variant.failed) group.markFailed(i);
  });
  group.setActive(entry.selected ?? 0);
  bindVariantSelection(group, entry);
}

// Switching tabs changes which answer the history entry keeps (and so what the model sees
// next). Nano's per-answer sessions only exist for the latest reply, so only it moves Nano.
function bindVariantSelection(group, entry) {
  if (!entry.variants) return;
  group.onSelect = (index) => {
    const variant = entry.variants[index];
    if (!variant || variant.failed || !chatHistory.includes(entry)) return;
    entry.selected = index;
    entry.content = variant.content;
    entry.reasoning = variant.reasoning;
    if (activeBackend === "nano" && entry === chatHistory[chatHistory.length - 1]) {
      adoptNanoVariant(index);
      updateTokenInfo();
    }
    saveConversation();
  };
}
