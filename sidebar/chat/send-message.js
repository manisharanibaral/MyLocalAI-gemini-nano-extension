// Sending a message and recording the reply.
"use strict";

// ===================== CHAT LOGIC =====================
async function sendMessage(text) {
  if ((!text.trim() && !attachedImages.length) || isGenerating || pageCapture) return;
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

  const imagesToSend = attachedImages;
  const typedPrompt = text.trim() || (attachedImagesNote ? "Summarise this page." : "Describe this image.");
  const promptPreamble = [];
  if (currentContextText) {
    promptPreamble.push(`Context:\n"""\n${currentContextText}\n"""`);
    // Clear context UI after using it
    clearContext();
  }
  if (attachedImagesNote) promptPreamble.push(attachedImagesNote);
  // extractTitle() relies on "User Question:" to title a chat with the typed text only.
  const finalPrompt = promptPreamble.length
    ? `${promptPreamble.join("\n\n")}\n\nUser Question:\n${typedPrompt}`
    : typedPrompt;

  // Token pre-check (Nano only)
  if (activeBackend === "nano" && !imagesToSend.length && session &&
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
  const displayMessage = [typedPrompt, ...imagesToSend].join("__IMG__");
  const historyMessage = [finalPrompt, ...imagesToSend].join("__IMG__");
  appendMessage("user", displayMessage);
  chatHistory.push({ role: "user", content: historyMessage });

  userInput.value = "";
  autoResizeInput();
  btnSend.disabled = true;
  isGenerating = true;
  modelSwitcher?.setDisabled(true);
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");

  // Clear images immediately from UI after sending
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
        ? streamNano(finalPrompt, bubble, imagesToSend, nanoSessions[i])
        : isProviderActive()
          ? streamProvider(bubble, imagesToSend)
          : streamOllama(finalPrompt, bubble);
      return stream.finally(() => group.markDone(i));
    }));
    await recordResponses(group, results);
  } catch (err) {
    // Only reached if setting up the reply fails; per-answer errors are shown in their tab.
    console.error("[MyLocalAI] Could not start the reply:", err);
    appendMessage("ai", `⚠️ Error: ${err.message}`);
  } finally {
    isGenerating = false;
    modelSwitcher?.setDisabled(false);
    abortController = null;
    btnStop.classList.add("hidden");
    btnSend.classList.remove("hidden");
    updateSendButton();
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

function stopGeneration() {
  if (abortController) abortController.abort();
}
