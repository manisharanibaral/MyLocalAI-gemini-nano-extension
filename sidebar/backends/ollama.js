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

  // Known to Ollama when /api/show answered, it is in the local tags, or it is a cloud model
  // (Ollama pulls those on the first prompt). Otherwise sending is still allowed, but the
  // header warns, because the first reply will fail unless Ollama can pull the model.
  isOllamaModelValid = showSucceeded || isCloudModel || modelExistsLocally;
  if (!isOllamaModelValid) {
    console.warn(`[MyLocalAI] Model "${model}" not found locally or in cloud. It may be pulled on first use.`);
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
      // Ollama takes a message's images as an array of base64 strings, like history keeps them.
      if (m.role === "user") {
        return m.images?.length ? { role: m.role, content: m.content, images: m.images } : { role: m.role, content: m.content };
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
  const signal = abortController.signal;
  const body = await ollamaPromptStreaming(text, signal);
  const reader = body.getReader();
  // fetchWithTimeout() stops watching the signal once the reply has started, so Stop must
  // end the read of the body here; cancel() makes the pending read() return at once.
  const stopReading = () => reader.cancel().catch(() => { });
  signal.addEventListener("abort", stopReading, { once: true });
  if (signal.aborted) stopReading();
  try {
    return await readOllamaStream(reader, aiBubble, signal);
  } finally {
    signal.removeEventListener("abort", stopReading);
  }
}

// Reads Ollama's NDJSON frames, rendering as they arrive. Throws an AbortError on Stop, so
// the answer is kept as stopped (see showResponseError) instead of as finished.
async function readOllamaStream(reader, aiBubble, signal) {
  const decoder = new TextDecoder();
  const answer = { text: "", reasoning: "", inThinkingTag: false };
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (signal.aborted) throw stoppedByUser();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line in buffer
    lines.forEach(line => consumeOllamaLine(line, answer, aiBubble));
  }

  // Flush decoder so split UTF-8 characters are completed before parsing. Some proxies
  // send the final NDJSON object without a trailing newline, so the rest is a line too.
  buffer += decoder.decode();
  buffer.split("\n").forEach(line => consumeOllamaLine(line, answer, aiBubble));

  finalizeMessage(aiBubble, answer.text, answer.reasoning);
  return { content: answer.text, reasoning: answer.reasoning };
}

function stoppedByUser() {
  const err = new Error("Generation stopped");
  err.name = "AbortError";
  return err;
}

// Adds one NDJSON frame to the answer. Reasoning arrives in `message.thinking` (older
// versions: `reasoning`), or inside <think> tags in the content for some models.
function consumeOllamaLine(line, answer, aiBubble) {
  if (!line.trim()) return;
  let json;
  try {
    json = JSON.parse(line);
  } catch (_) {
    throw new Error("Ollama protocol error: malformed NDJSON frame");
  }
  if (json.error) {
    throw new Error(`Ollama error: ${String(json.error).slice(0, 500)}`);
  }

  answer.reasoning += json.message?.thinking || json.message?.reasoning || "";

  if (json.message?.content) {
    let contentChunk = json.message.content;

    if (contentChunk.includes("<think>")) {
      answer.inThinkingTag = true;
      const parts = contentChunk.split("<think>");
      if (parts[0]) answer.text += parts[0];
      contentChunk = parts[1] || "";
    }

    if (answer.inThinkingTag) {
      if (contentChunk.includes("</think>")) {
        answer.inThinkingTag = false;
        const parts = contentChunk.split("</think>");
        answer.reasoning += parts[0];
        answer.text += parts[1] || "";
      } else {
        answer.reasoning += contentChunk;
      }
    } else {
      answer.text += contentChunk;
    }
  }

  renderStreamingText(aiBubble, answer.text, answer.reasoning);
  scrollToBottom();
}
