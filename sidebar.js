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
  const btnUploadImg = $("#btn-upload-img");
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
  let session = null;        // Gemini Nano session (when using nano backend)
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
  let listenersInitialized = false;

  // Single source of truth for Ollama defaults (the settings inputs are filled from these).
  const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
  const DEFAULT_OLLAMA_URL = "http://localhost:11434";

  const getOllamaModel = () => ollamaModelInput.value.trim() || DEFAULT_OLLAMA_MODEL;
  const getOllamaUrl = () => ollamaUrlInput.value.trim() || DEFAULT_OLLAMA_URL;

  const REQUEST_TIMEOUT_MS = 15000;
  const GENERATION_TIMEOUT_MS = 120000;
  const MAX_CHAT_MESSAGES = 100;
  const MAX_SAVED_SESSIONS = 50;

  // Create span for model status in settings
  const modelStatusSpan = document.createElement("span");
  modelStatusSpan.style.fontSize = "11px";
  modelStatusSpan.style.marginLeft = "8px";
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

    try {
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
              id: currentSessionId,
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
    let content = firstUserMsg.content;
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
        appendMessage(role, displayContent, false, msg.reasoning);
      }
    });

    scrollToBottom(true);
    updateTokenInfo();
    historyPanel.classList.add("hidden");

    // Re-init Nano session if using Nano to clear its internal context
    if (activeBackend === "nano" && session) {
      destroySession().then(async () => {
        await initNanoSession();
        hideStatus();
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
      titleDiv.title = s.title;
      titleDiv.textContent = s.title;
      
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
    await destroySession();
    chatHistory = [];
    currentSessionId = Date.now().toString();
    clearContext();
    clearAttachedImage();
    messagesEl.innerHTML = "";
    messagesEl.classList.add("hidden");
    welcomeScreen.classList.remove("hidden");
    updateTokenInfo();

    try {
      if (activeBackend === "nano") {
        await initNanoSession();
        hideStatus();
      }
    } catch (_) { }
  }

  // ===================== INIT =====================
  init();

  async function init() {
    loadSettings();
    loadSessions();

    // Load most recent active session if exists
    if (chatSessions.length > 0) {
      loadConversation(chatSessions[0].id);
    }
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
      ? "Ollama Fallback (for non-Chrome browsers)"
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
      btnUploadImg.style.display = modelSupportsVision ? "block" : "none";
      if (!modelSupportsVision) {
        clearAttachedImage();
      }
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

      btnUploadImg.style.display = modelSupportsVision ? "block" : "none";
      if (!modelSupportsVision) {
        clearAttachedImage();
      }
    } else {
      headerBadge.textContent = "Disconnected";
      headerBadge.style.color = "";
      backendHint.textContent = "No backend available";
      btnUploadImg.style.display = "none";
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
      if (avail === "downloading" || avail === "after-download") {
        showStatus("loading", "Downloading Gemini Nano…",
          "Downloading the on-device model (~4 GB).\nThis is a one-time download.");
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
          if (e.loaded >= e.total) {
            hideStatus();
            return;
          }
          const pct = Math.round((e.loaded / e.total) * 100);
          if (pct === 100) return; // Avoid flashing 100% just before it finishes
          showStatus("loading", "Downloading Gemini Nano…", `Progress: ${pct}%`);
        });
      },
    };

    try {
      session = await lm.create(createOptions);
    } catch (e) {
      if (!modelSupportsVision) {
        if (!useTypedNanoOptions) throw e;
        console.warn("[MyLocalAI] Nano typed session failed, retrying legacy options:", e.message);
        session = await lm.create({
          ...options,
          monitor: createOptions.monitor,
        });
      } else {
        console.warn("[MyLocalAI] Nano vision session failed, retrying text-only:", e.message);
        modelSupportsVision = false;
        session = await lm.create({
          ...options,
          ...nanoTextOptions,
          monitor: createOptions.monitor,
        });
      }
    }

    isCreating = false;
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
        return m;
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
  async function destroySession() {
    if (session && activeBackend === "nano") {
      try { session.destroy(); } catch (_) { }
    }
    session = null;
  }

  async function restartSession() {
    await destroySession();
    chatHistory = [];
    activeBackend = null;
    clearAttachedImage();
    showStatus("loading", "Restarting…", "Reconnecting to AI backend");
    await init();
  }

  // ===================== CHAT LOGIC =====================
  async function sendMessage(text) {
    if ((!text.trim() && !currentAttachedImage) || isGenerating) return;
    if (!activeBackend) return;

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
          await destroySession();
          await initNanoSession();
          chatHistory = [];
          updateTokenInfo();
          appendMessage("ai", "✅ Session reset. Please re-send your message.");
          scrollToBottom(true);
          hideStatus();
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

    const aiBubble = appendMessage("ai", "", true);

    try {
      abortController = new AbortController();

      if (activeBackend === "nano") {
        await streamNano(finalPrompt, aiBubble, imageToSend);
      } else if (activeBackend === "ollama") {
        await streamOllama(finalPrompt, aiBubble, imageToSend);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // preserve the text and any reasoning blocks
        aiBubble.dataset.done = "1";
        aiBubble.style.minHeight = "";
        const currentHtml = aiBubble.innerHTML.replace('<span class="cursor">\u200B</span>', "");
        setSafeHtml(aiBubble, currentHtml || "(Generation stopped)");
      } else {
        console.error("[MyLocalAI] Prompt error:", err);
        finalizeMessage(aiBubble, `⚠️ Error: ${err.message}`);
      }
    } finally {
      isGenerating = false;
      abortController = null;
      btnStop.classList.add("hidden");
      btnSend.classList.remove("hidden");
      btnSend.disabled = !userInput.value.trim();
      updateTokenInfo();
    }
  }

  // ── Nano streaming ──
  async function streamNano(text, aiBubble, attachedImage = null) {
    const prompt = attachedImage
      ? [{
          role: "user",
          content: [
            { type: "text", value: text },
            { type: "image", value: base64ToImageBlob(attachedImage) },
          ],
        }]
      : text;

    const stream = await session.promptStreaming(prompt, {
      signal: abortController.signal,
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk; // Chrome 138+: incremental chunks
      renderStreamingText(aiBubble, fullText);
      scrollToBottom();
    }

    finalizeMessage(aiBubble, fullText);
    chatHistory.push({ role: "assistant", content: fullText });
    saveConversation();
    updateTokenInfo();
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
    chatHistory.push({ role: "assistant", content: fullText, reasoning: reasoningText });
    saveConversation();
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
    messagesEl.appendChild(msg);
    scrollToBottom(true);
    return bubble;
  }

  function processImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (!canAttachImages()) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Compression dimensions
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Compress to JPEG, quality 0.7
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        currentAttachedImage = dataUrl.split(",")[1];

        imagePreviewImg.src = dataUrl;
        imagePreviewCard.classList.remove("hidden");
        btnSend.disabled = false;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function clearAttachedImage() {
    currentAttachedImage = null;
    imagePreviewCard.classList.add("hidden");
    imagePreviewImg.src = "";
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
  const pendingRenders = new WeakMap();
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
  }

  // Markdown rendering via the vendored `marked` library (GFM: tables, lists,
  // task lists, strikethrough…). Output is always sanitized by DOMPurify.
  const markdownRenderer = (() => {
    if (typeof marked === "undefined") return null;
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

    return renderer;
  })();

  if (typeof DOMPurify !== "undefined") {
    // Links inside the sidebar must open in a new tab, not replace the chat.
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function formatResponseText(text) {
    if (!text) return "";
    if (!markdownRenderer) return escapeHtml(text);
    return marked.parse(text, { gfm: true, breaks: true, async: false, renderer: markdownRenderer });
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
  let scrollQueued = false;
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
    if (activeBackend === "nano" && session) {
      const used = nanoUsed();
      const max = nanoWindow();
      const left = Math.max(0, max - used);
      if (max > 0) {
        const pct = Math.round((used / max) * 100);
        tokenInfo.textContent = `${used.toLocaleString()} / ${max.toLocaleString()} tokens · ${left.toLocaleString()} left`;
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

    btnUploadImg.addEventListener("click", () => fileUpload.click());

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
