// Text and controls that depend on the edition and the active backend.
"use strict";

// ===================== EDITION UI =====================
function applyEditionUI() {
  ollamaSettings.classList.toggle("hidden", !ollamaEnabled);
  ollamaSettingsLabel.textContent = nanoEnabled
    ? "Ollama · fallback for non-Chrome browsers"
    : "Ollama";

  if (externalProvider) {
    document.title = externalProvider.describe().title;
    externalProvider.bindSettingsUI?.({ onSettingsChanged: reloadExternalProvider });
  }
  else if (nanoEnabled && !ollamaEnabled) document.title = "MyLocalAI — Gemini Nano";
  else if (ollamaEnabled && !nanoEnabled) document.title = "MyLocalAI — Ollama";
  else document.title = "MyLocalAI — Local AI Chat";
}

function initStatusMessage() {
  if (externalProvider) return externalProvider.statusMessage;
  if (nanoEnabled && !ollamaEnabled) return "Checking Gemini Nano availability";
  if (ollamaEnabled && !nanoEnabled) return "Connecting to Ollama";
  return "Looking for an available AI backend";
}

function errorTitle() {
  if (externalProvider) return externalProvider.errorTitle();
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
    const statusText = isOllamaModelValid ? "" : " ⚠️ (not found in Ollama)";
    headerBadge.textContent = `Ollama · ${model}${statusText}`;
    headerBadge.style.color = isOllamaModelValid ? "" : "#F87171";

    if (isOllamaCloudModel(model)) {
      backendHint.textContent = `Ollama (${model}) · cloud`;
      welcomeSub.textContent = `Powered by Ollama (${model}) — routed through Ollama cloud. Fast.`;
    } else if (isLocalOllamaUrl(getOllamaUrl())) {
      backendHint.textContent = `Ollama (${model}) · 100% local`;
      welcomeSub.textContent = `Powered by Ollama (${model}) — running locally on your machine. Private. Fast.`;
    } else {
      backendHint.textContent = `Ollama (${model}) · on ${ollamaHost()}`;
      welcomeSub.textContent = `Powered by Ollama (${model}) on ${ollamaHost()} — your messages go to that computer.`;
    }

    setAttachAvailable(modelSupportsVision);
  } else if (isProviderActive()) {
    const text = externalProvider.describe();
    headerBadge.textContent = text.badge;
    headerBadge.style.color = "";
    backendHint.textContent = text.hint;
    welcomeSub.textContent = text.welcome;
    setAttachAvailable(modelSupportsVision);
  } else {
    headerBadge.textContent = "Disconnected";
    headerBadge.style.color = "";
    backendHint.textContent = "No backend available";
    setAttachAvailable(false);
  }
  refreshModelPill();
}

// True only when no message, page text or screenshot leaves this computer with the active
// backend, so the UI never promises privacy it doesn't have.
function answersStayOnDevice() {
  if (activeBackend === "nano") return true;
  if (activeBackend === "ollama") return isLocalOllamaUrl(getOllamaUrl()) && !isOllamaCloudModel(getOllamaModel());
  if (isProviderActive()) return externalProvider.describe().usesCloud === false;
  return false;
}
