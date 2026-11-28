// The loading / error overlay and its help text.
"use strict";

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
  // Provider editions explain their own setup (config, on-device model, cloud opt-in).
  if (externalProvider) return externalProvider.helpLines().join("\n");

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
