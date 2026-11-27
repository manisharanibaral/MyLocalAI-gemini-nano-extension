// Mutable state shared by the sidebar/ files.
"use strict";

// ===================== STATE =====================
let lastNanoError = "";
let session = null;        // Gemini Nano session for the current chat (a clone of nanoBaseSession)
// Chrome's guidance: create one session holding only the system prompt, then clone() it per chat.
// Cloning is much faster than create(), so "New chat" no longer reloads the model.
let nanoBaseSession = null;
let nanoContextTrimmed = false; // set when Nano dropped old turns to fit its context window
let abortController = null;
let isGenerating = false;
let chatHistory = [];        // Messages for the current session
let chatSessions = [];       // Array of all saved sessions
let savedPromptList = [];    // Array of saved system prompts
// The system prompt in effect: the text box as of the last Apply. Every backend reads this, so
// an edit (or a picked saved prompt) changes nothing until Apply & Restart.
let appliedSystemPrompt = "";
// The "Answer length" in effect (a key of ANSWER_LENGTHS); like the prompt, it changes on Apply.
let appliedAnswerLength = DEFAULT_ANSWER_LENGTH;
let currentSessionId = Date.now().toString();
let activeBackend = null;    // "nano" | "ollama" | externalProvider.id | null
let currentContextText = ""; // Context from selected text (at most MAX_CONTEXT_CHARS)
let currentContextCut = null; // { kept, total } when the selection was longer than the cap
let attachedImages = [];     // Base64 JPEGs waiting to be sent (several for a full-page screenshot)
let attachedImagesNote = ""; // tells the model how the images relate; sent along with them
// While a full-page screenshot is being taken: { cancel, stop } AbortControllers.
// cancel throws the pictures away; stop keeps the ones taken so far.
let pageCapture = null;
// Set while the pending images are parts of one page: { title, parts, captured, total, stopped }.
// parts holds each image's position on the page, so the note stays true after removals.
let attachedPage = null;
let modelSupportsVision = false;
let modelSupportsThinking = false;
let isOllamaModelValid = true;
// Token counts Ollama reported for the latest reply: { chatId, input, output }. chatId keeps
// one chat's counts from showing in the footer of another.
let lastOllamaUsage = null;
let isAutoScrollEnabled = true;
let lastScrollTop = 0;
let scrollQueued = false;
let markdownRendererCache; // undefined = not built yet
const pendingRenders = new WeakMap();
// The latest text streamed into each answer bubble, so a stopped answer can be saved as written.
const streamedText = new WeakMap();
let listenersInitialized = false;
let idleUnloadTimer = null;     // fires unloadModel() after a quiet period
let isModelUnloaded = false;    // true while the model is released from memory
let modelSwitcher = null;       // the prompt-bar model pill (features/model-switcher.js), set up once
let nanoVariantSessions = []; // per-answer Nano sessions of the latest multi-answer reply
let lastAutoScreenshotUrl = ""; // page last auto-captured, so the same page isn't re-added
let attachedImageIsAuto = false; // true while the pending image is an automatic screenshot
