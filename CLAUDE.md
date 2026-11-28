# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rule

Write code that other developers can maintain: small, named, single-purpose functions; comments that explain *why*, not *what*; no clever tricks; and keep new behaviour next to the existing code that owns it instead of adding parallel mechanisms.

## Test and verify before finishing

Before you tell the user a change is done:
1. Run `node tests/regression-checks.mjs`, `node tests/edition-checks.mjs`, `node tests/firebase-checks.mjs`, `node tests/full-page-checks.mjs` and `node tests/structure-checks.mjs`. All must pass. If one fails, fix the cause (or the test, if the change intentionally broke its assumption) and rerun; don't report success on a failing run.
2. If you changed a function that a check reads by name, or added/renamed a runtime file, confirm the build still ships it (`node scripts/build.mjs`, then check `dist/`).
3. The tests never run the extension in a browser (most are static; `full-page-checks.mjs` and `structure-checks.mjs` execute code against fakes). For UI or backend behaviour changes, say plainly that it was not checked in a browser, and tell the user which edition to reload and what to try.
4. Report what you ran and the actual result, including anything you could not verify.
5. Alway create and edit new tests and verification when you edit or add code

## Research notes: read before searching the web

Saved research lives in `docs/research/` (index: `docs/research/README.md`). Read the matching file **before** fetching any web page or starting a research agent, and only go to a source URL listed there when the note lacks the detail you need. Devpost pages block automated fetches (403), so the notes are the reliable copy of the hackathon pages.

- Writing the hackathon submission, README value proposition, demo video script, or checking a deadline, requirement, judging criterion or prize → `docs/research/hackathon.md` (rules with section numbers: `docs/HACKATHON_RULES.md`). Deadline: **Nov 30, 2026, 2:00 PM PT**.
- Editing `providers/firebase-*.js`, `tools/firebase-bundle/`, the firebase-hybrid edition in `scripts/build.mjs`, adding a Firebase product (App Check, Remote Config, Auth, Firestore), choosing a model name, or building any new Firebase AI Logic hybrid app → `docs/research/firebase-ai-logic-hybrid.md`.
- Editing `sidebar/backends/nano*.js`, model download/availability or context-window handling, or using another Chrome built-in AI API → `docs/research/chrome-built-in-ai.md`.
- Arguing what is new about the project, or looking for UI ideas from similar extensions → `docs/research/similar-extensions.md`.
- Planning the next feature, or changing routing, structured output or Remote Config behaviour → `docs/research/hybrid-decisions.md` (what is built, what is unverified, ranked ideas). Update it when you finish or change an item.

When you learn something new from the web, add it to the matching note with the date and source URL, so the next agent doesn't fetch it again.

## What this is

MyLocalAI is a Manifest V3 browser extension (Chrome side panel) for private on-device chat. There is no `package.json`, bundler, or dependency install: it is plain JS/HTML/CSS. Node 18+ is only needed for the build and tests.

## Commands

```bash
node scripts/build.mjs               # build all editions into dist/mylocalai-{nano,ollama,mixed,firebase-hybrid}/
node scripts/build.mjs nano          # build one edition (nano | ollama | mixed | firebase-hybrid)
node scripts/build.mjs --zip         # also produce dist/mylocalai-<edition>.zip (needs `zip`; firebase-settings.local.js goes into dist/ but never into a zip, since it holds the App Check debug token)

node tests/regression-checks.mjs     # static checks over source files (no browser)
node tests/edition-checks.mjs        # runs the build, then asserts each dist/ edition's config + manifest
node tests/firebase-checks.mjs       # firebase-hybrid edition: files, SHARED_FILES, manifest, opt-in cloud, prompt builder
node tests/full-page-checks.mjs      # whole-page screenshot, stop & save, image preview/removal; runs against a fake page + chrome API
node tests/structure-checks.mjs      # 500-line limit, sidebar.html load list, a boot of the panel, and the behaviour tests in tests/panel/ (fake browser + fake models)

cd tools/firebase-bundle && npm install && npm run build   # rebuild vendor/firebase-ai.js (only package.json lives here, never in the root)
```

Tests are plain `node:assert` scripts, so there is no runner or single-test flag: run one file at a time. Most read source files as text through `tests/helpers/sources.mjs`, which treats the `sidebar/` scripts listed in `sidebar.html` as one source (`functionBody()` extracts a function by name), so moving a function between files is safe but renaming one can break a check. `regression-checks.mjs` only imports the topic files in `tests/regression/`; `full-page-checks.mjs` also imports those in `tests/full-page/` and shares `tests/helpers/fake-page.mjs` with them. `structure-checks.mjs` imports the topic files in `tests/panel/`, which boot the panel with `tests/helpers/fake-panel.mjs` and drive it against the fake Nano/Ollama in `tests/panel/fake-models.mjs`.

**Git hook** (`.githooks/pre-commit`, enabled with `git config core.hooksPath .githooks` — run this once per clone): every commit first runs all five test scripts and is blocked if any fails. On every second commit (by total commit count) it also bumps the patch version in `manifest.json` via `scripts/bump-version.mjs` and stages it.

To try changes: load the repo root (the Mixed edition) or a `dist/` folder via `chrome://extensions` → Load unpacked, then use ↻ on the extension and reopen the side panel.

## Architecture

