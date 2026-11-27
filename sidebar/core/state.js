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
let currentSessionId = Date.now().toString();
let activeBackend = null;    // "nano" | "ollama" | externalProvider.id | null
let currentContextText = ""; // Context from selected text
let attachedImages = [];     // Base64 JPEGs waiting to be sent (several for a full-page screenshot)
let attachedImagesNote = ""; // tells the model how the images relate; sent along with them
let pageCapture = null;      // AbortController while a full-page screenshot is being taken
let modelSupportsVision = false;
let modelSupportsThinking = false;
let isOllamaModelValid = true;
let isAutoScrollEnabled = true;
let lastScrollTop = 0;
let scrollQueued = false;
let markdownRendererCache; // undefined = not built yet
const pendingRenders = new WeakMap();
let listenersInitialized = false;
let idleUnloadTimer = null;     // fires unloadModel() after a quiet period
let isModelUnloaded = false;    // true while the model is released from memory
let modelSwitcher = null;       // the prompt-bar model pill (features/model-switcher.js), set up once
let nanoVariantSessions = []; // per-answer Nano sessions of the latest multi-answer reply
let lastAutoScreenshotUrl = ""; // page last auto-captured, so the same page isn't re-added
let attachedImageIsAuto = false; // true while the pending image is an automatic screenshot
