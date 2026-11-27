// Loading and saving the user's settings and saved prompts.
"use strict";

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
    appliedSystemPrompt = sysPromptEl.value;
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

function getSystemPrompt() {
  return appliedSystemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
}

// Saves one setting that takes effect at once (model switcher, responses at once, screenshot
// mode). It must not persist other fields the user has edited but not applied yet.
function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[MyLocalAI] Could not save ${key}`, e);
  }
}

function saveOllamaModelSetting() {
  saveSetting("ollamaModel", ollamaModelInput.value);
}

function saveResponseCountSetting() {
  saveSetting("responseCount", String(getResponseCount()));
}

// Saved prompts are stored as a list of { name, content }, at most MAX_SAVED_PROMPTS.
function storeSavedPrompts() {
  saveSetting("savedPromptList", JSON.stringify(savedPromptList));
}

// Removes the saved prompt picked in the dropdown. The system prompt box keeps its text.
function deleteSelectedPrompt() {
  const content = savedPromptsDropdown.value;
  const item = savedPromptList.find(p => p.content === content);
  if (!item) {
    alert("Pick a saved prompt in the list first, then delete it.");
    return;
  }
  if (!confirm(`Delete the saved prompt "${item.name}"?`)) return;
  savedPromptList = savedPromptList.filter(p => p !== item);
  storeSavedPrompts();
  renderSavedPrompts();
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

// Apply & Restart: everything in the settings panel takes effect, the system prompt included.
function saveSettings() {
  appliedSystemPrompt = sysPromptEl.value;
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
