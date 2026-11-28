// Gemini Nano backend: Chrome's built-in Prompt API.
"use strict";

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
  const systemText = getSystemPrompt();
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
  nanoBaseSystemPrompt = systemText;
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
  // A memory saved since the base session was made changed the system prompt, and a session's
  // system prompt is fixed, so the new chat needs a new base session.
  if (!nanoBaseSession || nanoBaseSystemPrompt !== getSystemPrompt()) {
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

// ── Nano streaming ──
// Returns the answer; recordResponses() stores it, because one reply may hold several answers.
async function streamNano(text, aiBubble, images = [], chatSession = session) {
  const imageParts = await Promise.all(images.map(async (image) =>
    ({ type: "image", value: await padImageToSquare(base64ToImageBlob(image)) })));
  const prompt = imageParts.length
    ? [{ role: "user", content: [{ type: "text", value: text }, ...imageParts] }]
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
