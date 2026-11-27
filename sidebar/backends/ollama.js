// Ollama backend: local REST API.
"use strict";

// ===================== OLLAMA BACKEND =====================
async function initOllamaSession() {
  const baseUrl = getOllamaUrl();
  const model = getOllamaModel();

  // Test connection — hit the /api/tags endpoint
  let resp;
  try {
    resp = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, REQUEST_TIMEOUT_MS);
  } catch (fetchErr) {
    throw new Error(fetchErr.name === "TimeoutError" ? "OLLAMA_TIMEOUT" : "OLLAMA_CONNECT_FAILED");
  }

  if (!resp.ok) throw new Error(`OLLAMA_CONNECT_FAILED_${resp.status}`);

  let data;
  try {
    data = await resp.json();
  } catch (_) {
    throw new Error("OLLAMA_INVALID_RESPONSE");
  }
  const models = (data.models || []).map((m) => m.name);
  console.log("[MyLocalAI] Ollama models available:", models);

  // Check if the requested model exists in local tags
  const modelExistsLocally = models.some((m) => m === model || m.startsWith(model.split(":")[0]));
  const isCloudModel = model.includes(":cloud") || model.includes("-cloud");

  // Session is just "connection verified" for Ollama
  session = null; // no persistent session object for Ollama
  isModelUnloaded = false;
  modelSupportsVision = false;
  modelSupportsThinking = false;

  // Try /api/show to detect capabilities.
  // Works for local models and pulled cloud models.
  // May fail for cloud models that haven't been explicitly pulled yet.
  let showSucceeded = false;
  try {
    const showResp = await fetchWithTimeout(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model })
    }, REQUEST_TIMEOUT_MS);
    if (showResp.ok) {
      showSucceeded = true;
      const showData = await showResp.json();
      const caps = showData.capabilities || [];
      const families = showData.details?.families || [];
      console.log(`[MyLocalAI] Model "${model}" capabilities:`, caps, "families:", families);

      // Vision detection from API
      modelSupportsVision = caps.includes("vision") ||
        families.some(f => f.toLowerCase().includes('clip') || f.toLowerCase().includes('vision'));

      // Thinking detection from API
      modelSupportsThinking = caps.includes("thinking");
    }
  } catch (e) {
    console.warn(`[MyLocalAI] /api/show request failed for "${model}":`, e.message);
  }

  // If /api/show didn't work, fall back to name-based heuristics.
  // This covers cloud models that haven't been pulled yet but will
  // auto-pull when the user sends a chat request.
  if (!showSucceeded) {
    const lowerModel = model.toLowerCase();

    // Name-based vision heuristics
    modelSupportsVision =
      lowerModel.includes('llava') ||
      lowerModel.includes('vision') ||
      lowerModel.includes('minicpm') ||
      lowerModel.startsWith('gemma3') ||
      lowerModel.startsWith('gemma4');

    // Name-based thinking heuristics
    modelSupportsThinking =
      lowerModel.includes('deepseek-r1') ||
      lowerModel.includes('qwq') ||
      lowerModel.startsWith('gemma4');

    console.info(`[MyLocalAI] /api/show unavailable for "${model}". Using name heuristics. Vision: ${modelSupportsVision}, Thinking: ${modelSupportsThinking}`);
  }

  // Determine validity:
  // - /api/show succeeded → definitely valid
  // - Cloud model → assume valid (Ollama will auto-pull on first prompt)
  // - In local tags → valid
  // - Otherwise → might still work (Ollama can pull on demand), treat as valid but warn
  isOllamaModelValid = showSucceeded || isCloudModel || modelExistsLocally;
  if (!isOllamaModelValid) {
    console.warn(`[MyLocalAI] Model "${model}" not found locally or in cloud. It may be pulled on first use.`);
    isOllamaModelValid = true; // Don't block — Ollama will attempt to pull
  }

  console.log(`[MyLocalAI] Ollama ready at ${baseUrl} with model ${model}. Vision: ${modelSupportsVision}, Thinking: ${modelSupportsThinking}`);
}

