# MyLocalAI

A private AI chat in your browser's side panel. Everything runs on your own machine: no accounts, no API keys, and nothing is sent to the cloud.

MyLocalAI comes in **three editions**. Pick the one that matches your browser and setup:

| Edition | AI engine | Browsers | Extra software | Best for |
|---|---|---|---|---|
| **Gemini Nano** | Chrome's built-in Gemini Nano | Google Chrome 138+ (desktop) | None | Chrome users who want zero setup |
| **Ollama** | Any model you run in [Ollama](https://ollama.com) | Chrome, Edge, Brave, Opera, Vivaldi, Arc… | Ollama | Non-Chrome browsers, or picking your own model (Llama, Qwen, Gemma, DeepSeek…) |
| **Mixed** | Gemini Nano, falls back to Ollama | Any Chromium browser | Optional | People who want it to work everywhere |

All three have the same features: streaming chat, saved chat history, saved system prompts, temperature/top-K settings, Markdown, code blocks with copy buttons, and image input when the model supports it. You can also right-click selected text on any page and choose **"Use selection as MyLocalAI context"**.

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
└── mylocalai-mixed/    ← Nano first, Ollama fallback
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

---

## Using MyLocalAI

- **Chat:** type a message and press **Enter**. **Shift+Enter** adds a new line. Click ■ to stop a reply.
- **Ask about a webpage:** select text on any page, right-click, and choose **Use selection as MyLocalAI context**. The text is attached to your next question.
- **Images:** when the model supports images, an image button appears. You can upload a file, paste an image, or drag one onto the input box.
- **History:** the clock icon lists past chats. The pencil icon starts a new chat.
- **Settings:** the gear icon lets you change the system prompt, save up to 5 prompts, and adjust temperature and top-K. Click **Apply & Restart Session** to use the new settings.
- **Reset:** Settings → **Reset All Data & Settings** deletes all chats and settings for that edition.

## Privacy

- **Gemini Nano edition:** has no network permissions at all. Prompts are processed by Chrome on your device.
- **Ollama / Mixed editions:** may only connect to `localhost:11434` (your own Ollama).
- Chat history is stored in the extension's local storage on your computer. Selected page text is read only when you use the right-click menu.

---

## For developers

The three editions share **one codebase**. The only differences between them are:

| File | What changes per edition |
|---|---|
| `config.js` | `backends`: which engines the sidebar may try (`["nano"]`, `["ollama"]`, or `["nano", "ollama"]`) |
| `manifest.json` | Name, description, `host_permissions` (Nano edition has none), `minimum_chrome_version` |

Editions are defined in `EDITIONS` in [scripts/build.mjs](scripts/build.mjs). The root `manifest.json` and `config.js` are the Mixed edition, and the build derives the others from them. Make code changes in the root files, then rebuild. Don't edit the `dist/` folders directly (`dist/` is git-ignored).

```
├── manifest.json        base manifest (Mixed edition)
├── config.js            edition config (Mixed edition)
├── background.js        side panel + right-click menu
├── sidebar.html/.css/.js chat UI and both AI backends
├── purify.min.js        DOMPurify (sanitizes rendered Markdown)
├── marked.umd.js        marked (Markdown parser: tables, lists, code, …)
├── scripts/build.mjs    builds dist/mylocalai-{nano,ollama,mixed}
└── tests/
    ├── regression-checks.mjs
    └── edition-checks.mjs
```

To change the default Ollama model or URL, edit `DEFAULT_OLLAMA_MODEL` / `DEFAULT_OLLAMA_URL` near the top of [sidebar.js](sidebar.js). Nothing else needs to change.

Run the tests:

```bash
node tests/regression-checks.mjs
node tests/edition-checks.mjs     # also runs the build
```

After you change code, click the ↻ reload button for the extension on `chrome://extensions`, then close and reopen the side panel.
