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
node scripts/build.mjs --zip         # also make dist/mylocalai-<edition>.zip (e.g. for the Chrome Web Store; never includes firebase-settings.local.js)
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
   Then quit and reopen the Ollama app. This setting is lost when you restart your Mac. To make it permanent, open [set-ollama-cors.plist](docs/set-ollama-cors.plist), replace `REPLACE_WITH_YOUR_EXTENSION_ID` with your ID, and run:
   ```bash
   cp docs/set-ollama-cors.plist ~/Library/LaunchAgents/
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

**How chat history reaches Ollama.** Each request sets Ollama's context window to 8,192 tokens (`num_ctx`) and sends the system prompt, the newest earlier turns that fit after room is kept for the reply, and your new message. Images go only with the message they were attached to; later turns mention them ("2 images were shown earlier") instead of uploading them again. **Settings → Thinking** (on by default; turn it off for faster replies) lets models that can reason first, such as DeepSeek-R1, QwQ or Gemma 4, do so; it applies from the next message. The footer shows the tokens Ollama read and wrote for the last reply.

> Ollama models whose names end in `:cloud` run on Ollama's servers, not on your machine. MyLocalAI labels these as "cloud".

### Mixed edition

Set up **Gemini Nano**, **Ollama**, or both, using the steps above. When the panel opens, MyLocalAI tries Gemini Nano first. If Nano isn't available (for example, in Edge or Brave), it uses Ollama. The header always shows which engine is active.

### Firebase Hybrid edition (Firebase AI Logic)

**Why it exists (value proposition).** People ask an AI about what they are reading: an email, a contract, a medical letter, an internal page at work. Pasting that into a cloud chatbot means handing it over. On-device AI is private, free and works offline, but it only runs on some machines (Chrome desktop with enough disk, RAM or VRAM, and a downloaded model) and Gemini Nano only holds about 9,000 tokens, so a local-only assistant stops working on long documents or on the wrong laptop. This edition gives you a **private-by-default side-panel assistant that you never have to leave**: Gemini Nano answers on your device, and when it can't — the model isn't on this machine, or the document is too long for it — the same request goes to cloud Gemini through **Firebase AI Logic hybrid inference**, *only if you allowed it*, and every answer says where it ran. Everything else stays the same: page context, tab and whole-page screenshots, memory, multi-answer replies, history and saved prompts.

**Who it is for.** Anyone who reads on the web and wants help without uploading what they read by default: students with study material, professionals with confidential pages, people on locked-down or low-end machines where Nano can't run.

**What is hybrid about it** (all Firebase AI Logic, all in [providers/](providers)):

| Feature | How | File |
|---|---|---|
| One request path for Nano and cloud Gemini | `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })` + `generateContentStream` | [firebase-backend.js](providers/firebase-backend.js) |
| **Long documents go to the cloud, short chats stay local** | Before each request the prompt is measured against Nano's 9,216-token window. On *On-device first*, a prompt that won't fit is sent `ONLY_IN_CLOUD` instead of overflowing on the device (the SDK only checks that Nano exists). On *On-device only*, it is never sent and the panel explains why. | [firebase-routing.js](providers/firebase-routing.js) |
| **Every answer says where it ran** | A chip under each answer: ⚡ *On-device · Gemini Nano* or ☁️ *Cloud · model* (and why), from `inferenceSource` | [firebase-routing.js](providers/firebase-routing.js), [response-actions.js](sidebar/ui/response-actions.js) |
| **Hybrid structured output** for the memory tool and chat compaction | One JSON schema, sent as `onDeviceParams.promptOptions.responseConstraint` (Nano) and `inCloudParams.generationConfig.responseSchema` (cloud), called with `generateContent` | [firebase-backend.js](providers/firebase-backend.js) |
| **Remote Config** for cloud model names | `getRemoteConfig` → `fetchAndActivate` → `getValue`, so a retired model is swapped from the console without a release; only stable Gemini text models are accepted | [firebase-remote-config.js](providers/firebase-remote-config.js) |
| **App Check** (enforced by Firebase AI Logic) | `initializeAppCheck` with a registered debug token, since reCAPTCHA can't load in an MV3 extension | [firebase-backend.js](providers/firebase-backend.js) |
| Model download from a click, cloud meanwhile | `initializeDeviceModel()` on a user gesture; with cloud allowed, answers come from the cloud until Nano is ready | [firebase-backend.js](providers/firebase-backend.js) |

**How Firebase AI Logic is used.** [providers/firebase-backend.js](providers/firebase-backend.js) loads the bundled Firebase JS SDK ([vendor/firebase-ai.js](vendor/firebase-ai.js), built from [tools/firebase-bundle](tools/firebase-bundle)). It calls `initializeApp`, `initializeAppCheck`, `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`, then streams every answer with `generateContentStream` and asks for JSON with `generateContent`. [providers/firebase-remote-config.js](providers/firebase-remote-config.js) calls `getRemoteConfig`, `fetchAndActivate` and `getValue`.

**First launch: you choose.** The first time the panel opens it asks, before Firebase is even loaded:

- **🔒 Private only (Nano)**: *Cloud & internet* off, *On-device only*. Nothing leaves the device.
- **☁️ Hybrid (Nano, then cloud if needed)**: *Cloud & internet* on, *On-device first, cloud Gemini fallback*. It works on machines without Gemini Nano and on documents too long for it.

The click also counts as the gesture Chrome needs to start a Gemini Nano download. Either choice can be changed any time in Settings; *Reset all data & settings* asks again. Panels that already had a saved route or switch are not asked.

**Where answers run** (Settings → *Firebase AI Logic · hybrid*):

| Setting | InferenceMode | Cloud? |
|---|---|---|
| On-device only *(default; "Private only")* | `ONLY_ON_DEVICE` | Never |
| On-device first, cloud Gemini fallback *("Hybrid")* | `PREFER_ON_DEVICE` (`ONLY_IN_CLOUD` for a message too long for Nano) | Only when on-device can't answer, or the message is too long for it |
| Cloud Gemini first, on-device fallback | `PREFER_IN_CLOUD` | Yes; on-device only if the cloud call fails |

**Cloud & internet switch.** The first control in that card turns every Firebase cloud feature off in one click. While it is off, every answer runs on-device (`ONLY_ON_DEVICE`) whatever route you picked, cloud models disappear from the model pill, and the panel makes no network request at all. It takes effect at once and keeps your open chat; turning it back on restores the route you had chosen.

Cloud models (free tier only): **Fast**: `gemini-3.5-flash-lite` (default), **Frontier**: `gemini-4-hydrogen`. Remote Config can rename them (setup step 6).

> ☁️ **Cloud is opt-in.** It is off unless you pick *Hybrid* on first launch or a cloud route in Settings. With a cloud route selected, your messages, any selected page text, and any attached image or screenshot are sent to Google's Gemini Developer API through Firebase AI Logic (`firebasevertexai.googleapis.com`). On-device only never sends chat text anywhere.

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
   - Optionally paste it into `appCheckDebugToken` so it survives reinstalls. Treat it like a password: anyone holding it can use your project's App Check. `--zip` never packs `firebase-settings.local.js`, so a zip you share or upload carries neither the token nor your config.
6. **Remote Config (optional).** In Firebase console → **Remote Config** (Client), add string parameters `cloud_model_fast` and/or `cloud_model_frontier` with a stable Gemini model name (e.g. `gemini-3.5-flash-lite`) and publish. Or import [docs/remoteconfig.template.json](docs/remoteconfig.template.json) (⋮ → **Publish from a file**), which sets both to the built-in free-tier names. Don't pick a model the models page marks *billing required* on the free Spark plan: cloud answers would fail. The panel reads them when a cloud route is in use and then listens for changes (real-time Remote Config), so a publish reaches an open panel within seconds; it keeps the built-in names when a parameter is unset, the fetch fails, or the name isn't a stable Gemini text model (preview, experimental, `-latest`, image, speech and Live models are refused). If your API key is restricted, allow the Firebase Remote Config, Remote Config Realtime and Firebase Installations APIs too.
7. **Check the setup without a browser:** `node scripts/firebase-diagnose.mjs` calls App Check (with your `appCheckDebugToken`), Installations, Remote Config and its real-time stream with the values in `firebase-settings.local.js`, and prints each status (secrets redacted). An App Check `403` means the debug token isn't registered for this app ID. On **Cloud first**, such a failure makes the SDK answer on-device instead; the answer's chip then reads **cloud failed**.

**How chat history reaches the model.** Firebase on-device inference is single-turn (each call is a fresh Chrome session). Each request therefore sends **one prompt**: the newest earlier turns, at most 20 messages and about 12,000 characters, labelled `User:` / `Assistant:`, followed by your new message. The system prompt goes in the model's own slot (on-device `initialPrompts`, cloud `systemInstruction`). The cloud route gets the same prompt, so an answer doesn't depend on which side served it. With **Responses at once** above 1, answers are generated one after another, because the SDK replaces its on-device session on every call.

---

### #BuildHybridAI 2026

This project was started and built during the submission period (first commit 2026-11-22). The Firebase Hybrid edition, its tests, and everything in the table above were written for the hackathon. Platform: **Web (Chrome extension)**. Rules digest: [docs/HACKATHON_RULES.md](docs/HACKATHON_RULES.md). Licence: [LICENSE](LICENSE).

---

## Using MyLocalAI

- **Chat:** type a message and press **Enter**. **Shift+Enter** adds a new line. Click ■ to stop a reply.
- **Ask about a webpage:** with the panel open, just drag to select text on the page: the text is attached to your next question and, when screenshots are on, a screenshot of the page (with your selection) goes in the message box too. Without site access, select text, right-click, and choose **Use selection as MyLocalAI context**.
- **Switch models:** the pill next to the send button names the model that is answering. Click it to switch without leaving the chat. Mixed and Ollama editions list your installed Ollama models (and Gemini Nano in Mixed); the Firebase Hybrid edition offers Gemini Nano on-device or one of the cloud models (marked ☁️, because picking one sends your messages to Google). Your chat stays; on a switch *to* Gemini Nano the chat's recent text is given back to it, and a note says if some of it didn't fit. The pill is hidden in the Nano edition, which has one model, and is locked while an answer is streaming.
- **Images:** when the model supports images, a **+** button appears. It opens a menu to upload an image, take a screenshot of the current tab, or screenshot the whole page. You can also paste an image or drag one onto the input box.
- **Screenshot whole page:** one tall picture of a long page would be shrunk until its text is unreadable, so MyLocalAI scrolls the page and attaches one image per screen, in order (up to 8; the label says when a longer page was cut off). While it runs, the page gets a glowing border with a *Capturing…* label (neither appears in the pictures). Stay on the tab until it finishes. **Stop & save** ends it early and keeps the images taken so far; the ✕ cancels and keeps nothing. Pinned headers appear only in the first image, and your scroll position is restored. Many images need more model memory: if Gemini Nano says the message is too long, shorten it or send fewer images; with Ollama, a small context window can make the model ignore some images, so raise its context length.
- **Review attached images:** click a thumbnail above the message box to see it full size (◀ ▶ arrow keys move between images, Esc closes). Remove one with the ✕ on its thumbnail or **Remove** in the preview; the model is told which parts of the page are still attached.
- **Tab screenshots:** by default, when you open MyLocalAI (or start a new chat) a screenshot of the website you're on appears in the message box, ready to send. Search result pages, the New Tab page and other browser pages are skipped; remove the screenshot with its ✕. While a screenshot is waiting in the message box, scrolling the page updates it once you stop scrolling. Change this in **Settings → Add a screenshot of the page**: *Every page* updates the screenshot as you switch tabs or open pages, *Only with +* turns automatic screenshots off. Screenshots need site access ("Read and change all your data on all websites"). The first time, an **Allow** card appears above the message box; the image never leaves your device.
- **Memory:** the bulb icon opens what MyLocalAI remembers about you, as cards with a date, title and description. Add, edit (click a card) or delete (✕) them; the system prompt includes them so answers fit you better. With **Learn about me** on, after a reply the model may save, update or forget **one** fact from what you *typed* (never from selected text, pages or screenshots); a 🧠 note in the chat says what changed. Deleting a chat also forgets the memories learned in it (the delete dialog says how many); memories you added yourself stay. Memory holds at most 80 memories or 6,000 characters, so it fits in Gemini Nano's small context; when it is full MyLocalAI asks you to delete some. Passwords, card and ID numbers are never saved. With Gemini Nano, a change is used from your next chat.
- **Selected text in your message:** text you send as context is quoted above your question in the chat (long selections collapse to a few lines; **Show all** expands them), including when you reopen the chat from History.
- **History:** every time you open the panel it starts a new chat; the clock icon lists past chats so you can go back to one. The pencil icon starts a new chat.
- **Settings:** the gear icon lets you change the system prompt, save up to 5 prompts (pick one and use the bin icon to delete it), and adjust temperature and top-K. Click **Apply & Restart Session** to use the new settings: a new or picked system prompt is used by every model only after that, and the restart continues in a new chat while the old one stays in History. **Responses at once** and the screenshot setting take effect right away and save only themselves.
- **Reset:** Settings → **Reset All Data & Settings** deletes all chats and settings for that edition.

## Privacy

- **Gemini Nano edition:** has no network permissions at all (site access is only requested, optionally, for tab screenshots). Prompts are processed by Chrome on your device.
- **Ollama / Mixed editions:** may only connect to `localhost:11434` (your own Ollama).
- **Firebase Hybrid edition:** may only connect to `firebasevertexai.googleapis.com` (Firebase AI Logic), `firebaseremoteconfig.googleapis.com` and `firebaseinstallations.googleapis.com` (Remote Config, only on a cloud route; it sends no chat text); App Check tokens come from Google's App Check service. With the default **On-device only** route, nothing is sent: prompts are processed by Chrome on your device, and a message too long for Gemini Nano is not sent anywhere. If you pick a cloud route, chat text, selected page text and attached images are sent to Google's Gemini Developer API, and Google's terms for that API apply.
- Opening the panel never contacts the internet: fonts, scripts and styles are all shipped inside the extension (the panel uses your system font).
- Chat history and memories are stored in the extension's local storage on your computer. Selected page text is read only when you select it (with site access granted, while the panel is open) or use the right-click menu; it stays inside the extension.

---

## For developers

The four editions share **one codebase**. The only differences between them are:

| File | What changes per edition |
|---|---|
| `config.js` | `backends`: which engines the sidebar may try (`["nano"]`, `["ollama"]`, `["nano", "ollama"]`, or `["firebase"]`) |
| `manifest.json` | Name, description, `host_permissions` (Nano edition has none), `minimum_chrome_version` |

Editions are defined in `EDITIONS` in [scripts/build.mjs](scripts/build.mjs). The root `manifest.json` and `config.js` are the Mixed edition, and the build derives the others from them. Make code changes in the root files, then rebuild. Don't edit the `dist/` folders directly (`dist/` is git-ignored).

```
├── manifest.json, config.js   base manifest and edition config (Mixed edition)
├── sidebar.html               the panel page; its <script> list is the load order
├── background.js              side panel + right-click menu + page-watcher registration
├── page-watch.js              reports page scroll and text selection to the panel
├── firebase-settings.example.js  placeholder config → copy to firebase-settings.local.js (git-ignored)
├── sidebar/                   the side-panel app
│   ├── core/                  DOM refs, edition config, shared state, settings, browser detection
│   ├── backends/              Gemini Nano, Ollama, provider hook, load/unload
│   ├── chat/                  sending, history, saved chats
│   ├── ui/                    messages, rendering, status overlay, model switching
│   ├── attachments/           images and screenshots
│   ├── events.js              DOM event wiring
│   └── main.js                startup (loaded last)
├── features/                  self-contained modules: model switcher pill, full-page capture and its glow
├── providers/                 firebase-hybrid edition: backend (SDK calls), settings (routes, cloud models),
│                              routing (long input → cloud, answer chips, schemas), remote-config, prompt builder
├── styles/                    the panel's CSS, linked in cascade order
├── vendor/                    third-party: DOMPurify, marked, bundled Firebase JS SDK
├── docs/                      hackathon rules, macOS Ollama CORS launch agent
├── tools/firebase-bundle/     npm project that rebuilds vendor/firebase-ai.js
├── scripts/build.mjs          builds dist/mylocalai-{nano,ollama,mixed,firebase-hybrid}
└── tests/                     *-checks.mjs are the entry points; regression/ and helpers/ support them
```

The files in `sidebar/` are plain scripts (no bundler) that share one global scope: a top-level name must be unique across them, and only `main.js` starts work at load time. To add a file, create it and add its `<script>` tag to `sidebar.html`; keep each file under 500 lines.

Extra backends live in `providers/` and register in `window.MYLOCALAI_PROVIDERS`. The sidebar reaches them only through [sidebar/backends/provider-hook.js](sidebar/backends/provider-hook.js) (`streamProvider`), so the Nano and Ollama paths are unchanged. The Firebase provider loads the SDK and the local config lazily, so the other editions never run Firebase code.

To update the Firebase SDK (the extension root has no `package.json`; the npm project lives in `tools/`):

```bash
cd tools/firebase-bundle && npm install && npm run build
```

To change the default Ollama model or URL, edit `DEFAULT_OLLAMA_MODEL` / `DEFAULT_OLLAMA_URL` in [sidebar/core/config.js](sidebar/core/config.js). Nothing else needs to change.

Run the tests:

```bash
node tests/regression-checks.mjs
node tests/edition-checks.mjs     # also runs the build
node tests/firebase-checks.mjs    # firebase-hybrid edition; builds it too
node tests/full-page-checks.mjs   # full-page screenshot, stop & save, image preview/removal, multi-image messages
node tests/structure-checks.mjs   # file sizes, load list, and a boot of the panel against fakes
```

After you change code, click the ↻ reload button for the extension on `chrome://extensions`, then close and reopen the side panel.