**One codebase, four editions** (nano, ollama, mixed, firebase-hybrid). The firebase-hybrid edition uses `backends: ["firebase"]`: `providers/firebase-backend.js` registers a provider in `window.MYLOCALAI_PROVIDERS`, and the sidebar talks to it only through `sidebar/backends/provider-hook.js` (`streamProvider`). Keep Firebase code out of `sidebar/`; real Firebase config lives only in the git-ignored `firebase-settings.local.js`. The repo root *is* the Mixed edition (`manifest.json` + `config.js`). `scripts/build.mjs` copies `SHARED_FILES` into each `dist/` folder and generates a per-edition `manifest.json` (overrides in `EDITIONS`: name, description, `host_permissions`, `minimum_chrome_version`) and `config.js` (`window.MYLOCALAI_CONFIG = { edition, backends }`). Consequences:
- Make changes in the source files, never in `dist/` (git-ignored, overwritten on build).
- `SHARED_FILES` lists whole folders (`sidebar/`, `features/`, `providers/`, `styles/`, `vendor/`, `icons/`), so a new file in one ships automatically; a new root file or folder must be added to it.
- The Nano edition deliberately has no `host_permissions`; don't add network access to shared code paths without considering that.
- Edition differences belong in `EDITIONS` / `config.js`, not in `if (edition === …)` branches in the UI code. The sidebar only reads `backends` (`nanoEnabled` / `ollamaEnabled`).

**Runtime pieces**
- `background.js` (service worker): opens the side panel on action click, registers the right-click "Use selection as MyLocalAI context" menu, and holds the pending selection. It hands text to the panel via a `TEXT_SELECTED` message, or the panel pulls it with `GET_SELECTED_CONTEXT` on load (covers the panel not being open yet).
- `page-watch.js` (content script): reports `PAGE_SCROLL_SETTLED` (debounced) and `PAGE_TEXT_SELECTED` to the panel. It is never in `manifest.json` (that would make site access install-time); `background.js` registers it with `chrome.scripting` only while optional `<all_urls>` access is granted, and the panel injects it into the already-open tab.
- `features/full-page-capture.js`: "Screenshot whole page". Scrolls the tab one screen at a time and returns one image per screen (at most `MAX_PAGE_PARTS`), so text stays readable; its page functions are injected with `chrome.scripting`, so they must be self-contained. Aborting `signal` discards the capture; aborting `stopSignal` ("Stop & save") keeps the parts taken. A user message in `chatHistory` is `{ role, content, images? }` (base64 JPEGs); chats saved in the old `<text>__IMG__<base64>…` form are converted when read (`upgradeLegacyImageMessage`).
- `features/capture-indicator.js`: the glowing page border shown during a capture. It is hidden before every picture, skipped by the capture's pinned-element hiding (`data-mylocalai-overlay`), and removes itself if the panel goes away.
- Memory (`sidebar/memory/`): `memory-store.js` owns the saved facts and their limits (`MAX_MEMORIES`, `MAX_MEMORY_TOTAL_CHARS` in `core/config.js`); `getSystemPrompt()` appends them. `memory-tool.js` is the model's tool call: after a reply, one JSON action (`none|create|update|delete`, `MEMORY_TOOL_SCHEMA`) asked through `askActiveBackendForJson` (`backends/structured-output.js`: Nano `responseConstraint`, Ollama `format`, providers via `stream`). It only ever sees the typed text, never selected text or pages. Nano rebuilds its base session in `resetNanoChat` when the system prompt changed. The panel is `ui/memory-panel.js`.
- Pending images (`attachedImages`) can be previewed (`sidebar/attachments/image-viewer.js`) and removed one by one; `attachedPage` remembers which page parts remain so the note sent to the model stays accurate.
- `sidebar.html` + `sidebar/` + `styles/`: the entire chat UI and both built-in backends. `sidebar/` holds classic scripts (not ES modules) that **share one global scope**: `core/` (DOM refs, config, state, settings), `backends/`, `chat/`, `ui/`, `attachments/`, `events.js`, and `main.js`.
  - The `<script>` list in `sidebar.html` is the load order: `core/` first, `main.js` last. Only `main.js` starts work; other files must not call across files at load time.
  - Top-level names must be unique across these files, and each file starts with `"use strict"`.
  - Add a new file by creating it and adding its tag to `sidebar.html`. Every hand-written file stays under 500 lines (`structure-checks.mjs` enforces this).
- `features/`: self-contained IIFE modules that expose one `window.MyLocalAI…` object. `styles/` is linked in cascade order.
- Backend selection (`init` → `initNanoSession` / `initOllamaSession`): Nano is tried first when enabled, Ollama is the fallback; `activeBackend` is `"nano" | "ollama" | null` and `updateBackendUI` reflects it. Sending goes through `sendMessage` → `streamNano` or `streamOllama`.
  - Nano uses Chrome's `LanguageModel` Prompt API (session object kept in `session`).
  - Ollama uses the REST API at `DEFAULT_OLLAMA_URL` with `fetchWithTimeout`; its default model (`DEFAULT_OLLAMA_MODEL`) and URL are defined once in `sidebar/core/config.js`.
- Rendering: `vendor/marked.umd.js` parses Markdown and `vendor/purify.min.js` (DOMPurify) sanitizes it; route model output through `setSafeHtml`, never assign raw HTML.
- State is persisted in extension storage per edition (chat sessions, saved prompts, settings), so installed editions don't share history.

**Unused file:** `content.js` (answers `GET_SELECTED_TEXT`) is not referenced by `manifest.json` or `SHARED_FILES`, so it never ships; selection capture goes through the context menu in `background.js`. It is only read by `tests/regression-checks.mjs`.

`README.md` holds the user-facing setup (Chrome flags for Gemini Nano, Ollama CORS via `OLLAMA_ORIGINS` and `docs/set-ollama-cors.plist`); update it when changing editions or setup requirements.

Create new files to keep code organised and separated for maintaince and development.

Detail the value proposition, and must demonstrate the use of Firebase AI Logic at runtime in your code — imported and actually called (a library import, an app/backend entry point, or a loaded agent/flow/MCP config), not just named in the README. 