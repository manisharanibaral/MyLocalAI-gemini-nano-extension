// Sending a message and recording the reply.
"use strict";

// ===================== CHAT LOGIC =====================
async function sendMessage(text) {
  if ((!text.trim() && !attachedImages.length) || isGenerating || pageCapture) return;
  if (!activeBackend) return;

  // Set before the first await: a second Enter while the model reloads or the prompt is
  // measured must not send the same message again.
  isGenerating = true;
  try {
    await sendMessageNow(text);
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

async function sendMessageNow(text) {
  try {
    await ensureModelLoaded();
  } catch (err) {
    console.error("[MyLocalAI] Model reload failed:", err);
    hideStatus();
    welcomeScreen.classList.add("hidden");
    messagesEl.classList.remove("hidden");
    appendMessage("ai", `⚠️ Could not reload the model: ${err.message}`);
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

  if (await nanoContextIsFull(finalPrompt, imagesToSend)) return;

  // Show UI
  welcomeScreen.classList.add("hidden");
  messagesEl.classList.remove("hidden");

  // UI display keeps the user's typed text; history keeps the exact prompt
  // sent to the backend so selected context is preserved for Ollama.
  const displayMessage = [typedPrompt, ...imagesToSend].join("__IMG__");
  const historyMessage = [finalPrompt, ...imagesToSend].join("__IMG__");
  appendMessage("user", displayMessage);
  chatHistory.push({ role: "user", content: historyMessage });
  // The reply belongs to this chat even if the user starts or opens another one meanwhile.
  const chat = { id: currentSessionId, history: chatHistory };

  userInput.value = "";
  autoResizeInput();
  btnSend.disabled = true;
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
    await recordResponses(group, results, chat);
  } catch (err) {
    // Only reached if setting up the reply fails; per-answer errors are shown in their tab.
    console.error("[MyLocalAI] Could not start the reply:", err);
    appendMessage("ai", `⚠️ Error: ${err.message}`);
    saveConversation(chat.id, chat.history);
  }
}

// Nano can't take a prompt bigger than its free context. Then the chat continues as a new
// one (the current chat stays in History) and the user sends again. Returns true in that case.
async function nanoContextIsFull(prompt, images) {
  if (activeBackend !== "nano" || images.length || !session) return false;
  if (typeof session.measureContextUsage !== "function" && typeof session.countPromptTokens !== "function") return false;
  let promptTokens;
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 2000));
    promptTokens = await Promise.race([nanoMeasure(prompt), timeout]);
  } catch (_) {
    return false; // can't measure: let Nano decide
  }
  const remaining = Math.max(0, nanoWindow() - nanoUsed());
  if (remaining === 0 || promptTokens <= remaining) return false;

  await startNewChat();
  welcomeScreen.classList.add("hidden");
  messagesEl.classList.remove("hidden");
  appendMessage("ai", `⚠️ Context limit reached!\n\n~${promptTokens} tokens needed, ${remaining} remain.\nStarted a new chat; the previous one is saved in History. Please re-send your message.`);
  hideStatus();
  return true;
}

// Shows each answer's outcome and stores the reply in its chat. The chat continues from the
// first answer that has text (a stopped answer keeps what it wrote); the user can switch to
// another one with the tabs. The question is saved even when no answer came back.
async function recordResponses(group, results, chat) {
  const variants = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      variants.push(result.value);
    } else {
      const variant = await showResponseError(group.bubbles[i], result.reason);
      if (variant.failed) group.markFailed(i);
      variants.push(variant);
    }
  }

  const isOpenChat = chat.id === currentSessionId;
  const selected = variants.findIndex(v => !v.failed);
  if (selected >= 0) {
    const entry = { role: "assistant", content: variants[selected].content, reasoning: variants[selected].reasoning };
    if (variants.length > 1) {
      entry.variants = variants;
      entry.selected = selected;
    }
    chat.history.push(entry);
    if (isOpenChat) {
      group.setActive(selected);
      bindVariantSelection(group, entry);
      if (activeBackend === "nano") adoptNanoVariant(selected);
    }
  }
  saveConversation(chat.id, chat.history);
}

const STOPPED_TEXT = "(Generation stopped)";

// Renders a failed or stopped answer in its bubble and returns it as a history variant.
// A stopped answer keeps the text streamed so far; one with no text counts as failed.
async function showResponseError(bubble, err) {
  if (err?.name === "AbortError") {
    const partial = streamedText.get(bubble);
    if (partial?.text.trim()) {
      finalizeMessage(bubble, partial.text, partial.reasoning);
      return { content: partial.text, reasoning: partial.reasoning, stopped: true };
    }
    finalizeMessage(bubble, STOPPED_TEXT);
    return { content: STOPPED_TEXT, reasoning: "", failed: true };
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
  return { content: message, reasoning: "", failed: true };
}

function stopGeneration() {
  if (abortController) abortController.abort();
}
