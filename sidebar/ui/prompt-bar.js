// The input box and the selected-text context card.
"use strict";

// ===================== AUTO-RESIZE =====================
function autoResizeInput() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
}

// ===================== CONTEXT LOGIC =====================
function clearContext() {
  currentContextText = "";
  contextCard.classList.add("hidden");
}

// The card shows as much of the selection as fits: CSS clamps it to a few lines at the
// panel's current width. Newlines are flattened so the clamp counts visual lines, and very
// long selections are cut early so the DOM never holds a whole article just for a preview.
const CONTEXT_PREVIEW_MAX_CHARS = 500;
function contextPreview(text) {
  const flat = text.replace(/\s+/g, " ");
  const cut = flat.length > CONTEXT_PREVIEW_MAX_CHARS ? `${flat.slice(0, CONTEXT_PREVIEW_MAX_CHARS)}…` : flat;
  return `"${cut}"`;
}

function setContextFromSelection(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    clearContext();
    return;
  }

  currentContextText = trimmed;
  contextTextEl.textContent = contextPreview(trimmed);
  contextTextEl.title = trimmed; // hover shows the whole selection
  contextCard.classList.remove("hidden");
}

function requestPendingSelectedContext() {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;

  chrome.runtime.sendMessage({ type: "GET_SELECTED_CONTEXT" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.text) setContextFromSelection(response.text);
  });
}
