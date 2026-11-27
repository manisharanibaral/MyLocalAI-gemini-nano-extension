// Releasing, restarting and reloading whichever model is active.
"use strict";

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
  } else if (activeBackend === "ollama") {
    await unloadOllamaModel();
  } else if (isProviderActive()) {
    externalProvider.unload?.();
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
