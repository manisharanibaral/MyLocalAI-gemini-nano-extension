/**
 * MyLocalAI — Local AI Chat Sidebar
 *
 * Backend priority:
 *   1. Gemini Nano (Chrome's built-in LanguageModel API) — Chrome only
 *   2. Ollama (local REST API at localhost:11434) — any browser
 *
 * Which of these are tried is set by config.js (window.MYLOCALAI_CONFIG),
 * so the same code ships as the Nano-only, Ollama-only and mixed editions.
 *
 * Both backends run 100% on-device. Zero cloud.
 */

(() => {
  "use strict";

  // ===================== DOM REFS =====================
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const statusOverlay = $("#status-overlay");
  const statusSpinner = $("#status-spinner");
  const statusErrIcon = $("#status-error-icon");
  const statusTitle = $("#status-title");
  const statusMessage = $("#status-message");
  const statusRetryBtn = $("#status-retry-btn");

  const welcomeScreen = $("#welcome-screen");
  const welcomeSub = $("#welcome-sub");
  const messagesEl = $("#messages");
  const userInput = $("#user-input");
  const btnSend = $("#btn-send");
  const btnStop = $("#btn-stop");
  const contextCard = $("#context-card");
  const contextTextEl = $("#context-text");
  const btnClearContext = $("#btn-clear-context");
  const btnClear = $("#btn-clear");
  const btnSettings = $("#btn-settings");
  const settingsPanel = $("#settings-panel");
  const sysPromptEl = $("#sys-prompt");
  const tempSlider = $("#temp-slider");
  const tempValue = $("#temp-value");
  const topkSlider = $("#topk-slider");
  const topkValue = $("#topk-value");
  const btnApply = $("#btn-apply-settings");
  const btnReset = $("#btn-reset-all");
  const btnSavePrompt = $("#btn-save-prompt");
  const savedPromptsDropdown = $("#saved-prompts");
  const btnHistory = $("#btn-history");
  const historyPanel = $("#history-panel");
  const historyList = $("#history-list");
  const attachWrap = $("#attach-wrap");
  const btnAttach = $("#btn-attach");
  const attachMenu = $("#attach-menu");
  const btnUploadImg = $("#btn-upload-img");
  const btnScreenshotTab = $("#btn-screenshot-tab");
  const tabScreenshotSelect = $("#tab-screenshot-mode");
  const screenshotAccessCard = $("#screenshot-access-card");
  const btnAllowScreenshots = $("#btn-allow-screenshots");
  const btnDismissScreenshotAccess = $("#btn-dismiss-screenshot-access");
  const imagePreviewText = $(".img-preview-text");
  const fileUpload = $("#file-upload");
  const imagePreviewCard = $("#image-preview-card");
  const imagePreviewImg = $("#image-preview-img");
  const btnClearImage = $("#btn-clear-image");
  const inputBar = document.querySelector(".input-bar");
  const tokenInfo = $("#token-info");
  const headerBadge = $("#header-badge");
  const backendHint = $("#backend-hint");
  const ollamaModelInput = $("#ollama-model");
  const ollamaUrlInput = $("#ollama-url");
  const idleUnloadSelect = $("#idle-unload");
  const responseCountInputs = $$('input[name="response-count"]');
  const ollamaSettings = $("#ollama-settings");
  const ollamaSettingsLabel = $("#ollama-settings-label");

  // ===================== EDITION CONFIG =====================
  // config.js decides which backends this build may use (see scripts/build.mjs).
  const CONFIG = window.MYLOCALAI_CONFIG || {};
  const ENABLED_BACKENDS = Array.isArray(CONFIG.backends) && CONFIG.backends.length
    ? CONFIG.backends
    : ["nano", "ollama"];
  const nanoEnabled = ENABLED_BACKENDS.includes("nano");
  const ollamaEnabled = ENABLED_BACKENDS.includes("ollama");

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
  let activeBackend = null;    // "nano" | "ollama" | null
  let currentContextText = ""; // Context from selected text
  let currentAttachedImage = null; // Base64 string of attached image
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
  let nanoVariantSessions = []; // per-answer Nano sessions of the latest multi-answer reply

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
  let lastAutoScreenshotUrl = ""; // page last auto-captured, so the same page isn't re-added
  let attachedImageIsAuto = false; // true while the pending image is an automatic screenshot

  function clampResponseCount(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return DEFAULT_RESPONSE_COUNT;
    return Math.min(MAX_RESPONSE_COUNT, Math.max(1, n));
  }

  function getResponseCount() {
    const checked = [...responseCountInputs].find(input => input.checked);
    return clampResponseCount(checked?.value);
  }

  function setResponseCount(value) {
    const count = String(clampResponseCount(value));
    responseCountInputs.forEach(input => { input.checked = input.value === count; });
  }

  // Create span for model status in settings
  const modelStatusSpan = document.createElement("span");
  modelStatusSpan.className = "settings-status";
  document.querySelector('label[for="ollama-model"]')?.appendChild(modelStatusSpan);

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

  // ===================== BROWSER DETECTION =====================
  async function detectBrowser() {
    if (navigator.brave && await navigator.brave.isBrave()) return "brave";
    const ua = navigator.userAgent;
    if (ua.includes("Edg/")) return "edge";
    if (ua.includes("OPR/") || ua.includes("Opera")) return "opera";
    if (ua.includes("Vivaldi")) return "vivaldi";
    if (ua.includes("Chrome/")) return "chrome";
    return "unknown";
  }

  let browserName = "unknown";

  // ===================== SETTINGS STORAGE =====================
  function loadSettings() {
    ollamaModelInput.value = ollamaModelInput.placeholder = DEFAULT_OLLAMA_MODEL;
    ollamaUrlInput.value = ollamaUrlInput.placeholder = DEFAULT_OLLAMA_URL;
    idleUnloadSelect.value = String(DEFAULT_IDLE_UNLOAD_MINUTES);
    setResponseCount(DEFAULT_RESPONSE_COUNT);
    tabScreenshotSelect.value = DEFAULT_TAB_SCREENSHOT_MODE;

    try {
      const savedScreenshotMode = localStorage.getItem("tabScreenshotMode");
      if (savedScreenshotMode !== null && [...tabScreenshotSelect.options].some(o => o.value === savedScreenshotMode)) {
        tabScreenshotSelect.value = savedScreenshotMode;
      }
      const savedCount = localStorage.getItem("responseCount");
      if (savedCount !== null) setResponseCount(savedCount);
      const savedIdle = localStorage.getItem("idleUnloadMinutes");
      if (savedIdle !== null && [...idleUnloadSelect.options].some(o => o.value === savedIdle)) {
        idleUnloadSelect.value = savedIdle;
      }
      if (localStorage.getItem("sysPrompt")) sysPromptEl.value = localStorage.getItem("sysPrompt");
      if (localStorage.getItem("temp")) tempSlider.value = localStorage.getItem("temp");
      if (localStorage.getItem("topk")) topkSlider.value = localStorage.getItem("topk");
      if (localStorage.getItem("ollamaModel")) ollamaModelInput.value = localStorage.getItem("ollamaModel");
      if (localStorage.getItem("ollamaUrl")) ollamaUrlInput.value = localStorage.getItem("ollamaUrl");

      tempValue.textContent = tempSlider.value;
      topkValue.textContent = topkSlider.value;

      const savedList = localStorage.getItem("savedPromptList");
      if (savedList) {
        savedPromptList = JSON.parse(savedList) || [];
      }
      renderSavedPrompts();
    } catch (e) {
      console.warn("[MyLocalAI] Could not load settings", e);
    }
  }

  function renderSavedPrompts() {
    savedPromptsDropdown.innerHTML = '<option value="" disabled selected>Select a saved prompt...</option>';
    savedPromptList.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = item.content;
      option.textContent = item.name;
      savedPromptsDropdown.appendChild(option);
    });

    const currentPrompt = sysPromptEl.value.trim();
    if (currentPrompt && savedPromptList.some(p => p.content === currentPrompt)) {
      savedPromptsDropdown.value = currentPrompt;
    } else {
      savedPromptsDropdown.value = "";
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem("sysPrompt", sysPromptEl.value);
      localStorage.setItem("temp", tempSlider.value);
      localStorage.setItem("topk", topkSlider.value);
      localStorage.setItem("ollamaModel", ollamaModelInput.value);
      localStorage.setItem("ollamaUrl", ollamaUrlInput.value);
      localStorage.setItem("idleUnloadMinutes", idleUnloadSelect.value);
      localStorage.setItem("responseCount", String(getResponseCount()));
      localStorage.setItem("tabScreenshotMode", tabScreenshotSelect.value);
    } catch (e) {
      console.warn("[MyLocalAI] Could not save settings", e);
    }
  }

  // ===================== CONVERSATION STORAGE =====================
  function loadSessions() {
    try {
      const saved = localStorage.getItem("chatSessions");
      if (saved) {
        chatSessions = JSON.parse(saved) || [];
      } else {
        // Migration: Check for old single-chat format
        const oldSaved = localStorage.getItem("chatHistory");
        if (oldSaved) {
          const oldHistory = JSON.parse(oldSaved);
          if (oldHistory && oldHistory.length > 0) {
            chatSessions = [{
              // Own id, not currentSessionId: the fresh chat opened at startup uses that
              // one and would overwrite the migrated history on its first save.
              id: `migrated-${Date.now()}`,
              title: extractTitle(oldHistory),
              history: oldHistory,
              timestamp: Date.now()
            }];
            localStorage.removeItem("chatHistory");
            saveAllSessions();
          }
        }
      }
    } catch (e) {
      console.warn("[MyLocalAI] Could not load sessions", e);
    }
  }

  function saveAllSessions() {
    try {
      localStorage.setItem("chatSessions", JSON.stringify(chatSessions));
    } catch (e) {
      // Quota errors should not break chat. Drop oldest sessions until storage fits.
      while (chatSessions.length > 1) {
        chatSessions.pop();
        try {
          localStorage.setItem("chatSessions", JSON.stringify(chatSessions));
          return;
        } catch (_) { /* continue trimming */ }
      }
      console.warn("[MyLocalAI] Could not save sessions", e);
    }
  }

  function saveConversation() {
    if (chatHistory.length === 0) return;

    const existingIndex = chatSessions.findIndex(s => s.id === currentSessionId);
    const sessionData = {
      id: currentSessionId,
      title: extractTitle(chatHistory),
      history: chatHistory.slice(-MAX_CHAT_MESSAGES),
      timestamp: Date.now()
    };

    if (existingIndex >= 0) {
      chatSessions[existingIndex] = sessionData;
    } else {
      chatSessions.unshift(sessionData); // Add to top
    }

    chatSessions = chatSessions.slice(0, MAX_SAVED_SESSIONS);

    saveAllSessions();
    if (!historyPanel.classList.contains("hidden")) {
      renderHistoryList();
    }
  }

  function extractTitle(history) {
    const firstUserMsg = history.find(m => m.role === "user");
    if (!firstUserMsg) return "New Chat";
    // Image messages are stored as "<text>__IMG__<base64>"; only the text belongs in a title.
    let content = firstUserMsg.content.split("__IMG__")[0];
    if (content.includes("User Question:\n")) {
      content = content.split("User Question:\n")[1];
    }
    content = content.trim();
    return content.length > 35 ? content.substring(0, 35) + "..." : content;
  }

  function loadConversation(id) {
    const sessionToLoad = chatSessions.find(s => s.id === id);
    if (!sessionToLoad) return;

    currentSessionId = sessionToLoad.id;
    chatHistory = [...sessionToLoad.history];

    // Update UI
    messagesEl.innerHTML = "";
    welcomeScreen.classList.add("hidden");
    messagesEl.classList.remove("hidden");

    chatHistory.forEach(msg => {
      if (msg.role === "user" || msg.role === "assistant") {
        const role = msg.role === "assistant" ? "ai" : "user";
        let displayContent = msg.content;
        if (msg.role === "user" && displayContent.includes("User Question:\n")) {
          displayContent = displayContent.split("User Question:\n")[1];
        }
        if (msg.role === "assistant" && msg.variants?.length > 1) {
          appendSavedResponseGroup(msg);
          return;
        }
        appendMessage(role, displayContent, false, msg.reasoning);
      }
    });

    scrollToBottom(true);
    updateTokenInfo();
    historyPanel.classList.add("hidden");

    // Give the loaded conversation a fresh Nano context (the old chat's turns must not leak in)
    if (activeBackend === "nano" && session) {
      resetNanoChat().then(hideStatus).catch((err) => {
        console.warn("[MyLocalAI] Could not reset Nano chat:", err.message);
      });
    }
  }

  function renderHistoryList() {
    historyList.innerHTML = "";
    if (chatSessions.length === 0) {
      historyList.innerHTML = `<div class="history-empty">No past chats found.</div>`;
      return;
    }

    chatSessions.forEach(s => {
      const el = document.createElement("div");
      el.className = `history-item ${s.id === currentSessionId ? "active" : ""}`;

      const dateStr = new Date(s.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      const contentDiv = document.createElement("div");
      contentDiv.className = "history-item-content";
      
      const titleDiv = document.createElement("div");
      titleDiv.className = "history-item-title";
      // Recompute from history so chats saved before titles were cleaned don't show image data.
      const title = s.history?.length ? extractTitle(s.history) : s.title;
      titleDiv.title = title;
      titleDiv.textContent = title;
      
      const dateDiv = document.createElement("div");
      dateDiv.className = "history-item-date";
      dateDiv.textContent = dateStr;
      
      contentDiv.appendChild(titleDiv);
      contentDiv.appendChild(dateDiv);
      
      const delBtn = document.createElement("button");
      delBtn.className = "btn-delete-chat";
      delBtn.dataset.id = s.id;
      delBtn.title = "Delete chat";
      
      const doc = new DOMParser().parseFromString(`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `, "image/svg+xml");
      delBtn.appendChild(doc.documentElement);
      
      el.appendChild(contentDiv);
      el.appendChild(delBtn);

      el.querySelector('.history-item-content').addEventListener("click", () => {
        if (isGenerating) return;
        loadConversation(s.id);
      });

      el.querySelector('.btn-delete-chat').addEventListener("click", (e) => {
        e.stopPropagation();
        if (isGenerating) return;
        deleteConversation(s.id);
      });

      historyList.appendChild(el);
    });
  }

  function deleteConversation(id) {
    chatSessions = chatSessions.filter(s => s.id !== id);
    saveAllSessions();
    renderHistoryList();

    if (id === currentSessionId) {
      startNewChat();
    }
  }

  async function startNewChat() {
    if (isGenerating) stopGeneration();
    chatHistory = [];
    currentSessionId = Date.now().toString();
    clearContext();
    clearAttachedImage();
    messagesEl.innerHTML = "";
    messagesEl.classList.add("hidden");
    welcomeScreen.classList.remove("hidden");

    try {
      if (activeBackend === "nano") {
        await resetNanoChat();
        hideStatus();
      }
    } catch (_) { }
    updateTokenInfo();
    refreshAutoScreenshot("open"); // a new chat starts with the page you're on
  }

  // ===================== INIT =====================
  init();
  loadPreferredVoice();

  async function init() {
    loadSettings();
    clearTimeout(idleUnloadTimer);
    // Saved chats stay in History, but opening the panel always starts a fresh chat
    // (currentSessionId is already a new id), so old context never leaks into a new task.
    loadSessions();
    browserName = await detectBrowser();
    applyEditionUI();
    showStatus("loading", "Initializing…", initStatusMessage());
    setupEventListeners();
    requestPendingSelectedContext();

    // Try Gemini Nano first, then Ollama (whichever this edition enables)
    if (nanoEnabled) {
      try {
        await initNanoSession();
        activeBackend = "nano";
        updateBackendUI();
        hideStatus();
        refreshAutoScreenshot("open");
        scheduleIdleUnload();
        return;
      } catch (nanoErr) {
        console.warn("[MyLocalAI] Gemini Nano not available:", nanoErr.message);
        lastNanoError = nanoErr.message;
      }
    }

    if (ollamaEnabled) {
      try {
        await initOllamaSession();
        activeBackend = "ollama";
        updateBackendUI();
        hideStatus();
        refreshAutoScreenshot("open");
        scheduleIdleUnload();
        return;
      } catch (ollamaErr) {
        console.warn("[MyLocalAI] Ollama not available:", ollamaErr.message);
      }
    }

    // Nothing worked
    activeBackend = null;
    showStatus("error", errorTitle(), getErrorMessage());
  }

  // ===================== EDITION UI =====================
  function applyEditionUI() {
    ollamaSettings.classList.toggle("hidden", !ollamaEnabled);
    ollamaSettingsLabel.textContent = nanoEnabled
      ? "Ollama · fallback for non-Chrome browsers"
      : "Ollama";

    if (nanoEnabled && !ollamaEnabled) document.title = "MyLocalAI — Gemini Nano";
    else if (ollamaEnabled && !nanoEnabled) document.title = "MyLocalAI — Ollama";
    else document.title = "MyLocalAI — Local AI Chat";
  }

  function initStatusMessage() {
    if (nanoEnabled && !ollamaEnabled) return "Checking Gemini Nano availability";
    if (ollamaEnabled && !nanoEnabled) return "Connecting to Ollama";
    return "Looking for an available AI backend";
  }

  function errorTitle() {
    if (nanoEnabled && !ollamaEnabled) return "Gemini Nano Not Available";
    if (ollamaEnabled && !nanoEnabled) return "Can't Reach Ollama";
    return "No AI Backend Found";
  }

  // ===================== BACKEND UI =====================
  function updateBackendUI() {
    if (activeBackend === "nano") {
      headerBadge.textContent = "Gemini Nano · On-Device";
      headerBadge.style.color = "";
      backendHint.textContent = modelSupportsVision
        ? "Gemini Nano · 100% on-device · images"
        : "Gemini Nano · 100% on-device";
      welcomeSub.textContent = "Powered by Gemini Nano — running entirely on your device. Private. Fast. Offline.";
      setAttachAvailable(modelSupportsVision);
    } else if (activeBackend === "ollama") {
      const model = getOllamaModel();
      const statusText = isOllamaModelValid ? "" : " ⚠️ (Not a locall model)";
      headerBadge.textContent = `Ollama · ${model}${statusText}`;
      headerBadge.style.color = isOllamaModelValid ? "" : "#F87171";

      const isCloud = model.includes(":cloud") || model.includes("-cloud");
      backendHint.textContent = isCloud ? `Ollama (${model}) · cloud` : `Ollama (${model}) · 100% local`;
      welcomeSub.textContent = isCloud
        ? `Powered by Ollama (${model}) — routed through Ollama cloud. Fast.`
        : `Powered by Ollama (${model}) — running locally on your machine. Private. Fast.`;

      setAttachAvailable(modelSupportsVision);
    } else {
      headerBadge.textContent = "Disconnected";
      headerBadge.style.color = "";
      backendHint.textContent = "No backend available";
      setAttachAvailable(false);
    }
  }

  // ===================== GEMINI NANO BACKEND =====================
  async function initNanoSession() {
    let lm = null;
    modelSupportsVision = false;
    modelSupportsThinking = false;

    if (typeof LanguageModel !== "undefined") {
      lm = LanguageModel;
      console.log("[MyLocalAI] Found: global LanguageModel");
    } else if (typeof ai !== "undefined" && ai?.languageModel) {
      lm = ai.languageModel;
      console.log("[MyLocalAI] Found: ai.languageModel");
    } else if (typeof self !== "undefined" && self?.ai?.languageModel) {
      lm = self.ai.languageModel;
      console.log("[MyLocalAI] Found: self.ai.languageModel");
    }

    if (!lm) throw new Error("NO_NANO_API");

    const nanoTextOptions = {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    };
    const nanoVisionOptions = {
      expectedInputs: [
        { type: "text", languages: ["en"] },
        { type: "image", languages: ["en"] },
      ],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    };
    const nanoLegacyOptions = {
      expectedLanguage: "en",
      outputLanguage: "en",
    };
    let useTypedNanoOptions = true;

    // Check readiness
    if (typeof lm.availability === "function") {
      let avail;
      try {
        avail = await lm.availability(nanoTextOptions);
      } catch (e) {
        useTypedNanoOptions = false;
        console.warn("[MyLocalAI] Nano typed availability check failed, retrying legacy options:", e.message);
        avail = await lm.availability(nanoLegacyOptions);
      }
      console.log("[MyLocalAI] Nano availability:", avail);
      if (avail === "unavailable" || avail === "no") throw new Error("NANO_UNAVAILABLE");
      if ((avail === "downloadable" || avail === "after-download") &&
          navigator.userActivation && !navigator.userActivation.isActive) {
        // create() needs a user gesture to start the download; Retry button click provides one.
        throw new Error("NANO_NEEDS_GESTURE");
      }
      if (avail === "downloadable" || avail === "downloading" || avail === "after-download") {
        showStatus("loading", "Downloading Gemini Nano…", nanoDownloadExplanation());
      }

      try {
        const visionAvail = await lm.availability(nanoVisionOptions);
        modelSupportsVision = visionAvail !== "unavailable" && visionAvail !== "no";
        console.log("[MyLocalAI] Nano vision availability:", visionAvail);
      } catch (e) {
        console.warn("[MyLocalAI] Nano vision availability check failed:", e.message);
      }
    } else if (typeof lm.capabilities === "function") {
      const caps = await lm.capabilities(nanoLegacyOptions);
      console.log("[MyLocalAI] Nano capabilities:", JSON.stringify(caps));
      if (caps.available === "no") throw new Error("NANO_UNAVAILABLE");
    }

    // Create session
    let isCreating = true;
    // Current Prompt API: system prompt goes in initialPrompts (systemPrompt was removed).
    // Extensions must pass temperature and topK together, or neither.
    const systemText = sysPromptEl.value.trim() || DEFAULT_SYSTEM_PROMPT;
    const options = {
      initialPrompts: [{ role: "system", content: systemText }],
      temperature: parseFloat(tempSlider.value),
      topK: parseInt(topkSlider.value, 10),
    };

    const createOptions = {
      ...options,
      ...(useTypedNanoOptions ? (modelSupportsVision ? nanoVisionOptions : nanoTextOptions) : {}),
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          if (!isCreating) return; // Prevent late events from getting the UI stuck
          const status = nanoDownloadStatus(e.loaded, e.total);
          showStatus("loading", status.title, status.message);
        });
      },
    };

    // Recreating the base session (settings change, reload after idle) must not leak the old one.
    destroyNanoSessions();
    let created;
    try {
      created = await lm.create(createOptions);
    } catch (e) {
      if (!modelSupportsVision) {
        if (!useTypedNanoOptions) throw e;
        console.warn("[MyLocalAI] Nano typed session failed, retrying legacy options:", e.message);
        created = await lm.create({
          ...options,
          monitor: createOptions.monitor,
        });
      } else {
        console.warn("[MyLocalAI] Nano vision session failed, retrying text-only:", e.message);
        modelSupportsVision = false;
        created = await lm.create({
          ...options,
          ...nanoTextOptions,
          monitor: createOptions.monitor,
        });
      }
    }

    isCreating = false;
    nanoBaseSession = created;
    session = await cloneNanoBaseSession();
    isModelUnloaded = false;
    await applyNanoParamLimits(lm);
    hideStatus();

    console.log("[MyLocalAI] Nano session created. contextWindow:", nanoWindow(), "Vision:", modelSupportsVision);
    updateTokenInfo();
  }

  // Context accounting: new names (contextWindow/contextUsage/measureContextUsage) with legacy fallbacks.
  function nanoWindow() { return session?.contextWindow ?? session?.maxTokens ?? 0; }
  function nanoUsed() { return session?.contextUsage ?? session?.tokensSoFar ?? 0; }
  function nanoMeasure(text) {
    if (typeof session?.measureContextUsage === "function") return session.measureContextUsage(text);
    return session.countPromptTokens(text);
  }

  // ── Nano session lifecycle (base session + one clone per chat) ──
  // Older Chrome builds have no clone(); then the base session itself becomes the chat
  // session and the next new chat falls back to a full initNanoSession().
  async function cloneNanoBaseSession() {
    let chatSession;
    if (typeof nanoBaseSession?.clone === "function") {
      chatSession = await nanoBaseSession.clone();
    } else {
      chatSession = nanoBaseSession;
      nanoBaseSession = null;
    }
    watchNanoContextOverflow(chatSession);
    nanoContextTrimmed = false;
    return chatSession;
  }

  // Fresh Nano context for a new or reloaded chat without reloading the model.
  async function resetNanoChat() {
    // After an idle unload there is no context to reset. Reloading here (e.g. on "New chat")
    // would pull the model back into RAM with no idle timer running, so it would never be
    // freed again; the next send reloads it through ensureModelLoaded() instead.
    if (isModelUnloaded) return;
    if (!nanoBaseSession) {
      await initNanoSession();
      return;
    }
    releaseNanoVariantSessions();
    try { session?.destroy(); } catch (_) { }
    session = await cloneNanoBaseSession();
  }

  // ── Multi-answer replies ──
  // One session runs one prompt at a time, so each parallel answer gets its own clone of the
  // chat session. Clones are taken before prompting, so every answer sees the same chat so far.
  // Older Chrome builds without clone() (or a failed clone) simply produce fewer answers.
  async function createNanoVariantSessions(count) {
    releaseNanoVariantSessions();
    const sessions = [session];
    while (sessions.length < count && typeof session?.clone === "function") {
      try {
        const clone = await session.clone();
        watchNanoContextOverflow(clone);
        sessions.push(clone);
      } catch (err) {
        console.warn("[MyLocalAI] Could not clone Nano session for an extra answer:", err.message);
        break;
      }
    }
    nanoVariantSessions = sessions;
    return sessions;
  }

  // The chat continues from the selected answer, so its session becomes the chat session.
  // The others stay alive until the next message, in case the user switches answers.
  function adoptNanoVariant(index) {
    const chosen = nanoVariantSessions[index];
    if (chosen) session = chosen;
  }

  function releaseNanoVariantSessions() {
    for (const s of nanoVariantSessions) {
      if (s === session) continue;
      try { s?.destroy(); } catch (_) { }
    }
    nanoVariantSessions = [];
  }

  function destroyNanoSessions() {
    releaseNanoVariantSessions();
    // The base session can be the same object as the chat session (no-clone fallback).
    for (const s of new Set([session, nanoBaseSession])) {
      try { s?.destroy(); } catch (_) { }
    }
    session = null;
    nanoBaseSession = null;
  }

  // When the context window fills, Nano silently drops the oldest turns (the system
  // prompt is kept). Tell the user, because the model now "forgets" early messages.
  function watchNanoContextOverflow(chatSession) {
    if (typeof chatSession?.addEventListener !== "function") return;
    chatSession.addEventListener("contextoverflow", () => {
      nanoContextTrimmed = true;
      updateTokenInfo();
    });
  }

  // downloadprogress reports loaded as a 0–1 fraction (total is 1). Reaching 1 means
  // the bytes are here but Chrome still has to unpack and load the model, which can
  // take a while, so show that as its own step instead of hiding the overlay.
  function nanoDownloadStatus(loaded, total = 1) {
    const fraction = total > 0 ? loaded / total : 0;
    if (fraction >= 1) {
      return { title: "Preparing Gemini Nano…", message: "Download finished. Unpacking and loading the model into memory." };
    }
    const pct = Math.min(99, Math.round(fraction * 100));
    return { title: "Downloading Gemini Nano…", message: `${nanoDownloadExplanation()}\n\nProgress: ${pct}%` };
  }

  // Chrome can delete the model to free disk space and fetches it again on demand, so
  // don't promise a one-time download.
  function nanoDownloadExplanation() {
    return [
      "Chrome is downloading the on-device model. The chat is ready once it finishes.",
      "This usually happens once, but Chrome may download it again after an update",
      "or if it removed the model to free up disk space.",
    ].join("\n");
  }

  // Chrome reports the real Top-K / temperature range for this device; widen or narrow
  // the shared sliders to match so users can't pick a value Nano would reject.
  async function applyNanoParamLimits(lm) {
    if (typeof lm?.params !== "function") return;
    try {
      // Chrome resolves params() to null when the model isn't ready on this device yet;
      // keep the default slider ranges in that case instead of throwing.
      const limits = await lm.params();
      if (!limits) return;
      const { maxTopK, maxTemperature } = limits;
      if (maxTopK > 0) topkSlider.max = String(maxTopK);
      if (maxTemperature > 0) tempSlider.max = String(maxTemperature);
      topkValue.textContent = topkSlider.value;
      tempValue.textContent = tempSlider.value;
    } catch (e) {
      console.warn("[MyLocalAI] LanguageModel.params() failed:", e.message);
    }
  }

  // Readable explanation for a failed Nano prompt.
  function describeNanoPromptError(err) {
    if (err?.name === "QuotaExceededError") {
      const detail = err.requested && err.contextWindow
        ? ` (${err.requested.toLocaleString()} tokens needed, window is ${err.contextWindow.toLocaleString()})`
        : "";
      return `⚠️ This message is too long for Gemini Nano${detail}.\n\nShorten it or the selected context, or start a new chat.`;
    }
    return `⚠️ Error: ${err.message}`;
  }

  // Chrome may delete the model at any time (low disk, policy), even mid-session. After a
  // failed prompt, check whether that happened; if so, mark the model unloaded so the next
  // send (a user gesture, which a re-download needs) runs initNanoSession() again.
  async function recoverIfNanoModelRemoved() {
    if (typeof LanguageModel === "undefined" || typeof LanguageModel.availability !== "function") return false;
    try {
      const avail = await LanguageModel.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      });
      if (avail === "available") return false;
      destroyNanoSessions();
      isModelUnloaded = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  // ===================== OLLAMA BACKEND =====================
  async function initOllamaSession() {
    const baseUrl = getOllamaUrl();
    const model = getOllamaModel();

    // Test connection — hit the /api/tags endpoint
    let resp;
    try {
      resp = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, REQUEST_TIMEOUT_MS);
    } catch (fetchErr) {
      throw new Error(fetchErr.name === "TimeoutError" ? "OLLAMA_TIMEOUT" : "OLLAMA_CONNECT_FAILED");
    }

    if (!resp.ok) throw new Error(`OLLAMA_CONNECT_FAILED_${resp.status}`);

    let data;
    try {
      data = await resp.json();
    } catch (_) {
      throw new Error("OLLAMA_INVALID_RESPONSE");
    }
    const models = (data.models || []).map((m) => m.name);
    console.log("[MyLocalAI] Ollama models available:", models);

    // Check if the requested model exists in local tags
    const modelExistsLocally = models.some((m) => m === model || m.startsWith(model.split(":")[0]));
    const isCloudModel = model.includes(":cloud") || model.includes("-cloud");

    // Session is just "connection verified" for Ollama
    session = null; // no persistent session object for Ollama
    isModelUnloaded = false;
    modelSupportsVision = false;
    modelSupportsThinking = false;

    // Try /api/show to detect capabilities.
    // Works for local models and pulled cloud models.
    // May fail for cloud models that haven't been explicitly pulled yet.
    let showSucceeded = false;
    try {
      const showResp = await fetchWithTimeout(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model })
      }, REQUEST_TIMEOUT_MS);
      if (showResp.ok) {
        showSucceeded = true;
        const showData = await showResp.json();
        const caps = showData.capabilities || [];
        const families = showData.details?.families || [];
        console.log(`[MyLocalAI] Model "${model}" capabilities:`, caps, "families:", families);

        // Vision detection from API
        modelSupportsVision = caps.includes("vision") ||
          families.some(f => f.toLowerCase().includes('clip') || f.toLowerCase().includes('vision'));

        // Thinking detection from API
        modelSupportsThinking = caps.includes("thinking");
      }
    } catch (e) {
      console.warn(`[MyLocalAI] /api/show request failed for "${model}":`, e.message);
    }

    // If /api/show didn't work, fall back to name-based heuristics.
    // This covers cloud models that haven't been pulled yet but will
    // auto-pull when the user sends a chat request.
    if (!showSucceeded) {
      const lowerModel = model.toLowerCase();

      // Name-based vision heuristics
      modelSupportsVision =
        lowerModel.includes('llava') ||
        lowerModel.includes('vision') ||
        lowerModel.includes('minicpm') ||
        lowerModel.startsWith('gemma3') ||
        lowerModel.startsWith('gemma4');

      // Name-based thinking heuristics
      modelSupportsThinking =
        lowerModel.includes('deepseek-r1') ||
        lowerModel.includes('qwq') ||
        lowerModel.startsWith('gemma4');

      console.info(`[MyLocalAI] /api/show unavailable for "${model}". Using name heuristics. Vision: ${modelSupportsVision}, Thinking: ${modelSupportsThinking}`);
    }

    // Determine validity:
    // - /api/show succeeded → definitely valid
    // - Cloud model → assume valid (Ollama will auto-pull on first prompt)
    // - In local tags → valid
    // - Otherwise → might still work (Ollama can pull on demand), treat as valid but warn
    isOllamaModelValid = showSucceeded || isCloudModel || modelExistsLocally;
    if (!isOllamaModelValid) {
      console.warn(`[MyLocalAI] Model "${model}" not found locally or in cloud. It may be pulled on first use.`);
      isOllamaModelValid = true; // Don't block — Ollama will attempt to pull
    }

    console.log(`[MyLocalAI] Ollama ready at ${baseUrl} with model ${model}. Vision: ${modelSupportsVision}, Thinking: ${modelSupportsThinking}`);
  }

  async function ollamaPromptStreaming(text, signal, attachedImage = null) {
    const baseUrl = getOllamaUrl();
    const model = getOllamaModel();
    const systemPrompt = sysPromptEl.value.trim() || DEFAULT_SYSTEM_PROMPT;

    // Build messages array for multi-turn conversation. sendMessage() already
    // stores the current user message before streaming, so chatHistory is the
    // single source of truth here.
    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory.slice(-MAX_CHAT_MESSAGES).map(m => {
        // Strip __IMG__ tag from history string payload, pass as array for Ollama
        if (m.role === "user" && m.content.includes("__IMG__")) {
          const parts = m.content.split("__IMG__");
          return { role: m.role, content: parts[0], images: parts[1] ? [parts[1]] : undefined };
        }
        // Only the selected answer (already in `content`) belongs in the prompt;
        // the unused alternatives would just waste the model's context.
        const { variants, selected, ...message } = m;
        return message;
      }),
    ];

    const requestBody = {
      model,
      messages,
      stream: true,
      options: {
        temperature: parseFloat(tempSlider.value),
        top_k: parseInt(topkSlider.value, 10),
      },
    };

    // Enable thinking for models that support it
    if (modelSupportsThinking) {
      requestBody.think = true;
    }

    const resp = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }, GENERATION_TIMEOUT_MS, signal);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown error");
      throw new Error(`Ollama error (${resp.status}): ${errText.slice(0, 500)}`);
    }

    if (!resp.body || typeof resp.body.getReader !== "function") {
      throw new Error("Ollama returned no readable stream");
    }

    return resp.body;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortExternal = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abortExternal, { once: true });
    }

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !externalSignal?.aborted) {
        const timeoutError = new Error(`Request timed out after ${timeoutMs / 1000}s`);
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortExternal);
    }
  }

  // ===================== DESTROY / RESTART =====================
  // Releases the model completely (chat clone and base session); used for restart and idle unload.
  async function destroySession() {
    destroyNanoSessions();
  }

  async function restartSession() {
    await destroySession();
    chatHistory = [];
    activeBackend = null;
    clearAttachedImage();
    showStatus("loading", "Restarting…", "Reconnecting to AI backend");
    await init();
  }

  // ===================== IDLE UNLOAD (free memory) =====================
  // Chat history lives in the UI/storage, so releasing the model loses nothing visible.
  // Nano forgets its in-model context after a reload; Ollama re-sends history on each request.
  function scheduleIdleUnload() {
    clearTimeout(idleUnloadTimer);
    const delayMs = getIdleUnloadMs();
    if (!activeBackend || delayMs === 0) return;
    idleUnloadTimer = setTimeout(unloadModel, delayMs);
  }

  async function unloadModel() {
    if (isGenerating || isModelUnloaded || !activeBackend) return;
    if (activeBackend === "nano") {
      await destroySession();
    } else {
      await unloadOllamaModel();
    }
    isModelUnloaded = true;
    // Chrome frees Nano's RAM only once no session is alive, and then waits its own idle delay
    // (about 1 minute in Chromium's on_device_model_idle_timeout) before the model process exits.
    console.log("[MyLocalAI] Model released after idle period; Chrome frees the memory shortly after.");
  }

  // Ollama keeps a model resident for its own keep_alive window; keep_alive: 0 evicts it now.
  async function unloadOllamaModel() {
    try {
      await fetchWithTimeout(`${getOllamaUrl()}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: getOllamaModel(), keep_alive: 0 }),
      }, REQUEST_TIMEOUT_MS);
    } catch (err) {
      console.warn("[MyLocalAI] Could not unload Ollama model:", err.message);
    }
  }

  // Ollama reloads its model on the next request by itself; only Nano needs a new session.
  async function ensureModelLoaded() {
    clearTimeout(idleUnloadTimer);
    if (!isModelUnloaded) return;
    if (activeBackend === "nano") {
      showStatus("loading", "Reloading model…", "Loading Gemini Nano back into memory");
      await initNanoSession();
      hideStatus();
    }
    isModelUnloaded = false;
  }

  // ===================== CHAT LOGIC =====================
  async function sendMessage(text) {
    if ((!text.trim() && !currentAttachedImage) || isGenerating) return;
    if (!activeBackend) return;

    try {
      await ensureModelLoaded();
    } catch (err) {
      console.error("[MyLocalAI] Model reload failed:", err);
      hideStatus();
      welcomeScreen.classList.add("hidden");
      messagesEl.classList.remove("hidden");
      appendMessage("ai", `⚠️ Could not reload the model: ${err.message}`);
      scheduleIdleUnload();
      return;
    }

    const imageToSend = currentAttachedImage;
    const typedPrompt = text.trim() || "Describe this image.";
    let finalPrompt = typedPrompt;
    if (currentContextText) {
      finalPrompt = `Context:\n"""\n${currentContextText}\n"""\n\nUser Question:\n${typedPrompt}`;
      // Clear context UI after using it
      clearContext();
    }

    // Token pre-check (Nano only)
    if (activeBackend === "nano" && !imageToSend && session &&
        (typeof session.measureContextUsage === "function" || typeof session.countPromptTokens === "function")) {
      try {
        const tokenPromise = nanoMeasure(finalPrompt);
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 2000));
        const promptTokens = await Promise.race([tokenPromise, timeout]);
        const remaining = Math.max(0, nanoWindow() - nanoUsed());

        if (remaining > 0 && promptTokens > remaining) {
          welcomeScreen.classList.add("hidden");
          messagesEl.classList.remove("hidden");
          appendMessage("ai", `⚠️ Context limit reached!\n\n~${promptTokens} tokens needed, ${remaining} remain.\nStarting a fresh session…`);
          scrollToBottom(true);
          await resetNanoChat();
          chatHistory = [];
          updateTokenInfo();
          appendMessage("ai", "✅ Session reset. Please re-send your message.");
          scrollToBottom(true);
          hideStatus();
          // ensureModelLoaded() stopped the idle timer; this early return skips the finally below.
          scheduleIdleUnload();
          return;
        }
      } catch (_) { /* skip check */ }
    }

    // Show UI
    welcomeScreen.classList.add("hidden");
    messagesEl.classList.remove("hidden");

    // UI display keeps the user's typed text; history keeps the exact prompt
    // sent to the backend so selected context is preserved for Ollama.
    const displayMessage = imageToSend ? `${typedPrompt}__IMG__${imageToSend}` : typedPrompt;
    const historyMessage = imageToSend ? `${finalPrompt}__IMG__${imageToSend}` : finalPrompt;
    appendMessage("user", displayMessage);
    chatHistory.push({ role: "user", content: historyMessage });

    userInput.value = "";
    autoResizeInput();
    btnSend.disabled = true;
    isGenerating = true;
    btnSend.classList.add("hidden");
    btnStop.classList.remove("hidden");

    // Clear image immediately from UI after sending
    clearAttachedImage();

    try {
      abortController = new AbortController();
      // All answers share one AbortController, so Stop ends every stream at once.
      const nanoSessions = activeBackend === "nano"
        ? await createNanoVariantSessions(getResponseCount())
        : null;
      const answerCount = nanoSessions ? nanoSessions.length : getResponseCount();
      const group = appendResponseGroup(answerCount);

      const results = await Promise.allSettled(group.bubbles.map((bubble, i) => {
        const stream = activeBackend === "nano"
          ? streamNano(finalPrompt, bubble, imageToSend, nanoSessions[i])
          : streamOllama(finalPrompt, bubble, imageToSend);
        return stream.finally(() => group.markDone(i));
      }));
      await recordResponses(group, results);
    } catch (err) {
      // Only reached if setting up the reply fails; per-answer errors are shown in their tab.
      console.error("[MyLocalAI] Could not start the reply:", err);
      appendMessage("ai", `⚠️ Error: ${err.message}`);
    } finally {
      isGenerating = false;
      abortController = null;
      btnStop.classList.add("hidden");
      btnSend.classList.remove("hidden");
      btnSend.disabled = !userInput.value.trim();
      updateTokenInfo();
      scheduleIdleUnload();
    }
  }

  // Shows each answer's outcome and stores the reply in history. The chat continues from the
  // first answer that succeeded; the user can switch to another one with the tabs.
  async function recordResponses(group, results) {
    const variants = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        variants.push(result.value);
      } else {
        const errorText = await showResponseError(group.bubbles[i], result.reason);
        group.markFailed(i);
        variants.push({ content: errorText, reasoning: "", failed: true });
      }
    }

    const selected = variants.findIndex(v => !v.failed);
    if (selected === -1) return; // nothing usable (all failed or stopped), as before

    const entry = { role: "assistant", content: variants[selected].content, reasoning: variants[selected].reasoning };
    if (variants.length > 1) {
      entry.variants = variants;
      entry.selected = selected;
    }
    chatHistory.push(entry);
    group.setActive(selected);
    bindVariantSelection(group, entry);
    if (activeBackend === "nano") adoptNanoVariant(selected);
    saveConversation();
  }

  // Renders a failed or stopped answer in its bubble and returns the text that was shown.
  async function showResponseError(bubble, err) {
    if (err?.name === "AbortError") {
      // Preserve the streamed text and any reasoning blocks.
      bubble.dataset.done = "1";
      bubble.style.minHeight = "";
      const currentHtml = bubble.innerHTML.replace('<span class="cursor">​</span>', "");
      setSafeHtml(bubble, currentHtml || "(Generation stopped)");
      bubble.parentElement?.querySelector(".msg-actions")?.classList.remove("hidden");
      return getResponseText(bubble) || "(Generation stopped)";
    }

    let message;
    if (activeBackend === "nano") {
      console.error("[MyLocalAI] Nano prompt error:", err);
      const removed = await recoverIfNanoModelRemoved();
      message = removed
        ? "⚠️ Chrome removed the Gemini Nano model (usually to free disk space).\n\nSend your message again to download it again."
        : describeNanoPromptError(err);
    } else {
      console.error("[MyLocalAI] Prompt error:", err);
      message = `⚠️ Error: ${err?.message}`;
    }
    finalizeMessage(bubble, message);
    return message;
  }

  // ── Nano streaming ──
  // Returns the answer; recordResponses() stores it, because one reply may hold several answers.
  async function streamNano(text, aiBubble, attachedImage = null, chatSession = session) {
    const prompt = attachedImage
      ? [{
          role: "user",
          content: [
            { type: "text", value: text },
            { type: "image", value: await padImageToSquare(base64ToImageBlob(attachedImage)) },
          ],
        }]
      : text;

    const stream = await chatSession.promptStreaming(prompt, {
      signal: abortController.signal,
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk; // Chrome 138+: incremental chunks
      renderStreamingText(aiBubble, fullText);
      scrollToBottom();
    }

    finalizeMessage(aiBubble, fullText);
    return { content: fullText, reasoning: "" };
  }

  // ── Ollama streaming ──
  async function streamOllama(text, aiBubble, attachedImage) {
    const body = await ollamaPromptStreaming(text, abortController.signal, attachedImage);
    const reader = body.getReader();
    const decoder = new TextDecoder();

    let fullText = "";
    let reasoningText = "";
    let inThinkingTag = false;
    let buffer = "";

    const consumeLine = (line) => {
      if (!line.trim()) return;
      const json = JSON.parse(line);
      if (json.error) {
        throw new Error(`Ollama error: ${String(json.error).slice(0, 500)}`);
      }

      // Ollama uses `message.thinking`; older versions may use `reasoning`.
      reasoningText += json.message?.thinking || json.message?.reasoning || "";

      if (json.message?.content) {
        let contentChunk = json.message.content;

        // Handle models that embed reasoning in <think> tags.
        if (contentChunk.includes("<think>")) {
          inThinkingTag = true;
          const parts = contentChunk.split("<think>");
          if (parts[0]) fullText += parts[0];
          contentChunk = parts[1] || "";
        }

        if (inThinkingTag) {
          if (contentChunk.includes("</think>")) {
            inThinkingTag = false;
            const parts = contentChunk.split("</think>");
            reasoningText += parts[0];
            fullText += parts[1] || "";
          } else {
            reasoningText += contentChunk;
          }
        } else {
          fullText += contentChunk;
        }
      }

      renderStreamingText(aiBubble, fullText, reasoningText);
      scrollToBottom();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        try {
          consumeLine(line);
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new Error("Ollama protocol error: malformed NDJSON frame");
          }
          throw error;
        }
      }
    }

    // Flush decoder so split UTF-8 characters are completed before parsing.
    buffer += decoder.decode();
    const finalLines = buffer.split("\n");
    buffer = finalLines.pop() || "";

    for (const line of finalLines) {
      try {
        consumeLine(line);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Ollama protocol error: malformed NDJSON frame");
        }
        throw error;
      }
    }

    // Some proxies return final NDJSON object without a trailing newline.
    if (buffer.trim()) {
      try {
        consumeLine(buffer);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Ollama protocol error: malformed NDJSON frame");
        }
        throw error;
      }
    }

    finalizeMessage(aiBubble, fullText, reasoningText);
    return { content: fullText, reasoning: reasoningText };
  }

  function stopGeneration() {
    if (abortController) abortController.abort();
  }

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
        const parts = text.split("__IMG__");
        bubble.textContent = parts[0];
        if (parts[1]) {
          bubble.appendChild(document.createElement("br"));
          const img = document.createElement("img");
          img.src = `data:image/jpeg;base64,${parts[1]}`;
          img.alt = "Attached image";
          bubble.appendChild(img);
        }
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

  // ===================== RESPONSE ACTIONS (copy / speak) =====================
  // Reads the rendered answer at click time so it is correct for streamed and
  // restored messages alike. The "Thinking..." block is not part of the answer.
  function getResponseText(bubble) {
    const clone = bubble.cloneNode(true);
    clone.querySelectorAll(".thinking-block, .code-header").forEach(el => el.remove());
    return clone.textContent.trim();
  }

  function createResponseActions(bubble, visible) {
    const row = document.createElement("div");
    row.className = "msg-actions";
    if (!visible) row.classList.add("hidden");

    const copyBtn = createActionButton("Copy", "Copy response");
    copyBtn.addEventListener("click", () => copyResponse(bubble, copyBtn));

    const speakBtn = createActionButton("Hear", "Read response aloud");
    speakBtn.addEventListener("click", () => toggleSpeech(bubble, speakBtn));

    row.appendChild(copyBtn);
    row.appendChild(speakBtn);
    return row;
  }

  function createActionButton(text, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msg-action-btn";
    btn.textContent = text;
    btn.title = title;
    return btn;
  }

  async function copyResponse(bubble, button) {
    try {
      await navigator.clipboard.writeText(getResponseText(bubble));
      flashButtonLabel(button, "Copied!");
    } catch {
      flashButtonLabel(button, "Failed");
    }
  }

  function flashButtonLabel(button, text) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = text;
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  // Without an explicit voice Chrome falls back to the OS default, which is often a
  // robotic one. We pick the most natural-sounding voice matching the UI language.
  let preferredVoiceName;

  // Higher score = more natural. "Google" voices are neural; macOS "Enhanced"/"Premium"
  // and Windows "Natural" voices are the high-quality OS ones.
  function scoreVoice(voice) {
    let score = 0;
    if (/natural|neural|premium|enhanced/i.test(voice.voiceName)) score += 3;
    if (/^google/i.test(voice.voiceName)) score += 2;
    if (voice.remote === false) score += 1; // local voices start instantly, work offline
    return score;
  }

  function pickBestVoice(voices, language) {
    const base = language.split("-")[0].toLowerCase();
    const matching = voices.filter(v => (v.lang || "").toLowerCase().startsWith(base));
    const ranked = matching.sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return ranked.length ? ranked[0].voiceName : undefined;
  }

  function loadPreferredVoice() {
    if (!chrome.tts) return;
    chrome.tts.getVoices(voices => {
      preferredVoiceName = pickBestVoice(voices || [], navigator.language || "en");
    });
  }

  // Raw markdown output sounds broken when spoken ("asterisk asterisk", URLs, code).
  function cleanTextForSpeech(text) {
    return text
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/[*_`#>~|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Uses Chrome's text-to-speech API (needs the "tts" permission).
  // Clicking again while speaking stops playback.
  function toggleSpeech(bubble, button) {
    if (!chrome.tts) {
      flashButtonLabel(button, "Unsupported");
      return;
    }
    const wasSpeakingThis = button.classList.contains("speaking");
    stopAllSpeech();
    if (wasSpeakingThis) return;

    const reset = () => {
      button.classList.remove("speaking");
      button.textContent = "Hear";
    };
    button.classList.add("speaking");
    button.textContent = "Stop";
    chrome.tts.speak(cleanTextForSpeech(getResponseText(bubble)), {
      voiceName: preferredVoiceName,
      lang: preferredVoiceName ? undefined : navigator.language,
      // "end" fires on completion; "interrupted"/"cancelled"/"error" when stopped early.
      onEvent: (event) => {
        if (["end", "interrupted", "cancelled", "error"].includes(event.type)) reset();
      },
    });
  }

  function stopAllSpeech() {
    chrome.tts.stop();
    messagesEl.querySelectorAll(".msg-action-btn.speaking").forEach(btn => {
      btn.classList.remove("speaking");
      btn.textContent = "Hear";
    });
  }

  function processImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (!canAttachImages()) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      attachImageDataUrl(e.target.result, MAX_UPLOAD_IMAGE_SIDE)
        .catch((err) => console.warn("[MyLocalAI] Could not read image:", err));
    };
    reader.readAsDataURL(file);
  }

  // Shrinks an image so its longest side is at most maxSide and re-encodes it as JPEG
  // (quality 0.7) to keep prompts and saved history small.
  function compressImageDataUrl(dataUrl, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => reject(new Error("Image could not be decoded"));
      img.src = dataUrl;
    });
  }

  // Makes an image the pending attachment and shows it in the preview card.
  async function attachImageDataUrl(dataUrl, maxSide, label = "Attached image") {
    const compressed = await compressImageDataUrl(dataUrl, maxSide);
    currentAttachedImage = compressed.split(",")[1];
    attachedImageIsAuto = false; // automatic callers set it back to true after this
    imagePreviewImg.src = compressed;
    imagePreviewText.textContent = label;
    imagePreviewCard.classList.remove("hidden");
    btnSend.disabled = isGenerating;
  }

  function clearAttachedImage() {
    currentAttachedImage = null;
    imagePreviewCard.classList.add("hidden");
    imagePreviewImg.src = "";
    imagePreviewText.textContent = "Attached image";
    attachedImageIsAuto = false;
    fileUpload.value = "";
    if (!userInput.value.trim()) {
      btnSend.disabled = true;
    }
  }

  function canAttachImages() {
    return (activeBackend === "nano" || activeBackend === "ollama") && modelSupportsVision;
  }

  function base64ToImageBlob(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: "image/jpeg" });
  }

  // squashes every image into a square, so a wide screenshot gets its
  // text distorted (Chrome logs "Image input will be stretched..."). Letterboxing it
  // onto a square canvas keeps the original proportions. Only the copy sent to Nano
  // is padded; the preview, saved history and Ollama keep the original image.
  async function padImageToSquare(imageBlob) {
    const bitmap = await createImageBitmap(imageBlob);
    const { width, height } = bitmap;
    if (width === height) {
      bitmap.close();
      return imageBlob;
    }

    const side = Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    // White bars: JPEG has no transparency, and most screenshots are light.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(bitmap, Math.round((side - width) / 2), Math.round((side - height) / 2));
    bitmap.close();

    return new Promise((resolve) => {
      // Fall back to the unpadded image rather than failing the whole prompt.
      canvas.toBlob((blob) => resolve(blob || imageBlob), "image/jpeg", 0.85);
    });
  }

  function getImageFileFromItems(items) {
    if (!items) return null;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        return item.getAsFile();
      }
    }
    return null;
  }

  function getImageFileFromFiles(files) {
    if (!files) return null;
    for (const file of files) {
      if (file.type.startsWith("image/")) return file;
    }
    return null;
  }

  // Streaming render: coalesced to one DOM update per frame, and the bubble
  // can only grow while streaming (min-height ratchet) so half-parsed markdown
  // never makes the response area jump smaller.
  function renderStreamingText(bubble, text, reasoning = "") {
    const pending = pendingRenders.get(bubble);
    if (pending) { pending.text = text; pending.reasoning = reasoning; return; }
    pendingRenders.set(bubble, { text, reasoning });
    requestAnimationFrame(() => {
      const job = pendingRenders.get(bubble);
      pendingRenders.delete(bubble);
      if (!job || bubble.dataset.done) return;
      let html = "";
      if (job.reasoning) {
        html += `<details class="thinking-block" open><summary>Thinking...</summary><div class="thinking-content">${formatResponseText(job.reasoning)}</div></details>`;
      }
      html += formatResponseText(job.text) + '<span class="cursor">\u200B</span>';
      setSafeHtml(bubble, html);
      const h = bubble.offsetHeight;
      if (h > (parseFloat(bubble.style.minHeight) || 0)) bubble.style.minHeight = h + "px";
      scrollToBottom();
    });
  }

  function finalizeMessage(bubble, text, reasoning = "") {
    bubble.dataset.done = "1";
    pendingRenders.delete(bubble);
    bubble.style.minHeight = "";
    let html = "";
    if (reasoning) {
      // close it when finished
      html += `<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">${formatResponseText(reasoning)}</div></details>`;
    }
    html += formatResponseText(text);
    setSafeHtml(bubble, html);
    const actions = bubble.parentElement?.querySelector(".msg-actions");
    if (actions) actions.classList.remove("hidden");
  }

  // Markdown rendering via the vendored `marked` library (GFM: tables, lists,
  // task lists, strikethrough…). Output is always sanitized by DOMPurify.
  function getMarkdownRenderer() {
    if (markdownRendererCache !== undefined) return markdownRendererCache;
    if (typeof marked === "undefined") return (markdownRendererCache = null);
    const renderer = new marked.Renderer();
    const baseTable = marked.Renderer.prototype.table;

    // Keep the code header + Copy button.
    renderer.code = ({ text, lang }) => {
      const label = escapeHtml((lang || "").split(/\s+/)[0] || "code");
      return `<div class="code-container"><div class="code-header"><span class="code-lang">${label}</span><button class="btn-copy-code" type="button" title="Copy code">Copy</button></div><pre class="code-block"><code>${escapeHtml(text)}</code></pre></div>`;
    };
    // Scrollable wrapper so wide tables don't break the layout.
    renderer.table = function (token) {
      return `<div class="table-container">${baseTable.call(this, token)}</div>`;
    };
    // Never pass raw HTML from the model through; show it as text.
    renderer.html = ({ text }) => escapeHtml(text);

    if (typeof DOMPurify !== "undefined") {
      // Links inside the sidebar must open in a new tab, not replace the chat.
      DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
    }

    return (markdownRendererCache = renderer);
  }

  function formatResponseText(text) {
    if (!text) return "";
    const renderer = getMarkdownRenderer();
    if (!renderer) return escapeHtml(text);
    return marked.parse(text, { gfm: true, breaks: true, async: false, renderer });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function setSafeHtml(element, htmlString) {
    const cleanHtml = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(htmlString) : htmlString;
    const doc = new DOMParser().parseFromString(cleanHtml, "text/html");
    element.replaceChildren(...doc.body.childNodes);
  }

  // Auto-scroll follows the stream only while the user is "pinned" to the
  // bottom. Any upward user scroll unpins; scrolling back down re-pins.
  function scrollToBottom(force = false) {
    if (force) isAutoScrollEnabled = true;
    if (!isAutoScrollEnabled || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (!isAutoScrollEnabled) return;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      lastScrollTop = messagesEl.scrollTop;
    });
  }

  function updateTokenInfo() {
    tokenInfo.title = "";
    if (activeBackend === "nano" && session) {
      const used = nanoUsed();
      const max = nanoWindow();
      const left = Math.max(0, max - used);
      if (max > 0) {
        const pct = Math.round((used / max) * 100);
        const trimmedNote = nanoContextTrimmed ? " · oldest messages forgotten" : "";
        tokenInfo.textContent = `${used.toLocaleString()} / ${max.toLocaleString()} tokens · ${left.toLocaleString()} left${trimmedNote}`;
        if (nanoContextTrimmed) {
          tokenInfo.title = "The conversation outgrew Gemini Nano's context window, so it dropped the earliest turns. Start a new chat for a clean slate.";
        }
        tokenInfo.style.color = pct > 85 ? "#F87171" : pct > 65 ? "#FBBF24" : "";
      }
    } else if (activeBackend === "ollama") {
      tokenInfo.textContent = `${chatHistory.length} messages`;
      tokenInfo.style.color = "";
    } else {
      tokenInfo.textContent = "";
      tokenInfo.style.color = "";
    }
  }

  // ===================== STATUS OVERLAY =====================
  function showStatus(type, title, message) {
    statusOverlay.classList.remove("hidden");
    if (type === "loading") {
      statusSpinner.classList.remove("hidden");
      statusErrIcon.classList.add("hidden");
      statusRetryBtn.classList.add("hidden");
    } else {
      statusSpinner.classList.add("hidden");
      statusErrIcon.classList.remove("hidden");
      statusRetryBtn.classList.remove("hidden");
    }
    statusTitle.textContent = title;
    statusMessage.textContent = message;
  }

  function hideStatus() {
    statusOverlay.classList.add("hidden");
  }

  function getErrorMessage() {
    // Ollama-only edition: Ollama is the only thing that can be wrong.
    if (!nanoEnabled) return ollamaHelpLines().join("\n");

    // Nano-only edition on a non-Chrome browser: point to the Ollama edition.
    if (!ollamaEnabled && browserName !== "chrome") {
      return [
        `You're using ${capitalize(browserName)}. Gemini Nano is built into Google Chrome (desktop) only.`,
        "",
        "Open this extension in Google Chrome, or install the",
        "MyLocalAI Ollama edition, which works in any Chromium browser.",
        "",
        `Details: ${lastNanoError || "unknown"}`,
      ].join("\n");
    }

    // Mixed edition on a non-Chrome browser: Ollama was the realistic option.
    if (ollamaEnabled && browserName !== "chrome") {
      return [
        `You're using ${capitalize(browserName)} (Gemini Nano is Chrome-only).`,
        "",
        "Failed to connect to local Ollama fallback.",
        "",
        ...ollamaHelpLines(),
      ].join("\n");
    }

    // Chrome but Nano not available
    const lines = nanoHelpLines();
    if (ollamaEnabled) {
      lines.push("", "Alternatively, start Ollama locally and click Retry.");
    }
    return lines.join("\n");
  }

  function nanoHelpLines() {
    return [
      lastNanoError === "NANO_NEEDS_GESTURE"
        ? "Gemini Nano is ready to download. Click Retry to start the download."
        : `Gemini Nano is not available (${lastNanoError || "unknown"}).`,
      "",
      "1. chrome://flags/#prompt-api-for-gemini-nano → Enabled",
      "   (and optimization-guide-on-device-model → Enabled BypassPerfRequirement)",
      "2. Relaunch Chrome",
      "3. Open chrome://on-device-internals and check the model status / Broker State for errors",
      "4. Needs ~22 GB free disk, >4 GB VRAM or 16 GB RAM + 4 cores, unmetered network",
      "5. In DevTools run: await LanguageModel.availability()",
      "   (\"downloadable\" needs a click/user gesture, then Retry)",
    ];
  }

  function ollamaHelpLines() {
    const extensionOrigin = typeof chrome !== "undefined" && chrome.runtime?.id
      ? `chrome-extension://${chrome.runtime.id}`
      : "chrome-extension://<your-extension-id>";

    return [
      "Make sure Ollama is running and CORS allows this extension:",
      "1. Open Terminal",
      `2. Run: launchctl setenv OLLAMA_ORIGINS "${extensionOrigin}"`,
      "   (Windows/Linux: see the README)",
      "3. Restart the Ollama desktop app",
      "4. Click Retry below",
    ];
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

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

  function setContextFromSelection(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      clearContext();
      return;
    }

    currentContextText = trimmed;
    const words = trimmed.split(/\s+/);
    const preview = words.slice(0, 3).join(" ");
    contextTextEl.textContent = `"${preview}${words.length > 3 ? "..." : ""}"`;
    contextCard.classList.remove("hidden");
  }

  function requestPendingSelectedContext() {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;

    chrome.runtime.sendMessage({ type: "GET_SELECTED_CONTEXT" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.text) setContextFromSelection(response.text);
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "TEXT_SELECTED") {
        setContextFromSelection(message.text);
      }
    });
  }

  // ===================== ATTACH MENU & TAB SCREENSHOTS =====================
  // The + button only offers image options, so it is hidden when the model has no vision.
  function setAttachAvailable(available) {
    attachWrap.classList.toggle("hidden", !available);
    if (!available) {
      closeAttachMenu();
      clearAttachedImage();
    }
  }

  function toggleAttachMenu() {
    const open = attachMenu.classList.toggle("hidden") === false;
    btnAttach.setAttribute("aria-expanded", String(open));
    if (open) attachMenu.querySelector(".attach-menu-item")?.focus();
  }

  function closeAttachMenu() {
    attachMenu.classList.add("hidden");
    btnAttach.setAttribute("aria-expanded", "false");
  }

  function getTabScreenshotMode() {
    return tabScreenshotSelect.value || DEFAULT_TAB_SCREENSHOT_MODE;
  }

  // chrome.permissions.request only works during a user gesture, so callers must reach it
  // straight from a click/keydown handler, before awaiting anything else.
  function requestTabAccess() {
    if (!chrome.permissions?.request) return Promise.resolve(false);
    return chrome.permissions.request(TAB_ACCESS).catch(() => false);
  }

  function hasTabAccess() {
    if (!chrome.permissions?.contains) return Promise.resolve(false);
    return chrome.permissions.contains(TAB_ACCESS).catch(() => false);
  }

  async function getActiveTab() {
    // In the side panel, "currentWindow" is the window the panel is docked in.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  // Search engines live at their root or under /search; other pages on the same domain
  // (Gmail, Docs, Maps…) are real content and are still captured.
  const SEARCH_ENGINE_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|search\.brave|startpage)\.[a-z.]+$/i;

  function isSearchOrHomePage(url) {
    if (!SEARCH_ENGINE_HOST.test(url.hostname)) return false;
    return url.pathname === "/" || /^\/(search|webhp|web)\b/.test(url.pathname);
  }

  // Auto mode only captures real websites: browser pages (new tab, settings, home) are
  // not http(s), and search result pages add noise rather than context.
  function isWebsiteWorthCapturing(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch (_) { return false; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return !isSearchOrHomePage(url);
  }

  async function attachTabScreenshot(tab) {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
    const label = tab.title ? `Screenshot · ${tab.title}` : "Screenshot of this tab";
    await attachImageDataUrl(dataUrl, MAX_SCREENSHOT_SIDE, label);
  }

  // Puts a screenshot of the current tab in the prompt bar without being asked.
  //   trigger "open":       panel opened, backend (re)started or New chat (open + follow modes)
  //   trigger "tab-change": user switched tab or a page finished loading
  //                         (follow mode, or open mode before the first prompt)
  // Failures are silent: an automatic screenshot is a convenience, never an error.
  async function refreshAutoScreenshot(trigger) {
    const mode = getTabScreenshotMode();
    if (mode === "manual" || !canAttachImages()) return;
    if (trigger === "tab-change" && !followsTabChanges(mode)) return;
    // Never replace an image the user chose themselves.
    if (currentAttachedImage && !attachedImageIsAuto) return;
    if (!(await hasTabAccess())) {
      showScreenshotAccessCard();
      return;
    }
    hideScreenshotAccessCard();

    const tab = await getActiveTab().catch(() => null);
    // Opening/New chat always captures; tab events skip a page that was already captured
    // (e.g. a reload), which also respects the user removing that page's screenshot.
    if (!tab?.url || (trigger === "tab-change" && tab.url === lastAutoScreenshotUrl)) return;
    lastAutoScreenshotUrl = tab.url;
    if (mode === "open" && !isWebsiteWorthCapturing(tab.url)) {
      // Switched to a search/browser page before the first prompt: the previous page's
      // screenshot no longer matches what the user is looking at.
      if (trigger === "tab-change" && attachedImageIsAuto) clearAttachedImage();
      return;
    }
    try {
      await attachTabScreenshot(tab);
      attachedImageIsAuto = true;
    } catch (err) {
      // Protected page (New Tab, Web Store…): drop the previous page's screenshot so the
      // prompt bar doesn't show a page the user has left.
      if (attachedImageIsAuto) clearAttachedImage();
      console.warn("[MyLocalAI] Auto screenshot skipped:", err.message || err);
    }
  }

  // "On open" means the screenshot shows the page the chat starts from, so until the
  // first prompt is sent a tab switch still updates it; after that it stays put.
  function followsTabChanges(mode) {
    return mode === "follow" || (mode === "open" && chatHistory.length === 0);
  }

  // captureVisibleTab is limited to ~2 calls per second, and one navigation fires several
  // tab events, so tab changes are coalesced into one capture after things settle.
  let tabChangeTimer = null;
  function scheduleTabChangeScreenshot() {
    clearTimeout(tabChangeTimer);
    tabChangeTimer = setTimeout(() => refreshAutoScreenshot("tab-change"), TAB_CHANGE_SETTLE_MS);
  }

  // Follows tab switches and page loads in the window this panel belongs to.
  async function watchTabsForScreenshots() {
    if (!chrome.tabs?.onActivated || !chrome.windows?.getCurrent) return;
    const panelWindowId = (await chrome.windows.getCurrent()).id;
    chrome.tabs.onActivated.addListener(({ windowId }) => {
      if (windowId === panelWindowId) scheduleTabChangeScreenshot();
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete" && tab.active && tab.windowId === panelWindowId) {
        scheduleTabChangeScreenshot();
      }
    });
  }

  // Automatic screenshots can't ask for site access themselves (no click to attach the
  // permission prompt to), so a small card in the prompt bar offers the "Allow" click.
  function showScreenshotAccessCard() {
    let dismissed = false;
    try { dismissed = localStorage.getItem("screenshotAccessDismissed") === "1"; } catch (_) { }
    screenshotAccessCard.classList.toggle("hidden", dismissed);
  }

  function hideScreenshotAccessCard() {
    screenshotAccessCard.classList.add("hidden");
  }

  async function allowScreenshotsFromCard() {
    const granted = await requestTabAccess(); // first await: keeps the click's gesture
    if (!granted) return;
    hideScreenshotAccessCard();
    refreshAutoScreenshot("open");
  }

  // Picking an automatic mode is a click, so it can ask for site access right away and
  // show the screenshot immediately; it also undoes an earlier "Not now" on the card.
  async function onTabScreenshotModeChange() {
    saveSettings();
    if (getTabScreenshotMode() === "manual") {
      hideScreenshotAccessCard();
      if (attachedImageIsAuto) clearAttachedImage();
      return;
    }
    const granted = await requestTabAccess(); // first await: keeps the change event's gesture
    try { localStorage.removeItem("screenshotAccessDismissed"); } catch (_) { }
    if (granted) refreshAutoScreenshot("open");
    else showScreenshotAccessCard();
  }

  function dismissScreenshotAccessCard() {
    hideScreenshotAccessCard();
    try { localStorage.setItem("screenshotAccessDismissed", "1"); } catch (_) { }
  }

  // "Screenshot this tab" in the + menu: works on any page Chrome lets us capture.
  async function screenshotTabFromMenu() {
    closeAttachMenu();
    const granted = await requestTabAccess(); // first call, so it still has the click's gesture
    if (!granted) {
      alert("MyLocalAI needs permission to see the page to take a screenshot. Nothing leaves your device.");
      return;
    }
    try {
      const tab = await getActiveTab();
      if (!tab) throw new Error("No active tab");
      await attachTabScreenshot(tab);
      userInput.focus();
    } catch (err) {
      console.warn("[MyLocalAI] Screenshot failed:", err);
      alert("Chrome doesn't allow screenshots of this page (browser pages like the New Tab or Web Store are protected).");
    }
  }

  // ===================== EVENT LISTENERS =====================
  function setupEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    const unpin = () => { isAutoScrollEnabled = false; };
    messagesEl.addEventListener("wheel", (e) => { if (e.deltaY < 0) unpin(); }, { passive: true });
    messagesEl.addEventListener("touchmove", unpin, { passive: true });
    messagesEl.addEventListener("keydown", (e) => {
      if (["ArrowUp", "PageUp", "Home"].includes(e.key)) unpin();
    });
    messagesEl.addEventListener("scroll", () => {
      const top = messagesEl.scrollTop;
      const distance = messagesEl.scrollHeight - top - messagesEl.clientHeight;
      if (top < lastScrollTop - 1) isAutoScrollEnabled = false; // user moved up
      else if (distance <= 24) isAutoScrollEnabled = true;       // back at bottom
      lastScrollTop = top;
    }, { passive: true });

    messagesEl.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-copy-code");
      if (!btn) return;
      const code = btn.closest(".code-container")?.querySelector("code")?.innerText ?? "";
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1500);
      } catch (_) { /* clipboard unavailable */ }
    });

    btnSend.addEventListener("click", () => sendMessage(userInput.value));

    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!btnSend.disabled && !isGenerating) sendMessage(userInput.value);
      }
    });

    userInput.addEventListener("input", () => {
      autoResizeInput();
      btnSend.disabled = (!userInput.value.trim() && !currentAttachedImage) || isGenerating;
    });

    btnAttach.addEventListener("click", toggleAttachMenu);
    btnUploadImg.addEventListener("click", () => {
      closeAttachMenu();
      fileUpload.click();
    });
    btnScreenshotTab.addEventListener("click", screenshotTabFromMenu);
    document.addEventListener("click", (e) => {
      if (!attachWrap.contains(e.target)) closeAttachMenu();
    });
    attachMenu.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      closeAttachMenu();
      btnAttach.focus();
    });

    fileUpload.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        processImage(e.target.files[0]);
      }
    });

    btnClearImage.addEventListener("click", clearAttachedImage);

    userInput.addEventListener("paste", (e) => {
      if (!canAttachImages()) return;
      const imageFile = getImageFileFromItems(e.clipboardData?.items);
      if (!imageFile) return;
      e.preventDefault();
      processImage(imageFile);
    });

    // Drag & Drop on input bar
    inputBar.addEventListener("dragover", (e) => {
      if (!canAttachImages()) return;
      e.preventDefault();
      inputBar.classList.add("drag-active");
    });

    inputBar.addEventListener("dragleave", () => {
      inputBar.classList.remove("drag-active");
    });

    inputBar.addEventListener("drop", (e) => {
      if (!canAttachImages()) return;
      e.preventDefault();
      inputBar.classList.remove("drag-active");
      const imageFile = getImageFileFromItems(e.dataTransfer?.items) || getImageFileFromFiles(e.dataTransfer?.files);
      if (imageFile) processImage(imageFile);
    });

    btnStop.addEventListener("click", stopGeneration);
    btnClearContext.addEventListener("click", clearContext);

    btnClear.addEventListener("click", () => {
      startNewChat();
      historyPanel.classList.add("hidden");
    });

    btnHistory.addEventListener("click", () => {
      settingsPanel.classList.add("hidden");
      historyPanel.classList.toggle("hidden");
      if (!historyPanel.classList.contains("hidden")) {
        renderHistoryList();
      }
    });

    async function validateSettingsModel() {
      const baseUrl = getOllamaUrl();
      const model = ollamaModelInput.value.trim();
      if (!model) return;

      modelStatusSpan.textContent = " Checking...";
      modelStatusSpan.style.color = "var(--text-muted)";

      try {
        // Try /api/show — works for local and pulled cloud models
        const showResp = await fetch(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model })
        });
        let isVision = false;
        let isThinking = false;
        let showOk = false;

        if (showResp.ok) {
          showOk = true;
          const showData = await showResp.json();
          const caps = showData.capabilities || [];
          const families = showData.details?.families || [];
          isVision = caps.includes("vision") ||
            families.some(f => f.toLowerCase().includes('clip') || f.toLowerCase().includes('vision'));
          isThinking = caps.includes("thinking");
        }

        // If /api/show failed, use name-based heuristics
        // Cloud models may not be pulled yet but will auto-pull on use
        if (!showOk) {
          const isCloudModel = model.includes(":cloud") || model.includes("-cloud");
          if (!isCloudModel) {
            modelStatusSpan.textContent = " ✗ Not found";
            modelStatusSpan.style.color = "#F87171";
            return;
          }
          // Cloud model — use name heuristics
          const lowerModel = model.toLowerCase();
          isVision = lowerModel.includes('llava') || lowerModel.includes('vision') ||
            lowerModel.includes('minicpm') || lowerModel.startsWith('gemma3') || lowerModel.startsWith('gemma4');
          isThinking = lowerModel.includes('deepseek-r1') || lowerModel.includes('qwq') || lowerModel.startsWith('gemma4');
        }

        const badges = [];
        if (isVision) badges.push("Vision");
        if (isThinking) badges.push("Thinking");
        const source = showOk ? "" : " (cloud)";
        if (badges.length > 0) {
          modelStatusSpan.textContent = ` ✓ ${badges.join(", ")}${source}`;
          modelStatusSpan.style.color = "#10B981";
        } else {
          modelStatusSpan.textContent = " ✓ Valid";
          modelStatusSpan.style.color = "#10B981";
        }
      } catch (e) {
        modelStatusSpan.textContent = " (API error)";
        modelStatusSpan.style.color = "#F87171";
      }
    }

    ollamaModelInput.addEventListener("blur", validateSettingsModel);
    ollamaUrlInput.addEventListener("blur", validateSettingsModel);

    btnSettings.addEventListener("click", () => {
      historyPanel.classList.add("hidden");
      settingsPanel.classList.toggle("hidden");
      if (ollamaEnabled && !settingsPanel.classList.contains("hidden")) {
        validateSettingsModel();
      }
    });

    tempSlider.addEventListener("input", () => { tempValue.textContent = tempSlider.value; });
    topkSlider.addEventListener("input", () => { topkValue.textContent = topkSlider.value; });
    // Read at send time, so it takes effect without "Apply & Restart".
    responseCountInputs.forEach(input => input.addEventListener("change", saveSettings));
    tabScreenshotSelect.addEventListener("change", onTabScreenshotModeChange);
    btnAllowScreenshots.addEventListener("click", allowScreenshotsFromCard);
    btnDismissScreenshotAccess.addEventListener("click", dismissScreenshotAccessCard);
    watchTabsForScreenshots().catch((err) => console.warn("[MyLocalAI] Tab watching unavailable:", err));

    btnApply.addEventListener("click", () => {
      saveSettings();
      settingsPanel.classList.add("hidden");
      restartSession();
    });

    btnSavePrompt.addEventListener("click", () => {
      const content = sysPromptEl.value.trim();
      if (!content) {
        alert("Please enter a system prompt to save.");
        return;
      }

      // Check if already exists to avoid duplicates
      if (savedPromptList.some(p => p.content === content)) {
        alert("This prompt is already saved!");
        return;
      }

      if (savedPromptList.length >= 5) {
        alert("You can only save up to 5 prompts. Please delete one first (or Reset All Data).");
        return;
      }

      const name = prompt("Enter a short name for this prompt (e.g., Coding Assistant):");
      if (!name || !name.trim()) return;

      savedPromptList.push({ name: name.trim(), content });
      try {
        localStorage.setItem("savedPromptList", JSON.stringify(savedPromptList));
      } catch (e) {
        console.warn("Could not save prompt list", e);
      }
      renderSavedPrompts();
      savedPromptsDropdown.value = content;
    });

    savedPromptsDropdown.addEventListener("change", (e) => {
      if (e.target.value) {
        sysPromptEl.value = e.target.value;
        saveSettings();
      }
    });

    btnReset.addEventListener("click", () => {
      if (confirm("Are you sure? This will permanently delete all your chat history and settings.")) {
        localStorage.clear();
        location.reload();
      }
    });

    statusRetryBtn.addEventListener("click", () => init());

    $$(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const prompt = chip.dataset.prompt;
        if (prompt) {
          userInput.value = prompt;
          autoResizeInput();
          sendMessage(prompt);
        }
      });
    });
  }
})();
