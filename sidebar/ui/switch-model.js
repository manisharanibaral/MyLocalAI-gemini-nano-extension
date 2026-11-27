// Which models exist and how the chat moves between them.
"use strict";

// ===================== MODEL SWITCHER =====================
// The pill beside the send button. features/model-switcher.js draws it; this section knows which
// models exist and how to move the chat onto one. Chat history is kept: Ollama and the provider
// re-send it on every request, so only a switch *to* Nano starts with an empty model memory.
const MODEL_LIST_TIMEOUT_MS = 4000;
const switcherModels = window.MyLocalAIModelSwitcher;

// Nano-only has a single model, so the pill would offer nothing to switch to.
function modelSwitcherHasChoices() {
  return ollamaEnabled || typeof externalProvider?.listModels === "function";
}

function setupModelSwitcher() {
  modelSwitcher = switcherModels.create({
    root: modelSwitcherRoot,
    button: btnModel,
    labelEl: modelPillLabel,
    menu: modelMenu,
    loadOptions: loadModelOptions,
    onSelect: switchModel,
  });
  modelSwitcher.setVisible(modelSwitcherHasChoices());
  refreshModelPill();
}

// Which model is answering, as shown on the pill.
function currentModelLabel() {
  if (activeBackend === "nano") return switcherModels.nanoOption().label;
  if (activeBackend === "ollama") return getOllamaModel();
  if (isProviderActive()) {
    const { options, currentId } = externalProvider.listModels();
    return options.find((option) => option.id === currentId)?.label || "Model";
  }
  return "No model";
}

function refreshModelPill() {
  modelSwitcher?.setCurrent(currentModelLabel());
}

async function fetchOllamaModelNames() {
  try {
    const resp = await fetchWithTimeout(`${getOllamaUrl()}/api/tags`, { method: "GET" }, MODEL_LIST_TIMEOUT_MS);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.models || []).map((m) => m.name);
  } catch (_) {
    return []; // Ollama not running: the menu still offers the configured model
  }
}

async function loadModelOptions() {
  if (typeof externalProvider?.listModels === "function") return externalProvider.listModels();

  const options = [];
  if (nanoEnabled) options.push(switcherModels.nanoOption());
  if (ollamaEnabled) options.push(...switcherModels.ollamaOptions(await fetchOllamaModelNames(), getOllamaModel()));

  let currentId = null;
  if (activeBackend === "nano") currentId = switcherModels.NANO_ID;
  else if (activeBackend === "ollama") currentId = switcherModels.ollamaModelId(getOllamaModel());
  return { options, currentId };
}

// Rejects with a readable message, which the menu shows; the previous model stays active.
async function switchModel(id) {
  if (isGenerating) throw new Error("Wait for the current answer to finish, then switch.");
  clearTimeout(idleUnloadTimer);
  try {
    if (externalProvider) await switchProviderModel(id);
    else await switchBuiltInModel(id);
  } catch (err) {
    hideStatus(); // a download-progress overlay may still be showing
    throw new Error(describeSwitchError(err));
  } finally {
    scheduleIdleUnload();
  }
  updateBackendUI();
  updateTokenInfo();
}

// The provider remembers the choice; init() rebuilds its model with it. If that fails
// (say on-device Nano is missing), the previous choice is put back.
async function switchProviderModel(id) {
  const previousId = externalProvider.listModels().currentId;
  externalProvider.selectModel(id);
  try {
    await initExternalProvider();
    activeBackend = externalProvider.id;
  } catch (err) {
    externalProvider.selectModel(previousId);
    throw err;
  }
}

async function switchBuiltInModel(id) {
  const target = switcherModels.parseModelId(id);
  if (!target) throw new Error(`Unknown model: ${id}`);
  if (target.backend === "nano") await switchToNano();
  else await switchToOllamaModel(target.model);
}

async function switchToOllamaModel(model) {
  const previousModel = ollamaModelInput.value;
  const nanoChatSession = activeBackend === "nano" ? session : null;
  ollamaModelInput.value = model;
  try {
    // Connection problems throw before this changes any state, so a failure is easy to undo.
    await initOllamaSession();
  } catch (err) {
    ollamaModelInput.value = previousModel;
    throw err;
  }
  if (activeBackend === "nano") {
    // initOllamaSession() cleared `session`, so destroy the old chat session by hand.
    destroyNanoSessions();
    try { nanoChatSession?.destroy(); } catch (_) { }
  }
  activeBackend = "ollama";
  saveOllamaModelSetting();
}

async function switchToNano() {
  const previousVision = modelSupportsVision;
  const previousThinking = modelSupportsThinking;
  try {
    await initNanoSession();
  } catch (err) {
    // initNanoSession() resets the capability flags before it can fail.
    modelSupportsVision = previousVision;
    modelSupportsThinking = previousThinking;
    throw err;
  }
  activeBackend = "nano";
  if (chatHistory.length > 0) {
    appendMessage("ai", "ℹ️ Switched to Gemini Nano. It starts with a clean memory, so it can't see the earlier messages in this chat.");
  }
}

function describeSwitchError(err) {
  const message = err?.message || "";
  if (externalProvider) return err?.code ? externalProvider.helpLines()[0] : message;
  if (message.startsWith("OLLAMA_")) return `Can't reach Ollama at ${getOllamaUrl()}. Is it running?`;
  if (message === "NANO_UNAVAILABLE" || message === "NO_NANO_API") return "Gemini Nano isn't available in this browser.";
  if (message === "NANO_NEEDS_GESTURE") return "Click the model again to start the Gemini Nano download.";
  return message || "Could not switch models.";
}
