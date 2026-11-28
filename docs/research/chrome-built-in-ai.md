# Chrome built-in AI (Gemini Nano) — reference for extensions

Researched 2026-11-28 (paraphrased).

| Source | URL |
|---|---|
| Built-in AI APIs and status | https://developer.chrome.com/docs/ai/built-in-apis |
| Prompt API for extensions | https://developer.chrome.com/docs/extensions/ai/prompt-api |
| Get started (hardware) | https://developer.chrome.com/docs/ai/get-started |
| Inform users of model download | https://developer.chrome.com/docs/ai/inform-users-of-model-download |
| Google's sample extension | https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-on-device |
| Offline chatbot with the Prompt API | https://web.dev/articles/ai-chatbot-promptapi |

## API status (stable Chrome)

| API | Status |
|---|---|
| Prompt API (`LanguageModel`) | Extensions: stable since Chrome 138. Web: Chrome 148. |
| Summarizer, Translator, Language Detector | Stable since Chrome 138 (web and extensions) |
| Writer, Rewriter, Proofreader | Developer / origin trial only |

All of them can be used from extensions. Remove the expired
`"aiLanguageModelOriginTrial"` permission if present. Translator and Language Detector use
small expert models, not Gemini Nano. From Chrome 149 the models handle English, Spanish,
Japanese, German and French.

## Prompt API essentials

- `LanguageModel.availability(options)` → `"unavailable" | "downloadable" | "downloading" | "available"`.
  Pass the **same** options as to `create()`.
- `LanguageModel.create({ initialPrompts, expectedInputs, expectedOutputs, temperature, topK, monitor, signal })`.
  Extensions keep `temperature`/`topK` (set both or neither, within `LanguageModel.params()`);
  the web uses `samplingMode` instead.
- `session.prompt()` / `promptStreaming()` with `{ responseConstraint, signal, omitResponseConstraintInput }`.
  `responseConstraint` takes a JSON Schema or a RegExp and uses context space.
- `session.append()`, `session.clone()`, `session.destroy()`, assistant prefill
  (`{ role: "assistant", content, prefix: true }`).
- Context: `session.contextUsage`, `session.contextWindow`, `session.measureContextUsage(input)`.
  On overflow the oldest turns are dropped (system prompt kept) and `contextoverflow` fires;
  if it still can't fit, `QuotaExceededError` (with `requested`, `contextWindow`).
- Multimodal input: text, image (img/canvas/ImageBitmap/Blob…), audio (needs a GPU).
  Output is text only. Unsupported types throw `NotSupportedError`.
- Not available in Web Workers; cross-origin iframes need `allow="language-model"`.

## Hardware and storage

- Windows 10/11, macOS 13+, Linux, ChromeOS (Chromebook Plus). **Not Android or iOS.**
- At least **22 GB free** on the profile's volume; the model is removed if free space drops
  under 10 GB and downloaded again later.
- GPU with more than 4 GB VRAM, or CPU with 16 GB RAM and 4+ cores.
- Unmetered network for the first download only; prompts never leave the device.
- Debug: `chrome://on-device-internals`, then `await LanguageModel.availability()` in DevTools.

## Best practices

- Check availability first; explain clearly when the device can't run it.
- **Downloads need user activation**: check `navigator.userActivation.isActive` and start
  from a click. Show progress via `monitor(m) { m.addEventListener("downloadprogress", …) }`,
  then an indeterminate "preparing" state.
- Hybrid pattern: answer from the cloud while Nano downloads, then switch to local.
- Reuse sessions (creation is slow), `destroy()` when done, restore with `initialPrompts`.
- TypeScript types: `@types/dom-chromium-ai`. UX guidance: People + AI Guidebook
  (pair.withgoogle.com/guidebook).
- Offscreen documents and extension permissions are not covered by these pages.
