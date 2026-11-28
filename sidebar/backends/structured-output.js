// One-shot JSON answers from the active backend, used by the memory tool and to compact long
// chats (chat/compaction.js). They run outside the chat: nothing is added to chatHistory, and
// Gemini Nano answers in a throwaway session.
"use strict";

// ===================== STRUCTURED OUTPUT =====================
const STRUCTURED_OUTPUT_TIMEOUT_MS = 30000;

// Resolves with the model's raw text (callers parse it), or rejects if the backend can't answer.
// options.signal lets the caller cancel it too (Stop); options.timeoutMs gives slow jobs longer.
async function askActiveBackendForJson(prompt, schema, { timeoutMs = STRUCTURED_OUTPUT_TIMEOUT_MS, signal: stopSignal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = stopSignal && AbortSignal.any ? AbortSignal.any([timeout, stopSignal]) : timeout;
  if (activeBackend === "nano") return askNanoForJson(prompt, schema, signal);
  if (activeBackend === "ollama") return askOllamaForJson(prompt, schema, signal);
  if (isProviderActive()) return askProviderForJson(prompt, schema, signal);
  throw new Error("No model is ready");
}

// A clone of the base session (system prompt only), so the chat session is untouched.
// responseConstraint makes Nano produce JSON that matches the schema (Chrome 137+); older
// builds reject the option, and then the prompt's own instructions have to do.
async function askNanoForJson(prompt, schema, signal) {
  if (isModelUnloaded || typeof nanoBaseSession?.clone !== "function") throw new Error("Nano is not loaded");
  const toolSession = await nanoBaseSession.clone();
  try {
    try {
      return await toolSession.prompt(prompt, { responseConstraint: schema, signal });
    } catch (err) {
      if (err?.name !== "NotSupportedError" && !(err instanceof TypeError)) throw err;
      return await toolSession.prompt(prompt, { signal });
    }
  } finally {
    try { toolSession.destroy(); } catch (_) { }
  }
}

// Ollama's `format` takes a JSON schema and constrains the reply to it.
async function askOllamaForJson(prompt, schema, signal) {
  const body = {
    model: getOllamaModel(),
    messages: [{ role: "user", content: prompt }],
    stream: false,
    format: schema,
    options: { temperature: 0, num_ctx: OLLAMA_CONTEXT_TOKENS },
  };
  if (modelSupportsThinking) body.think = false; // reasoning would only delay a tiny JSON reply
  const resp = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`Ollama answered ${resp.status}`);
  const data = await resp.json();
  return data?.message?.content ?? "";
}

// A provider with generateJson() constrains the reply to the schema itself (Firebase: hybrid
// structured output). One that only has stream(), or rejects the schema as unsupported, gets
// the prompt as a one-message chat and the prompt's own instructions have to do.
async function askProviderForJson(prompt, schema, signal) {
  if (typeof externalProvider.generateJson === "function") {
    try {
      return await externalProvider.generateJson({ prompt, schema, signal, settings: providerRequestSettings() });
    } catch (err) {
      if (err?.name !== "NotSupportedError" && !(err instanceof TypeError)) throw err;
    }
  }
  return askProviderForPlainJson(prompt, signal);
}

// The chat's own settings are reused on purpose: different ones would make the Firebase
// provider rebuild its model (and on-device session) for every tool call.
async function askProviderForPlainJson(prompt, signal) {
  const answer = await externalProvider.stream({
    history: [{ role: "user", content: prompt }],
    images: [],
    signal,
    settings: providerRequestSettings(),
    onText() { },
  });
  return answer.content;
}
