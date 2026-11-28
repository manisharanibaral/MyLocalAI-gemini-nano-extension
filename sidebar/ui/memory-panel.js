// The Memory panel: every saved memory as a card (date, title, description) in a scrolling
// two-column grid, with add, edit and delete. Changes go through memory-store.js.
"use strict";

// ===================== OPEN / CLOSE =====================
function setupMemoryPanel() {
  btnMemory.addEventListener("click", toggleMemoryPanel);
  btnAddMemory.addEventListener("click", () => openMemoryForm());
  btnCancelMemory.addEventListener("click", closeMemoryForm);
  memoryForm.addEventListener("submit", submitMemoryForm);
  memoryLearningToggle.addEventListener("change", () => setMemoryLearningEnabled(memoryLearningToggle.checked));
  // Another window's panel may add or delete memories.
  window.addEventListener("storage", (event) => {
    if (event.key === MEMORY_STORAGE_KEY || event.key === null) refreshMemoryPanel();
  });
}

function toggleMemoryPanel() {
  settingsPanel.classList.add("hidden");
  historyPanel.classList.add("hidden");
  memoryPanel.classList.toggle("hidden");
  if (!memoryPanel.classList.contains("hidden")) renderMemoryPanel();
}

// Called after any change made outside the panel (the memory tool, another window).
function refreshMemoryPanel() {
  if (!memoryPanel.classList.contains("hidden")) renderMemoryPanel();
}

// ===================== RENDERING =====================
function renderMemoryPanel() {
  const memories = readMemories();
  memoryLearningToggle.checked = isMemoryLearningEnabled();
  renderMemoryUsage(memories);
  memoryList.replaceChildren(...(memories.length ? memories.map(createMemoryCard) : [createEmptyMemoryNote()]));
}

// The meter fills by whichever limit is closer, so "full" never comes as a surprise.
function renderMemoryUsage(memories) {
  const { count, chars } = memoryUsage(memories);
  const full = isMemoryFull(memories);
  const fraction = Math.min(1, Math.max(count / MAX_MEMORIES, chars / MAX_MEMORY_TOTAL_CHARS));
  memoryUsageText.textContent = `${count} of ${MAX_MEMORIES} · ${chars.toLocaleString()} / ${MAX_MEMORY_TOTAL_CHARS.toLocaleString()} characters`;
  memoryMeterFill.style.width = `${Math.round(fraction * 100)}%`;
  memoryPanel.classList.toggle("memory-full", full);
  btnAddMemory.disabled = full;
  memoryLimitNote.textContent = full ? "Memory is full. Delete some memories so MyLocalAI can learn new things." : "";
  memoryLimitNote.classList.toggle("hidden", !full);
}

function createEmptyMemoryNote() {
  const note = document.createElement("div");
  note.className = "history-empty memory-empty";
  note.textContent = "Nothing saved yet. Tell MyLocalAI about yourself (\"I'm a nurse\", \"remember I prefer metric\") or press + Add.";
  return note;
}

// Opening a card edits it; delete is its own button, since buttons can't be nested.
function createMemoryCard(memory) {
  const card = document.createElement("div");
  card.className = "memory-card";
  card.setAttribute("role", "listitem");

  const open = document.createElement("button");
  open.type = "button";
  open.className = "memory-card-open";
  open.setAttribute("aria-label", `Edit memory: ${memory.title}`);
  const date = document.createElement("span");
  date.className = "memory-card-date";
  date.textContent = formatMemoryDate(memory.updatedAt || memory.createdAt);
  const title = document.createElement("span");
  title.className = "memory-card-title";
  title.textContent = memory.title;
  const description = document.createElement("span");
  description.className = "memory-card-description";
  description.textContent = memory.description;
  open.append(date, title, description);
  open.addEventListener("click", () => openMemoryForm(memory));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "memory-card-delete";
  remove.textContent = "×";
  remove.title = "Delete memory";
  remove.setAttribute("aria-label", `Delete memory: ${memory.title}`);
  remove.addEventListener("click", () => confirmDeleteMemory(memory));

  card.append(open, remove);
  return card;
}

// dd/mm/yy in the user's own order (the locale decides).
function formatMemoryDate(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ===================== ADD / EDIT / DELETE =====================
// With a memory it edits that one; without, it adds a new one.
function openMemoryForm(memory = null) {
  memoryForm.dataset.editId = memory?.id || "";
  memoryTitleInput.value = memory?.title || "";
  memoryDescriptionInput.value = memory?.description || "";
  memoryFormError.textContent = "";
  memoryForm.classList.remove("hidden");
  memoryTitleInput.focus();
}

function closeMemoryForm() {
  memoryForm.classList.add("hidden");
  memoryForm.dataset.editId = "";
}

function submitMemoryForm(event) {
  event.preventDefault();
  const fields = { title: memoryTitleInput.value, description: memoryDescriptionInput.value };
  const editId = memoryForm.dataset.editId;
  const result = editId ? updateMemory(editId, fields) : createMemory({ ...fields, source: "user" });
  if (!result.ok) {
    memoryFormError.textContent = memoryErrorText(result.error);
    return;
  }
  closeMemoryForm();
  renderMemoryPanel();
}

function confirmDeleteMemory(memory) {
  if (!confirm(`Delete the memory "${memory.title}"? This cannot be undone.`)) return;
  deleteMemory(memory.id);
  if (memoryForm.dataset.editId === memory.id) closeMemoryForm();
  renderMemoryPanel();
}

function memoryErrorText(error) {
  switch (error) {
    case "empty": return "Add both a title and a description.";
    case "sensitive": return "Passwords, card and ID numbers are never saved to memory.";
    case "full": return `Memory is full (${MAX_MEMORIES} memories or ${MAX_MEMORY_TOTAL_CHARS.toLocaleString()} characters). Delete some first.`;
    case "duplicate": return "That memory is already saved.";
    case "not-found": return "That memory was deleted, maybe in another window.";
    default: return "Could not save. Your browser storage may be full.";
  }
}
