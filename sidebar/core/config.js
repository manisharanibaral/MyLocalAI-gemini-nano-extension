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
const MAX_SAVED_SESSIONS = 50;
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

const DEFAULT_SYSTEM_PROMPT = `You are MyLocalAI, a helpful and friendly assistant. Follow these formatting rules:

**Structure & Clarity:**
- Keep answers concise and well-organized.
- Use **headings** (## / ###) to separate sections in longer responses.
- Break down complex topics into numbered steps.

**Formatting Rules:**
- Use **bullet points** (- or *) for listing items, features, pros/cons, or options.
- Use **tables** (Markdown) when comparing 2+ items, showing specs, or presenting structured data.
- Use **bold** for key terms and *italics* for emphasis.
- Use \`inline code\` for commands, filenames, or short code references.
- Use triple-backtick code blocks with language tags for code snippets.
- Use > blockquotes for important notes or warnings.

**When to use what:**
- Comparison? → Table
- Steps/instructions? → Numbered list
- Features/options? → Bullet points
- Data/specs? → Table
- Code? → Fenced code block with language

Always prefer structured output over plain paragraphs.`;
