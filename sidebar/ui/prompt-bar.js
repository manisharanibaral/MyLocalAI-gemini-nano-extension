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
  currentContextCut = null;
  contextNoteEl.classList.add("hidden");
  contextCard.classList.add("hidden");
}

// Keeps the first MAX_CONTEXT_CHARS of a selection, ending on a word boundary when one is
// close, so the model never sees half a word. Returns { text, cut } where cut is null when
// nothing was dropped, else { kept, total } (in characters) for the notes to the user and model.
function capSelectedText(text) {
  if (text.length <= MAX_CONTEXT_CHARS) return { text, cut: null };
  let kept = text.slice(0, MAX_CONTEXT_CHARS);
  const lastSpace = kept.search(/\s\S*$/);
  if (lastSpace > MAX_CONTEXT_CHARS * 0.9) kept = kept.slice(0, lastSpace);
  kept = kept.trimEnd();
  return { text: kept, cut: { kept: kept.length, total: text.length } };
}

function contextCutNote(cut) {
  return `Too long: using the first ${cut.kept.toLocaleString()} of ${cut.total.toLocaleString()} characters.`;
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

  const { text: capped, cut } = capSelectedText(trimmed);
  currentContextText = capped;
  currentContextCut = cut;
  contextTextEl.textContent = contextPreview(capped);
  contextTextEl.title = capped; // hover shows all the text the model will get
  contextNoteEl.textContent = cut ? contextCutNote(cut) : "";
  contextNoteEl.classList.toggle("hidden", !cut);
  contextCard.classList.remove("hidden");
}

function requestPendingSelectedContext() {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;

  chrome.runtime.sendMessage({ type: "GET_SELECTED_CONTEXT" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.text) setContextFromSelection(response.text);
  });
}
