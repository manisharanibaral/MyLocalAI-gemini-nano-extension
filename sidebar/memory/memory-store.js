// Saved memories: short facts about the user that are added to the system prompt.
// Both the memory tool (the model) and the Memory panel (the user) change them only here,
// so the limits are enforced in one place.
"use strict";

// ===================== STORAGE =====================
// A memory is { id, title, description, createdAt, updatedAt, source: "auto" | "user", chatId? }.
// chatId is set only on memories the model learned, so deleting that chat can forget them too.
const MEMORY_STORAGE_KEY = "memories";
const MEMORY_LEARNING_KEY = "memoryLearning";

// Read fresh every time: another window's panel may have changed the list.
function readMemories() {
  try {
    const stored = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY));
    return Array.isArray(stored) ? stored.filter(isStoredMemory) : [];
  } catch (e) {
    console.warn("[MyLocalAI] Could not read memories", e);
    return [];
  }
}

function isStoredMemory(memory) {
  return Boolean(memory) && typeof memory.id === "string" &&
    typeof memory.title === "string" && typeof memory.description === "string";
}

function writeMemories(memories) {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
    return true;
  } catch (e) {
    console.warn("[MyLocalAI] Could not save memories", e);
    return false;
  }
}

// "Learn about me" in the Memory panel. On unless the user turned it off.
function isMemoryLearningEnabled() {
  try {
    return localStorage.getItem(MEMORY_LEARNING_KEY) !== "off";
  } catch (_) {
    return true;
  }
}

function setMemoryLearningEnabled(enabled) {
  saveSetting(MEMORY_LEARNING_KEY, enabled ? "on" : "off");
}

// ===================== LIMITS =====================
function memoryChars(memory) {
  return memory.title.length + memory.description.length;
}

function memoryUsage(memories = readMemories()) {
  return { count: memories.length, chars: memories.reduce((sum, m) => sum + memoryChars(m), 0) };
}

function isMemoryFull(memories = readMemories()) {
  const { count, chars } = memoryUsage(memories);
  return count >= MAX_MEMORIES || chars >= MAX_MEMORY_TOTAL_CHARS;
}

// One line of text, cut to its limit. The model may overshoot; cutting beats losing the fact.
function cleanMemoryField(value, maxChars) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

// Card, account and ID numbers or passwords must never be kept, whoever asks for it.
function looksSensitive(text) {
  return /(?:\d[ -]?){12,19}/.test(text) || /\b(password|passcode|pin code|api key|secret key|ssn|social security)\b/i.test(text);
}

// Returns { fields } ready to store, or { error } saying why they can't be.
function checkMemoryFields({ title, description }) {
  const fields = {
    title: cleanMemoryField(title, MAX_MEMORY_TITLE_CHARS),
    description: cleanMemoryField(description, MAX_MEMORY_DESCRIPTION_CHARS),
  };
  if (!fields.title || !fields.description) return { error: "empty" };
  if (looksSensitive(`${fields.title} ${fields.description}`)) return { error: "sensitive" };
  return { fields };
}

// ===================== CHANGES =====================
// Each returns { ok: true, memory } or { ok: false, error }, where error is one of
// "empty" | "sensitive" | "full" | "duplicate" | "not-found" | "storage".
function createMemory({ title, description, source = "user", chatId = null }) {
  const checked = checkMemoryFields({ title, description });
  if (checked.error) return { ok: false, error: checked.error };

  const memories = readMemories();
  if (memories.some(m => sameMemory(m, checked.fields))) return { ok: false, error: "duplicate" };
  if (!fitsWithinLimits(memories, checked.fields)) return { ok: false, error: "full" };

  const now = Date.now();
  const memory = { id: createMemoryId(memories), ...checked.fields, createdAt: now, updatedAt: now, source };
  if (chatId) memory.chatId = chatId;
  return saveMemoryList([memory, ...memories], memory);
}

function updateMemory(id, { title, description }) {
  const memories = readMemories();
  const current = memories.find(m => m.id === id);
  if (!current) return { ok: false, error: "not-found" };
  const checked = checkMemoryFields({ title, description });
  if (checked.error) return { ok: false, error: checked.error };

  const others = memories.filter(m => m !== current);
  if (!fitsWithinLimits(others, checked.fields)) return { ok: false, error: "full" };
  const memory = { ...current, ...checked.fields, updatedAt: Date.now() };
  return saveMemoryList(memories.map(m => (m === current ? memory : m)), memory);
}

function deleteMemory(id) {
  const memories = readMemories();
  const memory = memories.find(m => m.id === id);
  if (!memory) return { ok: false, error: "not-found" };
  return saveMemoryList(memories.filter(m => m !== memory), memory);
}

// A memory learned in a chat belongs to it: deleting the chat forgets what was learned there.
// Memories the user added in the Memory panel have no chatId, so they are never touched.
function memoriesFromChat(chatId, memories = readMemories()) {
  return chatId ? memories.filter(m => m.chatId === chatId) : [];
}

// Returns how many memories were deleted (0 when none, or when storage failed).
function deleteMemoriesFromChat(chatId) {
  const memories = readMemories();
  const learned = memoriesFromChat(chatId, memories);
  if (!learned.length) return 0;
  return writeMemories(memories.filter(m => !learned.includes(m))) ? learned.length : 0;
}

// True when the list still respects both limits after adding `fields`.
function fitsWithinLimits(memories, fields) {
  const { count, chars } = memoryUsage(memories);
  return count + 1 <= MAX_MEMORIES && chars + memoryChars(fields) <= MAX_MEMORY_TOTAL_CHARS;
}

function sameMemory(a, b) {
  return a.title.toLowerCase() === b.title.toLowerCase() && a.description.toLowerCase() === b.description.toLowerCase();
}

function saveMemoryList(memories, memory) {
  return writeMemories(memories) ? { ok: true, memory } : { ok: false, error: "storage" };
}

// Short ids keep the memory tool's prompt small; a counter avoids clashes within one millisecond.
function createMemoryId(memories) {
  let n = Date.now();
  while (memories.some(m => m.id === `m${n.toString(36)}`)) n += 1;
  return `m${n.toString(36)}`;
}

// ===================== FOR THE MODEL =====================
// Appended to the system prompt by getSystemPrompt(); empty when nothing is saved, so the
// prompt is unchanged for people who don't use memory.
function memoryPromptBlock() {
  const memories = readMemories();
  if (!memories.length) return "";
  const lines = memories.map(m => `- ${m.title}: ${m.description}`);
  return `What you know about the user (use it when relevant; never mention this list unprompted):\n${lines.join("\n")}`;
}
