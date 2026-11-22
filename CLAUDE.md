# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rule

Write code that other developers can maintain: small, named, single-purpose functions; comments that explain *why*, not *what*; no clever tricks; and keep new behaviour next to the existing code that owns it instead of adding parallel mechanisms.

## Test and verify before finishing

Before you tell the user a change is done:
1. Run `node tests/regression-checks.mjs`, `node tests/edition-checks.mjs` and `node tests/firebase-checks.mjs`. All must pass. If one fails, fix the cause (or the test, if the change intentionally broke its assumption) and rerun; don't report success on a failing run.
2. If you changed a function that a regression check reads by name, or added/renamed a runtime file, confirm the build still ships it (`node scripts/build.mjs`, then check `dist/`).
3. The tests are static and never execute the extension. For UI or backend behaviour changes, say plainly that it was not checked in a browser, and tell the user which edition to reload and what to try.
4. Report what you ran and the actual result, including anything you could not verify.
5. Alway create and edit new tests and verification when you edit or add code

## What this is

MyLocalAI is a Manifest V3 browser extension (Chrome side panel) for private on-device chat. There is no `package.json`, bundler, or dependency install: it is plain JS/HTML/CSS. Node 18+ is only needed for the build and tests.

## Commands

```bash
node scripts/build.mjs               # build all editions into dist/mylocalai-{nano,ollama,mixed,firebase-hybrid}/
node scripts/build.mjs nano          # build one edition (nano | ollama | mixed | firebase-hybrid)
node scripts/build.mjs --zip         # also produce dist/mylocalai-<edition>.zip (needs `zip`; the firebase-hybrid zip includes firebase-settings.local.js if present)

node tests/regression-checks.mjs     # static checks over source files (no browser)
node tests/edition-checks.mjs        # runs the build, then asserts each dist/ edition's config + manifest
node tests/firebase-checks.mjs       # firebase-hybrid edition: files, SHARED_FILES, manifest, opt-in cloud, prompt builder

cd tools/firebase-bundle && npm install && npm run build   # rebuild vendor/firebase-ai.js (only package.json lives here, never in the root)
```

Tests are plain `node:assert` scripts, so there is no runner or single-test flag: run one file at a time. They read source files as text (e.g. `functionBody()` extracts a function from `sidebar.js`) rather than executing the extension, so renaming or moving a function in `sidebar.js` can break a regression check.

**Git hook** (`.githooks/pre-commit`, enabled with `git config core.hooksPath .githooks` — run this once per clone): every commit first runs all three test scripts and is blocked if any fails. On every second commit (by total commit count) it also bumps the patch version in `manifest.json` via `scripts/bump-version.mjs` and stages it. 

To try changes: load the repo root (the Mixed edition) or a `dist/` folder via `chrome://extensions` → Load unpacked, then use ↻ on the extension and reopen the side panel.

## Architecture

**One codebase, four editions** (nano, ollama, mixed, firebase-hybrid). The firebase-hybrid edition uses `backends: ["firebase"]`: `firebase-backend.js` registers a provider in `window.MYLOCALAI_PROVIDERS`, and `sidebar.js` talks to it only through the `EXTERNAL PROVIDER HOOK` section (`streamProvider`). Keep Firebase code out of `sidebar.js`; real Firebase config lives only in the git-ignored `firebase-settings.local.js`. The repo root *is* the Mixed edition (`manifest.json` + `config.js`). `scripts/build.mjs` copies `SHARED_FILES` into each `dist/` folder and generates a per-edition `manifest.json` (overrides in `EDITIONS`: name, description, `host_permissions`, `minimum_chrome_version`) and `config.js` (`window.MYLOCALAI_CONFIG = { edition, backends }`). Consequences:
- Make changes in root files, never in `dist/` (git-ignored, overwritten on build).
- A new runtime file must be added to `SHARED_FILES` in `scripts/build.mjs`, or it will not ship in `dist/`.
- The Nano edition deliberately has no `host_permissions`; don't add network access to shared code paths without considering that.
- Edition differences belong in `EDITIONS` / `config.js`, not in `if (edition === …)` branches in the UI code. `sidebar.js` only reads `backends` (`nanoEnabled` / `ollamaEnabled`).

**Runtime pieces**
- `background.js` (service worker): opens the side panel on action click, registers the right-click "Use selection as MyLocalAI context" menu, and holds the pending selection. It hands text to the panel via a `TEXT_SELECTED` message, or the panel pulls it with `GET_SELECTED_CONTEXT` on load (covers the panel not being open yet).
- `page-watch.js` (content script): reports `PAGE_SCROLL_SETTLED` (debounced) and `PAGE_TEXT_SELECTED` to the panel. It is never in `manifest.json` (that would make site access install-time); `background.js` registers it with `chrome.scripting` only while optional `<all_urls>` access is granted, and the panel injects it into the already-open tab.
- `sidebar.html/.css/.js`: the entire chat UI and both AI backends, in a single IIFE in `sidebar.js` (~1.5k lines). Sections are marked with `// ===== NAME =====` banners (DOM refs, edition config, state, settings, sessions/history, backend init, streaming, rendering, event listeners).
- Backend selection (`init` → `initNanoSession` / `initOllamaSession`): Nano is tried first when enabled, Ollama is the fallback; `activeBackend` is `"nano" | "ollama" | null` and `updateBackendUI` reflects it. Sending goes through `sendMessage` → `streamNano` or `streamOllama`.
  - Nano uses Chrome's `LanguageModel` Prompt API (session object kept in `session`).
  - Ollama uses the REST API at `DEFAULT_OLLAMA_URL` with `fetchWithTimeout`; its default model (`DEFAULT_OLLAMA_MODEL`) and URL are defined once near the top of `sidebar.js`.
- Rendering: `marked.umd.js` parses Markdown and `purify.min.js` (DOMPurify) sanitizes it; route model output through `setSafeHtml`, never assign raw HTML.
- State is persisted in extension storage per edition (chat sessions, saved prompts, settings), so installed editions don't share history.

**Unused file:** `content.js` (answers `GET_SELECTED_TEXT`) is not referenced by `manifest.json` or `SHARED_FILES`, so it never ships; selection capture goes through the context menu in `background.js`. It is only read by `tests/regression-checks.mjs`.

`README.md` holds the user-facing setup (Chrome flags for Gemini Nano, Ollama CORS via `OLLAMA_ORIGINS` and `set-ollama-cors.plist`); update it when changing editions or setup requirements.

Create new files to keep code organised and separated for maintaince and development.

Detail the value proposition, and must demonstrate the use of Firebase AI Logic at runtime in your code — imported and actually called (a library import, an app/backend entry point, or a loaded agent/flow/MCP config), not just named in the README. 