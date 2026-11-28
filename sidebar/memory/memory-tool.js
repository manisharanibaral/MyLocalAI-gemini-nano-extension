// The memory tool: after a reply, the model may create, update or delete one memory.
// Small on-device models are not reliable at free-form tool calling, so the "call" is one JSON
// object constrained by MEMORY_TOOL_SCHEMA, asked in a separate one-shot prompt. That keeps the
// chat's own context free of tool instructions, and every call is checked by memory-store.js.
"use strict";

// ===================== THE TOOL CALL =====================
const MEMORY_TOOL_ACTIONS = ["none", "create", "update", "delete"];

const MEMORY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: MEMORY_TOOL_ACTIONS },
    id: { type: "string" },
    title: { type: "string", maxLength: MAX_MEMORY_TITLE_CHARS },
    description: { type: "string", maxLength: MAX_MEMORY_DESCRIPTION_CHARS },
  },
  required: ["action"],
  additionalProperties: false,
};

// Most messages ("explain HTTPS") say nothing about the user. Skipping those saves a whole
// extra model call, which on Gemini Nano costs memory and battery.
function mightBeAboutUser(text) {
  return /\b(i|i'm|im|i've|i'd|i'll|my|me|mine|myself|remember|forget|call me)\b/i.test(text);
}

function buildMemoryToolPrompt(userText, memories) {
  const saved = memories.length
    ? memories.map(m => `${m.id}: ${m.title} — ${m.description}`).join("\n")
    : "(none yet)";
  return [
    "You keep a short memory of lasting facts about the user, so later chats can be more helpful.",
    "Read the user's message and choose ONE action:",
    '- "create": it reveals a lasting fact (name, job, location, preferences, goals, ongoing projects, how they like answers) or asks you to remember something.',
    '- "update": it changes a saved fact (use that id).',
    '- "delete": it asks you to forget a saved fact, or shows one is wrong (use that id).',
    '- "none": anything else, including one-off questions, facts about other people, passwords or card numbers, and facts already saved.',
    "Write the title as 2-5 words and the description as one short sentence about the user.",
    "",
    "Saved memories:",
    saved,
    "",
    "User's message:",
    `"""\n${userText.slice(0, MAX_MEMORY_INPUT_CHARS)}\n"""`,
    "",
    'Reply with JSON only, for example {"action":"create","title":"Preferred language","description":"Prefers answers in Python."}',
  ].join("\n");
}

// Models wrap JSON in prose or ``` fences now and then, so take the first {...} object.
// Returns a valid call, or { action: "none" } for anything unusable.
function parseMemoryToolCall(text) {
  const match = /\{[\s\S]*\}/.exec(String(text ?? ""));
  if (!match) return { action: "none" };
  let call;
  try {
    call = JSON.parse(match[0]);
  } catch (_) {
    return { action: "none" };
  }
  if (!call || !MEMORY_TOOL_ACTIONS.includes(call.action)) return { action: "none" };
  return {
    action: call.action,
    id: typeof call.id === "string" ? call.id.trim() : "",
    title: typeof call.title === "string" ? call.title : "",
    description: typeof call.description === "string" ? call.description : "",
  };
}

// Runs a parsed call against the store. Returns { action, ok, memory?, error? }.
function applyMemoryToolCall(call) {
  switch (call.action) {
    case "create":
      return { action: "create", ...createMemory({ title: call.title, description: call.description, source: "auto" }) };
    case "update":
      return { action: "update", ...updateMemory(call.id, { title: call.title, description: call.description }) };
    case "delete":
      return { action: "delete", ...deleteMemory(call.id) };
    default:
      return { action: "none", ok: false };
  }
}

// ===================== AFTER EACH MESSAGE =====================
// Only the text the user typed is used, never selected text, page text or screenshots: a web
// page must not be able to plant memories about the user.
async function learnFromMessage(userText, chatId) {
  if (!isMemoryLearningEnabled() || !activeBackend || !mightBeAboutUser(userText)) return;
  let call;
  try {
    const answer = await askActiveBackendForJson(buildMemoryToolPrompt(userText, readMemories()), MEMORY_TOOL_SCHEMA);
    call = parseMemoryToolCall(answer);
  } catch (err) {
    console.warn("[MyLocalAI] Memory tool failed:", err.message);
    return;
  }
  const result = applyMemoryToolCall(call);
  if (chatId === currentSessionId) reportMemoryResult(result);
  refreshMemoryPanel();
}

// Saving and forgetting are shown in the chat, so nothing is learned behind the user's back.
function reportMemoryResult(result) {
  if (result.ok && result.action === "create") appendChatNote(`🧠 Remembered: ${result.memory.title}`);
  else if (result.ok && result.action === "update") appendChatNote(`🧠 Memory updated: ${result.memory.title}`);
  else if (result.ok && result.action === "delete") appendChatNote(`🧠 Forgot: ${result.memory.title}`);
  else if (result.error === "full") appendChatNote(memoryFullMessage());
}

function memoryFullMessage() {
  return `🧠 Memory is full (at most ${MAX_MEMORIES} memories or ${MAX_MEMORY_TOTAL_CHARS.toLocaleString()} characters), ` +
    "so this wasn't saved. Open Memory at the top and delete some to make room.";
}
