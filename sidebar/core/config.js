// Edition config, defaults and limits. Nothing here changes while the panel runs.
"use strict";

// ===================== EDITION CONFIG =====================
// config.js decides which backends this build may use (see scripts/build.mjs).
const CONFIG = window.MYLOCALAI_CONFIG || {};
const ENABLED_BACKENDS = Array.isArray(CONFIG.backends) && CONFIG.backends.length
  ? CONFIG.backends
  : ["nano", "ollama"];
const nanoEnabled = ENABLED_BACKENDS.includes("nano");
const ollamaEnabled = ENABLED_BACKENDS.includes("ollama");
// The first enabled backend that a provider file registered (null in the Nano/Ollama editions).
const externalProvider = ENABLED_BACKENDS
  .map((id) => window.MYLOCALAI_PROVIDERS?.[id])
  .find(Boolean) || null;

// Single source of truth for Ollama defaults (the settings inputs are filled from these).
const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";

const getOllamaModel = () => ollamaModelInput.value.trim() || DEFAULT_OLLAMA_MODEL;
const getOllamaUrl = () => ollamaUrlInput.value.trim() || DEFAULT_OLLAMA_URL;

const REQUEST_TIMEOUT_MS = 15000;
const GENERATION_TIMEOUT_MS = 120000;
const MAX_CHAT_MESSAGES = 100;

// Ollama's context window, sent as options.num_ctx. Without it Ollama uses its own small
// default and silently cuts the start of an overlong prompt, which holds the system prompt.
// The history sent is trimmed to fit this (see ollama-request.js), so nothing is cut there.
const OLLAMA_CONTEXT_TOKENS = 8192;
// Room kept for the reply when "Answer length" is Long (no num_predict cap).
const OLLAMA_REPLY_RESERVE_TOKENS = 2048;
// A rough cost per image; vision models use about 256 (Gemma) to 576 (LLaVA) tokens each.
const OLLAMA_TOKENS_PER_IMAGE = 600;
// Characters per token, used to turn a token budget into characters. English averages about
// 4; 3 stays on the safe side for code and other languages.
const CHARS_PER_TOKEN = 3;

// "Thinking" setting (Ollama models that can reason before answering). Off by default:
// the reasoning is often longer than the answer, so short chats wait for nothing.
const DEFAULT_OLLAMA_THINKING = "off";
const MAX_SAVED_SESSIONS = 50;
const MAX_SAVED_PROMPTS = 5;
// The model stays in RAM for as long as a session/loaded model exists, so release it when idle.
// The user picks the delay in settings (minutes). 0 is the default: never unload while the
// panel is open, matching Chrome's own behaviour (Chrome only frees it after the panel closes).
const DEFAULT_IDLE_UNLOAD_MINUTES = 0;
const getIdleUnloadMs = () => (parseInt(idleUnloadSelect.value, 10) || 0) * 60 * 1000;

// How many alternative answers one message generates in parallel ("Responses at once").
// Each extra answer is another full generation, so the cap keeps memory and wait bounded.
const DEFAULT_RESPONSE_COUNT = 1;
const MAX_RESPONSE_COUNT = 5;

// Tab screenshots ("Tab screenshot" setting):
//   open   - when the panel opens (or New chat), put the open website in the prompt bar,
//            skipping search results and browser/home pages
//   follow - keep the prompt bar in step with the tab: every page switched to or loaded
//   manual - only when the user picks "Screenshot this tab" from the + menu
const DEFAULT_TAB_SCREENSHOT_MODE = "open";
const TAB_CHANGE_SETTLE_MS = 600;
// captureVisibleTab needs host access. It is optional so installing the extension
// (especially the Nano edition) asks for no site access; Chrome prompts on first use.
const TAB_ACCESS = { origins: ["<all_urls>"] };
// Uploads stay small to save memory; screenshots get more pixels so page text stays readable.
const MAX_UPLOAD_IMAGE_SIDE = 800;
const MAX_SCREENSHOT_SIDE = 1280;

// Selected text sent as context ("Use selection as MyLocalAI context"). About 2k tokens:
// enough for a few long paragraphs, small enough that a whole selected page does not fill
// Gemini Nano's context window on the first message and force a new chat.
const MAX_CONTEXT_CHARS = 8000;

// "Answer length" setting. maxTokens is a hard stop where the backend has one (Ollama's
// num_predict, Firebase cloud's maxOutputTokens; null = the model's own limit). Chrome's
// Prompt API has no such option, so the hint added to the system prompt is what keeps
// Gemini Nano (and the Firebase on-device route) short. The hint asks for less than the
// cap, so the model normally finishes on its own before the hard stop cuts it off.
const ANSWER_LENGTHS = {
  short: { maxTokens: 400, hint: "Keep every answer short: at most a few sentences or a brief list." },
  normal: { maxTokens: 1500, hint: "" },
  long: { maxTokens: null, hint: "Give thorough, detailed answers when the question calls for it." },
};
const DEFAULT_ANSWER_LENGTH = "normal";
// Ollama counts a thinking model's reasoning against num_predict, so without this extra
// room a Short cap could be spent before the visible answer even starts.
const THINKING_TOKEN_ALLOWANCE = 2048;

// Sent with every message (and every Firebase call), so every token here costs memory on
// Nano's small context window. Keep it short; add rules only if they change answers.
const DEFAULT_SYSTEM_PROMPT = `You are MyLocalAI, a helpful, accurate assistant.
- Answer first, then add only useful detail.
- Base answers on any shared context, page or image; say if it lacks the answer.
- If unsure, say so. Never invent facts, numbers, links or quotes.
- If the request is unclear, ask one short question.
- Reply in the user's language.
- Use Markdown: ## headings for long answers, numbered steps, bullet lists, tables for comparisons, fenced code with a language tag.`;