async function ollamaPromptStreaming(text, signal) {
  const baseUrl = getOllamaUrl();
  const model = getOllamaModel();
  const systemPrompt = sysPromptEl.value.trim() || DEFAULT_SYSTEM_PROMPT;

  // Build messages array for multi-turn conversation. sendMessage() already
  // stores the current user message before streaming, so chatHistory is the
  // single source of truth here.
  const messages = [
    { role: "system", content: systemPrompt },
    ...chatHistory.slice(-MAX_CHAT_MESSAGES).map(m => {
      // History stores "<text>__IMG__<base64>__IMG__<base64>…"; Ollama takes the images as an array.
      if (m.role === "user" && m.content.includes("__IMG__")) {
        const [content, ...images] = m.content.split("__IMG__");
        return { role: m.role, content, images };
      }
      // Only the selected answer (already in `content`) belongs in the prompt;
      // the unused alternatives would just waste the model's context.
      const { variants, selected, ...message } = m;
      return message;
    }),
  ];

  const requestBody = {
    model,
    messages,
    stream: true,
    options: {
      temperature: parseFloat(tempSlider.value),
      top_k: parseInt(topkSlider.value, 10),
    },
  };

  // Enable thinking for models that support it
  if (modelSupportsThinking) {
    requestBody.think = true;
  }

  const resp = await fetchWithTimeout(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  }, GENERATION_TIMEOUT_MS, signal);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`Ollama error (${resp.status}): ${errText.slice(0, 500)}`);
  }

  if (!resp.body || typeof resp.body.getReader !== "function") {
    throw new Error("Ollama returned no readable stream");
  }

  return resp.body;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortExternal, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      const timeoutError = new Error(`Request timed out after ${timeoutMs / 1000}s`);
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortExternal);
  }
}

// ── Ollama streaming ──
async function streamOllama(text, aiBubble) {
  const body = await ollamaPromptStreaming(text, abortController.signal);
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let fullText = "";
  let reasoningText = "";
  let inThinkingTag = false;
  let buffer = "";

  const consumeLine = (line) => {
    if (!line.trim()) return;
    const json = JSON.parse(line);
    if (json.error) {
      throw new Error(`Ollama error: ${String(json.error).slice(0, 500)}`);
    }

    // Ollama uses `message.thinking`; older versions may use `reasoning`.
    reasoningText += json.message?.thinking || json.message?.reasoning || "";

    if (json.message?.content) {
      let contentChunk = json.message.content;

      // Handle models that embed reasoning in <think> tags.
      if (contentChunk.includes("<think>")) {
        inThinkingTag = true;
        const parts = contentChunk.split("<think>");
        if (parts[0]) fullText += parts[0];
        contentChunk = parts[1] || "";
      }

      if (inThinkingTag) {
        if (contentChunk.includes("</think>")) {
          inThinkingTag = false;
          const parts = contentChunk.split("</think>");
          reasoningText += parts[0];
          fullText += parts[1] || "";
        } else {
          reasoningText += contentChunk;
        }
      } else {
        fullText += contentChunk;
      }
    }

    renderStreamingText(aiBubble, fullText, reasoningText);
    scrollToBottom();
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      try {
        consumeLine(line);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Ollama protocol error: malformed NDJSON frame");
        }
        throw error;
      }
    }
  }

  // Flush decoder so split UTF-8 characters are completed before parsing.
  buffer += decoder.decode();
  const finalLines = buffer.split("\n");
  buffer = finalLines.pop() || "";

  for (const line of finalLines) {
    try {
      consumeLine(line);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Ollama protocol error: malformed NDJSON frame");
      }
      throw error;
    }
  }

  // Some proxies return final NDJSON object without a trailing newline.
  if (buffer.trim()) {
    try {
      consumeLine(buffer);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Ollama protocol error: malformed NDJSON frame");
      }
      throw error;
    }
  }

  finalizeMessage(aiBubble, fullText, reasoningText);
  return { content: fullText, reasoning: reasoningText };
}
