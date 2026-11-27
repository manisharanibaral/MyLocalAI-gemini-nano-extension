// Wires DOM events to the functions in the other files.
"use strict";

// ===================== EVENT LISTENERS =====================
function setupEventListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;
  setupModelSwitcher();

  const unpin = () => { isAutoScrollEnabled = false; };
  messagesEl.addEventListener("wheel", (e) => { if (e.deltaY < 0) unpin(); }, { passive: true });
  messagesEl.addEventListener("touchmove", unpin, { passive: true });
  messagesEl.addEventListener("keydown", (e) => {
    if (["ArrowUp", "PageUp", "Home"].includes(e.key)) unpin();
  });
  messagesEl.addEventListener("scroll", () => {
    const top = messagesEl.scrollTop;
    const distance = messagesEl.scrollHeight - top - messagesEl.clientHeight;
    if (top < lastScrollTop - 1) isAutoScrollEnabled = false; // user moved up
    else if (distance <= 24) isAutoScrollEnabled = true;       // back at bottom
    lastScrollTop = top;
  }, { passive: true });

  messagesEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-copy-code");
    if (!btn) return;
    const code = btn.closest(".code-container")?.querySelector("code")?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    } catch (_) { /* clipboard unavailable */ }
  });

  btnSend.addEventListener("click", () => sendMessage(userInput.value));

  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!btnSend.disabled && !isGenerating) sendMessage(userInput.value);
    }
  });

  userInput.addEventListener("input", () => {
    autoResizeInput();
    updateSendButton();
  });

  btnAttach.addEventListener("click", toggleAttachMenu);
  btnUploadImg.addEventListener("click", () => {
    closeAttachMenu();
    fileUpload.click();
  });
  btnScreenshotTab.addEventListener("click", screenshotTabFromMenu);
  btnScreenshotPage.addEventListener("click", screenshotFullPageFromMenu);
  document.addEventListener("click", (e) => {
    if (!attachWrap.contains(e.target)) closeAttachMenu();
  });
  attachMenu.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeAttachMenu();
    btnAttach.focus();
  });

  fileUpload.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      processImage(e.target.files[0]);
    }
  });

  btnClearImage.addEventListener("click", clearAttachedImage);
  btnStopCapture.addEventListener("click", stopPageCapture);
  setupImageViewer();

  userInput.addEventListener("paste", (e) => {
    if (!canAttachImages()) return;
    const imageFile = getImageFileFromItems(e.clipboardData?.items);
    if (!imageFile) return;
    e.preventDefault();
    processImage(imageFile);
  });

  // Drag & Drop on input bar
  inputBar.addEventListener("dragover", (e) => {
    if (!canAttachImages()) return;
    e.preventDefault();
    inputBar.classList.add("drag-active");
  });

  inputBar.addEventListener("dragleave", () => {
    inputBar.classList.remove("drag-active");
  });

  inputBar.addEventListener("drop", (e) => {
    if (!canAttachImages()) return;
    e.preventDefault();
    inputBar.classList.remove("drag-active");
    const imageFile = getImageFileFromItems(e.dataTransfer?.items) || getImageFileFromFiles(e.dataTransfer?.files);
    if (imageFile) processImage(imageFile);
  });

  btnStop.addEventListener("click", stopGeneration);
  btnClearContext.addEventListener("click", clearContext);

  btnClear.addEventListener("click", () => {
    startNewChat();
    historyPanel.classList.add("hidden");
  });

  watchSessionsFromOtherPanels();

  btnHistory.addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
    historyPanel.classList.toggle("hidden");
    if (!historyPanel.classList.contains("hidden")) {
      renderHistoryList();
    }
  });

  async function validateSettingsModel() {
    const baseUrl = getOllamaUrl();
    const model = ollamaModelInput.value.trim();
    if (!model) return;

    modelStatusSpan.textContent = " Checking...";
    modelStatusSpan.style.color = "var(--text-muted)";

    try {
      // Try /api/show — works for local and pulled cloud models
      const showResp = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model })
      });
      let isVision = false;
      let isThinking = false;
      let showOk = false;

      if (showResp.ok) {
        showOk = true;
        const showData = await showResp.json();
        const caps = showData.capabilities || [];
        const families = showData.details?.families || [];
        isVision = caps.includes("vision") ||
          families.some(f => f.toLowerCase().includes('clip') || f.toLowerCase().includes('vision'));
        isThinking = caps.includes("thinking");
      }

      // If /api/show failed, use name-based heuristics
      // Cloud models may not be pulled yet but will auto-pull on use
      if (!showOk) {
        const isCloudModel = isOllamaCloudModel(model);
        if (!isCloudModel) {
          modelStatusSpan.textContent = " ✗ Not found";
          modelStatusSpan.style.color = "#F87171";
          return;
        }
        // Cloud model — use name heuristics
        const lowerModel = model.toLowerCase();
        isVision = lowerModel.includes('llava') || lowerModel.includes('vision') ||
          lowerModel.includes('minicpm') || lowerModel.startsWith('gemma3') || lowerModel.startsWith('gemma4');
        isThinking = lowerModel.includes('deepseek-r1') || lowerModel.includes('qwq') || lowerModel.startsWith('gemma4');
      }

      const badges = [];
      if (isVision) badges.push("Vision");
      if (isThinking) badges.push("Thinking");
      const source = showOk ? "" : " (cloud)";
      if (badges.length > 0) {
        modelStatusSpan.textContent = ` ✓ ${badges.join(", ")}${source}`;
        modelStatusSpan.style.color = "#10B981";
      } else {
        modelStatusSpan.textContent = " ✓ Valid";
        modelStatusSpan.style.color = "#10B981";
      }
    } catch (e) {
      modelStatusSpan.textContent = " (API error)";
      modelStatusSpan.style.color = "#F87171";
    }
  }

  ollamaModelInput.addEventListener("blur", validateSettingsModel);
  ollamaUrlInput.addEventListener("blur", validateSettingsModel);

  btnSettings.addEventListener("click", () => {
    historyPanel.classList.add("hidden");
    settingsPanel.classList.toggle("hidden");
    if (ollamaEnabled && !settingsPanel.classList.contains("hidden")) {
      validateSettingsModel();
    }
  });

  tempSlider.addEventListener("input", () => { tempValue.textContent = tempSlider.value; });
  topkSlider.addEventListener("input", () => { topkValue.textContent = topkSlider.value; });
  // Read at send time, so it takes effect without "Apply & Restart".
  responseCountInputs.forEach(input => input.addEventListener("change", saveResponseCountSetting));
  ollamaThinkingSelect.addEventListener("change", saveOllamaThinkingSetting);
  tabScreenshotSelect.addEventListener("change", onTabScreenshotModeChange);
  btnAllowScreenshots.addEventListener("click", allowScreenshotsFromCard);
  btnDismissScreenshotAccess.addEventListener("click", dismissScreenshotAccessCard);
  watchTabsForScreenshots().catch((err) => console.warn("[MyLocalAI] Tab watching unavailable:", err));

  btnApply.addEventListener("click", () => {
    saveSettings();
    settingsPanel.classList.add("hidden");
    restartSession();
  });

  btnSavePrompt.addEventListener("click", () => {
    const content = sysPromptEl.value.trim();
    if (!content) {
      alert("Please enter a system prompt to save.");
      return;
    }

    // Check if already exists to avoid duplicates
    if (savedPromptList.some(p => p.content === content)) {
      alert("This prompt is already saved!");
      return;
    }

    if (savedPromptList.length >= MAX_SAVED_PROMPTS) {
      alert(`You can save up to ${MAX_SAVED_PROMPTS} prompts. Pick one in the list and press its delete button first.`);
      return;
    }

    const name = prompt("Enter a short name for this prompt (e.g., Coding Assistant):");
    if (!name || !name.trim()) return;

    savedPromptList.push({ name: name.trim(), content });
    storeSavedPrompts();
    renderSavedPrompts();
    savedPromptsDropdown.value = content;
  });
  btnDeletePrompt.addEventListener("click", deleteSelectedPrompt);

  // Picking a prompt fills the box, like typing would; Apply & Restart puts it into effect for
  // every backend (Gemini Nano can only take a new system prompt in a new session).
  savedPromptsDropdown.addEventListener("change", (e) => {
    if (e.target.value) sysPromptEl.value = e.target.value;
  });

  btnReset.addEventListener("click", () => {
    if (confirm("Are you sure? This will permanently delete all your chat history and settings.")) {
      localStorage.clear();
      location.reload();
    }
  });

  statusRetryBtn.addEventListener("click", () => init());

  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt;
      if (prompt) {
        userInput.value = prompt;
        autoResizeInput();
        sendMessage(prompt);
      }
    });
  });
}
