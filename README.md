# MyLocalAI

A private AI chat in your browser's side panel. The Nano, Ollama and Mixed editions run entirely on your own machine: no accounts, no API keys, and nothing is sent to the cloud. The **Firebase Hybrid** edition runs on-device by default too, and lets you *opt in* to a cloud Gemini fallback through Firebase AI Logic.

MyLocalAI comes in **four editions**. Pick the one that matches your browser and setup:

| Edition | AI engine | Browsers | Extra software | Best for |
|---|---|---|---|---|
| **Gemini Nano** | Chrome's built-in Gemini Nano | Google Chrome 138+ (desktop) | None | Chrome users who want zero setup |
| **Ollama** | Any model you run in [Ollama](https://ollama.com) | Chrome, Edge, Brave, Opera, Vivaldi, Arc… | Ollama | Non-Chrome browsers, or picking your own model (Llama, Qwen, Gemma, DeepSeek…) |
| **Mixed** | Gemini Nano, falls back to Ollama | Any Chromium browser | Optional | People who want it to work everywhere |
| **Firebase Hybrid** | Gemini Nano on-device via [Firebase AI Logic](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started), opt-in cloud Gemini fallback | Google Chrome 139+ (desktop) | A Firebase project | Private by default, still answering when on-device AI isn't available |

All editions have the same features: streaming chat, saved chat history, saved system prompts, temperature/top-K settings, Markdown, code blocks with copy buttons, and image input when the model supports it. You can also right-click selected text on any page and choose **"Use selection as MyLocalAI context"**.

> Firefox and Safari aren't supported: they don't have the Chrome side panel API.

---

## 1. Get the extension folders

You need [Node.js](https://nodejs.org) 18 or newer for this step.

```bash
node scripts/build.mjs
```

This creates one ready-to-load folder per edition:

```
dist/
├── mylocalai-nano/     ← Gemini Nano only
├── mylocalai-ollama/   ← Ollama only
├── mylocalai-mixed/    ← Nano first, Ollama fallback
└── mylocalai-firebase-hybrid/ ← Firebase AI Logic: Nano on-device, opt-in cloud Gemini
```

Other options:

```bash
node scripts/build.mjs nano          # build just one edition
node scripts/build.mjs --zip         # also make dist/mylocalai-<edition>.zip (e.g. for the Chrome Web Store)
```

> **No Node?** The repository root is itself the **Mixed** edition. You can load the root folder directly (step 2) and skip the build.

## 2. Install it in your browser

1. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Turn on **Developer mode** (toggle in the top-right, or bottom-left in Edge).
3. Click **Load unpacked** and select the edition's folder, e.g. `dist/mylocalai-nano`.
4. Pin the extension and click its icon. The chat opens in the side panel.

Each edition has its own name ("MyLocalAI — Gemini Nano", "MyLocalAI — Ollama", "MyLocalAI"), so you can install more than one at the same time. Each one keeps its own chat history and settings.

## 3. Set up your AI engine

### Gemini Nano edition

Gemini Nano is built into desktop Google Chrome. You need to turn it on once:

1. Use **Google Chrome 138 or newer** on Windows, macOS, Linux, or ChromeOS (Chromebook Plus).
2. Open `chrome://flags/#prompt-api-for-gemini-nano` and set it to **Enabled**.
3. Open `chrome://flags/#optimization-guide-on-device-model` and set it to **Enabled BypassPerfRequirement**.
4. **Relaunch Chrome.**
5. Open MyLocalAI. If it says the model is ready to download, click **Retry**. Chrome then downloads Gemini Nano and the panel shows the progress, then a short "Preparing" step while Chrome loads the model. Chrome may download the model again later (after an update, or if it deleted the model because free disk space dropped below about 10 GB); MyLocalAI tells you when that happens, and sending a message starts the new download.

Hardware Chrome needs for Gemini Nano:
- About **22 GB free disk space** on the drive with your Chrome profile
- A GPU with **more than 4 GB VRAM**, *or* **16 GB RAM and 4+ CPU cores**
- An unmetered (not mobile-data) connection for the first download

**Still not working?** Open `chrome://on-device-internals` and check the model status for errors. Or open DevTools on any page and run `await LanguageModel.availability()`:
- `"available"`: ready to use
- `"downloadable"` / `"downloading"`: click **Retry** in MyLocalAI and wait for the download
- `"unavailable"`: your device or Chrome version doesn't meet the requirements

### Ollama edition

1. **Install Ollama** from [ollama.com/download](https://ollama.com/download) and start it.
2. **Download a model.** The default is [`gemma4:e4b`](https://ollama.com/library/gemma4), Google's latest Gemma. It understands images and can show its reasoning:
   ```bash
   ollama pull gemma4:e4b
   ```
   Other good choices: `llama3.2`, `qwen3`, `deepseek-r1` (shows its reasoning), or a smaller model such as `gemma3:1b` if your computer is low on memory.
3. **Allow the extension to talk to Ollama (CORS).** By default Ollama blocks requests from browser extensions. First find your extension ID: on `chrome://extensions` it's the long string under the extension's name, e.g. `abcdefghijklmnopabcdefghijklmnop`. The error screen in MyLocalAI also shows the exact command with your ID filled in.

   **macOS**
   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://YOUR_EXTENSION_ID"
   ```
   Then quit and reopen the Ollama app. This setting is lost when you restart your Mac. To make it permanent, open [set-ollama-cors.plist](set-ollama-cors.plist), replace `REPLACE_WITH_YOUR_EXTENSION_ID` with your ID, and run:
   ```bash
   cp set-ollama-cors.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/set-ollama-cors.plist
   ```

   **Windows** (PowerShell)
   ```powershell
   setx OLLAMA_ORIGINS "chrome-extension://YOUR_EXTENSION_ID"
   ```
   Then quit Ollama from the system tray and start it again.

   **Linux** (systemd)
   ```bash
   sudo systemctl edit ollama.service
   # add these two lines, then save:
   #   [Service]
   #   Environment="OLLAMA_ORIGINS=chrome-extension://YOUR_EXTENSION_ID"
   sudo systemctl restart ollama
   ```

   If you installed more than one edition, list all their IDs, separated by commas:
   `chrome-extension://ID_ONE,chrome-extension://ID_TWO`

4. Open MyLocalAI and click **Retry**. The header should show `Ollama · <model>`.

To switch models, open **Settings** (gear icon), type a model name you've pulled, and click **Apply & Restart Session**. The ✓ next to the model name shows whether Ollama found it, and whether it supports images or "thinking".

> Ollama models whose names end in `:cloud` run on Ollama's servers, not on your machine. MyLocalAI labels these as "cloud".

### Mixed edition

Set up **Gemini Nano**, **Ollama**, or both, using the steps above. When the panel opens, MyLocalAI tries Gemini Nano first. If Nano isn't available (for example, in Edge or Brave), it uses Ollama. The header always shows which engine is active.

### Firebase Hybrid edition (Firebase AI Logic)

**Why it exists (value proposition).** On-device AI is private, free and works offline, but it only runs on some machines: Chrome desktop with enough disk, RAM or VRAM, and a downloaded model. Without it, a local-only assistant simply stops working. This edition keeps MyLocalAI's private-by-default chat and uses **Firebase AI Logic hybrid inference** so one code path serves both cases. Gemini Nano answers on-device when Chrome can run it. When it can't, and only if you allow it, the same request goes to cloud Gemini through Firebase, protected by App Check. Everything else stays the same: page context, tab screenshots, multi-answer replies, history and saved prompts.

**How Firebase AI Logic is used.** [firebase-backend.js](firebase-backend.js) loads the bundled Firebase JS SDK ([vendor/firebase-ai.js](vendor/firebase-ai.js), built from [tools/firebase-bundle](tools/firebase-bundle)). It calls `initializeApp`, `initializeAppCheck`, `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`, then streams every answer with `generateContentStream`. The footer shows where each answer ran (`response.inferenceSource`).

**Where answers run** (Settings → *Firebase AI Logic · hybrid*):

| Setting | InferenceMode | Cloud? |
|---|---|---|
| On-device only *(default)* | `ONLY_ON_DEVICE` | Never |
| On-device first, cloud Gemini fallback | `PREFER_ON_DEVICE` | Only when on-device can't answer |
| Cloud Gemini first, on-device fallback | `PREFER_IN_CLOUD` | Yes; on-device only if the cloud call fails |

Cloud models (free tier only): **Fast**: `gemini-3.5-flash-lite` (default), **Frontier**: `gemini-4-hydrogen`.

> ☁️ **Cloud is opt-in and off by default.** With a cloud route selected, your messages, any selected page text, and any attached image or screenshot are sent to Google's Gemini Developer API through Firebase AI Logic (`firebasevertexai.googleapis.com`). On-device only never sends chat text anywhere.

**Setup**

1. Create a Firebase project, add a **Web app**, and enable **Firebase AI Logic** with the **Gemini Developer API** (free Spark plan; no billing needed for the models above).
2. Copy the example config and fill in your web app's values (Firebase console → Project settings → Your apps):
   ```bash
   cp firebase-settings.example.js firebase-settings.local.js
   ```
   `firebase-settings.local.js` is git-ignored. Never commit it.
3. Build and load `dist/mylocalai-firebase-hybrid` (steps 1–2 above):
   ```bash
   node scripts/build.mjs firebase-hybrid
   ```
4. **On-device:** use Chrome desktop 139+, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, and relaunch. If the model still needs downloading, the panel asks you to click **Retry**, because Chrome only starts the download after a click.
5. **App Check (needed for cloud answers).** Firebase AI Logic enforces App Check. A Chrome extension can't use the web attestation provider (reCAPTCHA is a remote script, which Manifest V3 forbids), so this edition uses an **App Check debug token**:
   - Leave `appCheckDebugToken: ""`, open the side panel, right-click → **Inspect**, and copy the `App Check debug token: …` line from the Console.
   - Register it in Firebase console → **Security → App Check → Apps → Manage debug tokens**.
   - Optionally paste it into `appCheckDebugToken` so it survives reinstalls. Treat it like a password: anyone holding it can use your project's App Check.

**How chat history reaches the model.** Firebase on-device inference is single-turn (each call is a fresh Chrome session). Each request therefore sends **one prompt**: the newest earlier turns, at most 10 messages and about 12,000 characters, labelled `User:` / `Assistant:`, followed by your new message. The system prompt goes in the model's own slot (on-device `initialPrompts`, cloud `systemInstruction`). The cloud route gets the same prompt, so an answer doesn't depend on which side served it. With **Responses at once** above 1, answers are generated one after another, because the SDK replaces its on-device session on every call.

---

## Using MyLocalAI

- **Chat:** type a message and press **Enter**. **Shift+Enter** adds a new line. Click ■ to stop a reply.
- **Ask about a webpage:** with the panel open, just drag to select text on the page: the text is attached to your next question and, when screenshots are on, a screenshot of the page (with your selection) goes in the message box too. Without site access, select text, right-click, and choose **Use selection as MyLocalAI context**.
- **Images:** when the model supports images, a **+** button appears. It opens a menu to upload an image or take a screenshot of the current tab. You can also paste an image or drag one onto the input box.
- **Tab screenshots:** by default, when you open MyLocalAI (or start a new chat) a screenshot of the website you're on appears in the message box, ready to send. Search result pages, the New Tab page and other browser pages are skipped; remove the screenshot with its ✕. While a screenshot is waiting in the message box, scrolling the page updates it once you stop scrolling. Change this in **Settings → Add a screenshot of the page**: *Every page* updates the screenshot as you switch tabs or open pages, *Only with +* turns automatic screenshots off. Screenshots need site access ("Read and change all your data on all websites"). The first time, an **Allow** card appears above the message box; the image never leaves your device.
- **History:** every time you open the panel it starts a new chat; the clock icon lists past chats so you can go back to one. The pencil icon starts a new chat.
- **Settings:** the gear icon lets you change the system prompt, save up to 5 prompts, and adjust temperature and top-K. Click **Apply & Restart Session** to use the new settings.
- **Reset:** Settings → **Reset All Data & Settings** deletes all chats and settings for that edition.

## Privacy

- **Gemini Nano edition:** has no network permissions at all (site access is only requested, optionally, for tab screenshots). Prompts are processed by Chrome on your device.
- **Ollama / Mixed editions:** may only connect to `localhost:11434` (your own Ollama).
- **Firebase Hybrid edition:** may only connect to `firebasevertexai.googleapis.com` (Firebase AI Logic); App Check tokens come from Google's App Check service. With the default **On-device only** route, nothing is sent: prompts are processed by Chrome on your device. If you pick a cloud route, chat text, selected page text and attached images are sent to Google's Gemini Developer API, and Google's terms for that API apply.
- Chat history is stored in the extension's local storage on your computer. Selected page text is read only when you select it (with site access granted, while the panel is open) or use the right-click menu; it stays inside the extension.

---

## For developers

The four editions share **one codebase**. The only differences between them are:

| File | What changes per edition |
|---|---|
| `config.js` | `backends`: which engines the sidebar may try (`["nano"]`, `["ollama"]`, `["nano", "ollama"]`, or `["firebase"]`) |
| `manifest.json` | Name, description, `host_permissions` (Nano edition has none), `minimum_chrome_version` |

Editions are defined in `EDITIONS` in [scripts/build.mjs](scripts/build.mjs). The root `manifest.json` and `config.js` are the Mixed edition, and the build derives the others from them. Make code changes in the root files, then rebuild. Don't edit the `dist/` folders directly (`dist/` is git-ignored).

```
├── manifest.json        base manifest (Mixed edition)
├── config.js            edition config (Mixed edition)
├── background.js        side panel + right-click menu + page-watcher registration
├── page-watch.js        reports page scroll and text selection to the panel
├── sidebar.html/.css/.js chat UI and both AI backends
├── purify.min.js        DOMPurify (sanitizes rendered Markdown)
├── marked.umd.js        marked (Markdown parser: tables, lists, code, …)
├── firebase-backend.js  Firebase AI Logic hybrid provider (firebase-hybrid edition)
├── firebase-settings.example.js  placeholder config → copy to firebase-settings.local.js (git-ignored)
├── vendor/firebase-ai.js bundled Firebase JS SDK (app, app-check, ai)
├── tools/firebase-bundle/ npm project that rebuilds vendor/firebase-ai.js
├── scripts/build.mjs    builds dist/mylocalai-{nano,ollama,mixed,firebase-hybrid}
└── tests/
    ├── regression-checks.mjs
    ├── edition-checks.mjs
    └── firebase-checks.mjs
```

Extra backends live in their own file and register in `window.MYLOCALAI_PROVIDERS`. `sidebar.js` reaches them only through its **EXTERNAL PROVIDER HOOK** section (`streamProvider`, next to `streamNano` / `streamOllama`), so the Nano and Ollama paths are unchanged. `firebase-backend.js` loads the SDK and the local config lazily, so the other editions never run Firebase code.

To update the Firebase SDK (the extension root has no `package.json`; the npm project lives in `tools/`):

```bash
cd tools/firebase-bundle && npm install && npm run build
```

To change the default Ollama model or URL, edit `DEFAULT_OLLAMA_MODEL` / `DEFAULT_OLLAMA_URL` near the top of [sidebar.js](sidebar.js). Nothing else needs to change.

Run the tests:

```bash
node tests/regression-checks.mjs
node tests/edition-checks.mjs     # also runs the build
node tests/firebase-checks.mjs    # firebase-hybrid edition; builds it too
```

After you change code, click the ↻ reload button for the extension on `chrome://extensions`, then close and reopen the side panel.
