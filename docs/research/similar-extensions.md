# Similar open-source extensions (competitive scan)

Found 2026-11-28 by web search; repos were not cloned or audited.

| Project | What it is | Link |
|---|---|---|
| Google's Prompt API sample | Official MV3 sample: chat UI on Gemini Nano | https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-on-device |
| Dobby | Small side-panel chat on Gemini Nano, no API keys, no build step | https://github.com/herryupmay/Dobby |
| Nano Prompt UI | MV3 side panel, one-click page summary, multiple sessions, Markdown export | https://github.com/theodedra/nano-prompt-ui |
| Local AI Sidebar | Web Store listing that says MIT / open source (repo not verified) | https://chromewebstore.google.com/detail/local-ai-sidebar/oihcenhffgplemccnbaopcflipaiplmo |
| Others (not shown to be open source) | Gemini Nano Chat (Unofficial), Sideway Chatbot, Chrome AI | Chrome Web Store |

## How MyLocalAI differs (use this in the pitch)

- **All of the above are on-device only.** None routes between Nano and a cloud model, so
  on a laptop without Nano, or with a document longer than ~9k tokens, they stop working.
  MyLocalAI's Firebase Hybrid edition keeps going through Firebase AI Logic, opt-in.
- Per-answer transparency: each answer is labelled on-device or cloud (and why).
- Page-aware: selected text, tab screenshot, whole-page capture as several readable images.
- Memory tool and chat compaction through hybrid structured output.
- Four editions from one codebase (Nano, Ollama, Mixed, Firebase Hybrid), with tests that
  boot the panel against fakes.
