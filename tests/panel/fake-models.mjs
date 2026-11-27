// Fake Gemini Nano and Ollama for the panel tests. They answer instantly with fixed text, and
// record what the panel asked of them.

export function abortError() {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

// Resolves when the signal aborts, as a rejection with an AbortError.
function untilAborted(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

// options.answer: the chunks each prompt streams. waitForStop: after them, hang until Stop.
export function fakeNano({ answer = ["ok"], waitForStop = false, canAppend = true, contextWindow = 9000, measureDelayMs = 0 } = {}) {
  const nano = { appended: [], prompts: 0, streaming: 0, promptTokens: 1, LanguageModel: null };
  const makeSession = () => ({
    contextWindow,
    contextUsage: 0,
    clone: async () => makeSession(),
    destroy() { },
    addEventListener() { },
    measureContextUsage: async () => {
      if (measureDelayMs) await new Promise((resolve) => setTimeout(resolve, measureDelayMs));
      return nano.promptTokens;
    },
    ...(canAppend ? { append: async (messages) => { nano.appended.push(JSON.parse(JSON.stringify(messages))); } } : {}),
    promptStreaming: async (_prompt, { signal } = {}) => {
      nano.prompts += 1;
      return (async function* () {
        nano.streaming += 1;
        for (const chunk of answer) yield chunk;
        if (waitForStop) await untilAborted(signal);
      })();
    },
  });
  nano.LanguageModel = { availability: async () => "available", create: async () => makeSession() };
  return nano;
}

function ndjsonStream(frames, { waitForStop } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
      if (!waitForStop) controller.close();
    },
  });
}

// options.answer: the content frames /api/chat streams. waitForStop: keep the body open.
export function fakeOllama({ answer = ["Hello ", "there"], waitForStop = false, models = ["gemma4:e4b"] } = {}) {
  const ollama = { chatBodies: [], fetch: null };
  ollama.fetch = async (url, options = {}) => {
    if (url.endsWith("/api/chat")) {
      ollama.chatBodies.push(JSON.parse(options.body));
      const frames = answer.map((content) => ({ message: { content } }));
      return { ok: true, body: ndjsonStream(frames, { waitForStop }) };
    }
    if (url.endsWith("/api/show")) return { ok: true, json: async () => ({ capabilities: [] }) };
    return { ok: true, json: async () => ({ models: models.map((name) => ({ name })) }) };
  };
  return ollama;
}
