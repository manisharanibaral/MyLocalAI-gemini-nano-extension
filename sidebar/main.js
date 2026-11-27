/**
 * MyLocalAI — Local AI Chat Sidebar (entry point; loaded last)
 *
 * Backend priority:
 *   1. Gemini Nano (Chrome's built-in LanguageModel API) — Chrome only
 *   2. Ollama (local REST API at localhost:11434) — any browser
 *
 * Which of these are tried is set by config.js (window.MYLOCALAI_CONFIG),
 * so the same code ships as the Nano-only, Ollama-only and mixed editions.
 *
 * Nano runs on-device; Ollama runs wherever its URL points (localhost by default).
 *
 * The files in sidebar/ are classic scripts that share one global scope; sidebar.html sets
 * their order. Only this file starts work: the others declare things (and look up elements).
 *
 * Other backends live in providers/ and register in window.MYLOCALAI_PROVIDERS
 * (e.g. providers/firebase-backend.js for the firebase-hybrid edition). The sidebar reaches
 * them only through sidebar/backends/provider-hook.js, next to streamNano / streamOllama.
 */
"use strict";

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "TEXT_SELECTED") {
      setContextFromSelection(message.text);
    } else {
      onPageMessage(message, sender);
    }
  });
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

  // A provider edition (e.g. Firebase hybrid) does its own on-device/cloud routing.
  if (externalProvider) {
    try {
      await initExternalProvider();
      activeBackend = externalProvider.id;
      updateBackendUI();
      hideStatus();
      refreshAutoScreenshot("open");
      scheduleIdleUnload();
      return;
    } catch (providerErr) {
      console.warn(`[MyLocalAI] ${externalProvider.id} not available:`, providerErr.message);
    }
  }

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
