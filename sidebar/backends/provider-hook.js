// The bridge to external providers.
"use strict";

// ===================== EXTERNAL PROVIDER HOOK =====================
// The only place the sidebar talks to a provider file (see externalProvider in core/config.js).
// The provider gets the same inputs the built-in backends use and renders through the
// same streaming/finalize path, so chat UI, history and multi-answer tabs stay shared.
function isProviderActive() {
  return Boolean(externalProvider) && activeBackend === externalProvider.id;
}

function providerRequestSettings() {
  return {
    systemPrompt: getSystemPrompt(),
    temperature: parseFloat(tempSlider.value),
    topK: parseInt(topkSlider.value, 10),
    maxOutputTokens: getAnswerTokenCap(), // null = no cap; providers that cannot cap ignore it
  };
}

async function initExternalProvider() {
  await externalProvider.init({
    showProgress: (title, message) => showStatus("loading", title, message),
    settings: providerRequestSettings(),
  });
  modelSupportsVision = externalProvider.supportsImages();
  modelSupportsThinking = false;
  isModelUnloaded = false;
}

// A provider setting that changes where answers run (e.g. Firebase's "Cloud & internet"
// switch) takes effect at once. Unlike Apply & Restart, the open chat stays.
async function reloadExternalProvider() {
  if (isGenerating) stopGeneration();
  try {
    await initExternalProvider();
    activeBackend = externalProvider.id;
    hideStatus();
  } catch (err) {
    console.warn(`[MyLocalAI] ${externalProvider.id} could not restart:`, err.message);
    activeBackend = null;
    showStatus("error", errorTitle(), getErrorMessage());
  }
  updateBackendUI();
  updateTokenInfo();
}

// chatHistory already ends with the message being answered (sendMessage pushed it).
async function streamProvider(aiBubble, images) {
  const answer = await externalProvider.stream({
    history: chatHistory.slice(-MAX_CHAT_MESSAGES),
    images,
    signal: abortController.signal,
    settings: providerRequestSettings(),
    onText: (text) => {
      renderStreamingText(aiBubble, text);
      scrollToBottom();
    },
  });
  finalizeMessage(aiBubble, answer.content, answer.reasoning);
  return answer;
}
