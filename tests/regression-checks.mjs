import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const sidebarJs = read("sidebar.js");
const contentJs = read("content.js");
const manifestJson = JSON.parse(read("manifest.json"));
const sidebarHtml = read("sidebar.html");
const plist = read("set-ollama-cors.plist");
const purify = read("purify.min.js");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart + 1, i);
  }
  throw new Error(`Could not parse body for ${name}`);
}

const initOllamaSession = functionBody(sidebarJs, "initOllamaSession");
assert.equal(
  /chatHistory\s*=\s*\[\]/.test(initOllamaSession),
  false,
  "initOllamaSession must not clear restored chat history"
);

const setupEventListeners = functionBody(sidebarJs, "setupEventListeners");
assert.match(
  sidebarJs,
  /let\s+listenersInitialized\s*=\s*false/,
  "sidebar state should include a listenersInitialized guard"
);
assert.match(
  setupEventListeners,
  /if\s*\(\s*listenersInitialized\s*\)\s*return/,
  "setupEventListeners should return early after first registration"
);

const ollamaPromptStreaming = functionBody(sidebarJs, "ollamaPromptStreaming");
assert.equal(
  /\.\.\.chatHistory\.map[\s\S]*\{\s*role:\s*"user",\s*content:\s*text/.test(ollamaPromptStreaming),
  false,
  "ollamaPromptStreaming must not append the current user prompt after chatHistory already includes it"
);

const initNanoSession = functionBody(sidebarJs, "initNanoSession");
assert.match(
  initNanoSession,
  /expectedInputs:\s*\[[\s\S]*\{\s*type:\s*"image",\s*languages:\s*\["en"\]\s*\}/,
  "Gemini Nano should request image input support when available"
);
assert.match(
  initNanoSession,
  /outputLanguage:\s*"en"/,
  "Gemini Nano legacy API requests should specify an output language"
);
assert.match(
  initNanoSession,
  /\{\s*type:\s*"image",\s*languages:\s*\["en"\]\s*\}/,
  "Gemini Nano image input should declare the expected image language"
);

const streamNano = functionBody(sidebarJs, "streamNano");
assert.match(
  streamNano,
  /type:\s*"image"[\s\S]*base64ToImageBlob/,
  "Gemini Nano image prompts should use the Prompt API multimodal image part"
);

// Nano stretches non-square images to a square; the image must be letterboxed first.
assert.match(
  streamNano,
  /type:\s*"image",\s*value:\s*await padImageToSquare\(/,
  "Gemini Nano image prompts should pad the image to a square before sending"
);
{
  const padImage = functionBody(sidebarJs, "padImageToSquare");
  assert.match(padImage, /Math\.max\(width,\s*height\)/, "padded canvas should be as large as the longer side");
  assert.match(padImage, /fillRect\(0,\s*0,\s*side,\s*side\)/, "padding should be filled, not left transparent/black in JPEG");
  assert.match(padImage, /\(side - width\) \/ 2[\s\S]*\(side - height\) \/ 2/, "image should be centred, not stretched");
  assert.equal(/drawImage\([^)]*side,\s*side\)/.test(padImage), false, "image must not be drawn scaled to the square");
  assert.match(padImage, /resolve\(blob \|\| imageBlob\)/, "padding failure should fall back to the original image");
}
assert.equal(
  /padImageToSquare/.test(functionBody(sidebarJs, "processImage")),
  false,
  "the attachment preview and saved history should keep the unpadded image"
);

assert.match(
  setupEventListeners,
  /addEventListener\("paste"[\s\S]*processImage/,
  "image attachment should support paste from the clipboard"
);

assert.equal(
  contentJs.includes("selectionchange"),
  false,
  "content script should not send selected text automatically on every selectionchange"
);
assert.match(
  contentJs,
  /GET_SELECTED_TEXT/,
  "content script should expose selected text only when explicitly requested"
);
assert.equal(
  (manifestJson.content_scripts || []).some((script) => script.matches.includes("<all_urls>")),
  false,
  "manifest should avoid automatic content-script injection into every URL"
);

assert.equal(
  sidebarHtml.includes("nemotron-3-super:cloud"),
  false,
  "default Ollama model should not be a cloud model"
);
assert.equal(
  sidebarJs.includes('OLLAMA_ORIGINS "*"'),
  false,
  "runtime CORS guidance should not recommend wildcard origins"
);
assert.equal(
  plist.includes("ilkfkklfhnghddibnclfafkgjacibeeg"),
  false,
  "plist should not hardcode a single extension ID"
);

assert.match(
  purify,
  /DOMPurify 3\.4\.0/,
  "DOMPurify should be updated to the fixed 3.4.0 build"
);

// Response actions: copy + hear buttons, revealed only after streaming ends.
assert.match(
  functionBody(sidebarJs, "appendMessage"),
  /createResponseActions\(bubble, !streaming\)/,
  "AI messages should get copy/hear actions, hidden while streaming"
);
assert.match(
  functionBody(sidebarJs, "finalizeMessage"),
  /msg-actions[\s\S]*classList\.remove\("hidden"\)/,
  "finalizeMessage should reveal the response actions"
);
assert.match(
  functionBody(sidebarJs, "toggleSpeech"),
  /chrome\.tts\.speak/,
  "Hear button should use chrome.tts"
);
// Speech quality: explicit natural voice + markdown stripped before speaking.
assert.match(
  functionBody(sidebarJs, "toggleSpeech"),
  /voiceName:\s*preferredVoiceName[\s\S]*cleanTextForSpeech|cleanTextForSpeech[\s\S]*voiceName:\s*preferredVoiceName/,
  "Hear button should pass a chosen voice and cleaned text"
);
assert.match(functionBody(sidebarJs, "scoreVoice"), /natural[\s\S]*google/i, "voice picker should favour natural/Google voices");
assert.match(functionBody(sidebarJs, "cleanTextForSpeech"), /https\?/, "speech text should replace URLs");
assert.match(sidebarJs, /\n  loadPreferredVoice\(\);/, "voices should be loaded at startup");
assert.match(
  functionBody(sidebarJs, "copyResponse"),
  /navigator\.clipboard\.writeText/,
  "Copy button should write to the clipboard"
);
assert.ok(manifestJson.permissions.includes("tts"), "manifest needs the tts permission for chrome.tts");
const sidebarCss = read("sidebar.css");
assert.match(sidebarCss, /\.msg\.user \.msg-label\s*\{[^}]*align-self:\s*flex-end/, "You label should align over the prompt");
assert.match(sidebarCss, /\.msg\.ai\s*\{\s*margin-bottom/, "AI responses should have bottom margin");

// Idle unload: the model must be released when idle and brought back on the next send.
assert.match(sidebarHtml, /<select id="idle-unload"/, "settings should offer an idle-unload dropdown");
assert.match(sidebarHtml, /<select id="idle-unload"[\s\S]*?<option value="0">Never \(default\)/, "idle-unload dropdown should offer Never (keep the model loaded) as default");
assert.match(sidebarJs, /const DEFAULT_IDLE_UNLOAD_MINUTES = 0;/, "keeping the model loaded (value 0) should be the default idle-unload choice");
assert.match(functionBody(sidebarJs, "saveSettings"), /idleUnloadMinutes/, "idle-unload choice should be saved");
assert.match(functionBody(sidebarJs, "loadSettings"), /idleUnloadMinutes/, "idle-unload choice should be restored");
assert.match(functionBody(sidebarJs, "scheduleIdleUnload"), /delayMs\s*===\s*0/, "choosing Never should not schedule an unload");
const unloadModel = functionBody(sidebarJs, "unloadModel");
assert.match(unloadModel, /isGenerating[\s\S]*return/, "unloadModel must never run during generation");
assert.match(unloadModel, /destroySession\(\)/, "unloadModel should destroy the Nano session");
assert.match(unloadModel, /unloadOllamaModel\(\)/, "unloadModel should evict the Ollama model");
assert.match(
  functionBody(sidebarJs, "unloadOllamaModel"),
  /keep_alive:\s*0/,
  "Ollama unload should send keep_alive: 0"
);
assert.match(
  functionBody(sidebarJs, "ensureModelLoaded"),
  /initNanoSession\(\)/,
  "ensureModelLoaded should recreate the Nano session"
);
assert.match(
  functionBody(sidebarJs, "sendMessage"),
  /await ensureModelLoaded\(\)/,
  "sendMessage should reload an unloaded model before prompting"
);
assert.match(
  initNanoSession,
  /isModelUnloaded\s*=\s*false/,
  "creating a Nano session should clear the unloaded flag (avoids double init)"
);
assert.match(
  functionBody(sidebarJs, "sendMessage").slice(-400),
  /scheduleIdleUnload\(\)/,
  "idle timer should restart after each response"
);

// Chrome built-in AI guidance: base session + clone() per chat, re-downloads, overflow, purge.
const currentInitNano = functionBody(sidebarJs, "initNanoSession");
assert.match(currentInitNano, /nanoBaseSession\s*=\s*created/, "initNanoSession should keep the created session as the base");
assert.match(currentInitNano, /cloneNanoBaseSession\(\)/, "the chat session should be a clone of the base session");
assert.match(currentInitNano, /destroyNanoSessions\(\)[\s\S]*lm\.create/, "initNanoSession should destroy old sessions before creating new ones");
assert.match(functionBody(sidebarJs, "cloneNanoBaseSession"), /\.clone\(\)/, "chats should use session.clone()");
assert.match(functionBody(sidebarJs, "cloneNanoBaseSession"), /watchNanoContextOverflow/, "every chat clone should watch for context overflow");
assert.match(functionBody(sidebarJs, "startNewChat"), /resetNanoChat\(\)/, "New chat should clone the base session instead of recreating it");
assert.equal(/initNanoSession/.test(functionBody(sidebarJs, "startNewChat")), false, "New chat should not reload the model");
{
  // Every panel open starts a fresh chat; saved chats are only reachable from History.
  const initBody = functionBody(sidebarJs, "init");
  assert.equal(/loadConversation\(/.test(initBody), false, "opening the panel must not reload the last chat");
  assert.match(sidebarJs, /let currentSessionId = Date\.now\(\)\.toString\(\);/, "the startup chat needs its own new id");
  assert.equal(/id: currentSessionId,\s*title: extractTitle\(oldHistory\)/.test(functionBody(sidebarJs, "loadSessions")), false,
    "migrated history must not share the startup chat's id");
}
assert.match(functionBody(sidebarJs, "loadConversation"), /resetNanoChat\(\)/, "loading a saved chat should reset Nano's context via a clone");
assert.match(functionBody(sidebarJs, "resetNanoChat"), /!nanoBaseSession\)\s*\{\s*await initNanoSession\(\)/, "resetNanoChat should fall back to a full init when no base exists");
// After an idle unload, New chat / loading a chat must not pull the model back into RAM:
// nothing would restart the idle timer, so the model would stay loaded forever.
assert.match(
  functionBody(sidebarJs, "resetNanoChat"),
  /if \(isModelUnloaded\) return;[\s\S]*initNanoSession\(\)/,
  "resetNanoChat must leave an idle-unloaded model unloaded (the next send reloads it)"
);
// Every early return from sendMessage after ensureModelLoaded() must restart the idle timer.
{
  const sendBody = functionBody(sidebarJs, "sendMessage");
  const contextLimitBranch = sendBody.slice(sendBody.indexOf("Session reset. Please re-send"), sendBody.indexOf("// Show UI"));
  assert.match(contextLimitBranch, /scheduleIdleUnload\(\)[\s\S]*return;/, "context-limit reset should restart the idle timer before returning");
}
assert.match(functionBody(sidebarJs, "destroyNanoSessions"), /nanoBaseSession/, "destroyNanoSessions must also destroy the base session");
assert.match(functionBody(sidebarJs, "destroySession"), /destroyNanoSessions\(\)/, "idle unload/restart should release the base session too");
assert.match(functionBody(sidebarJs, "watchNanoContextOverflow"), /"contextoverflow"/, "Nano context overflow should be surfaced");
assert.match(functionBody(sidebarJs, "updateTokenInfo"), /nanoContextTrimmed/, "token info should say when old turns were dropped");

// Download progress: loaded is a 0–1 fraction, and 1 means "preparing", not "done".
const downloadStatus = functionBody(sidebarJs, "nanoDownloadStatus");
assert.match(downloadStatus, /fraction\s*>=\s*1[\s\S]*Preparing/, "a finished download should show a preparing step");
assert.equal(/hideStatus/.test(downloadStatus), false, "download progress must not hide the overlay before create() resolves");
assert.equal(/one-time/i.test(functionBody(sidebarJs, "nanoDownloadExplanation")), false, "download copy must not promise a one-time download");
assert.match(currentInitNano, /avail === "downloadable"[\s\S]*nanoDownloadExplanation\(\)/, "a gesture-started download should show the download status");

// Device limits and error handling.
assert.match(functionBody(sidebarJs, "applyNanoParamLimits"), /lm\.params\(\)[\s\S]*maxTopK[\s\S]*maxTemperature/, "slider limits should come from LanguageModel.params()");
assert.match(functionBody(sidebarJs, "applyNanoParamLimits"), /const limits = await lm\.params\(\);\s*if \(!limits\) return;/,
  "params() can resolve to null; it must not be destructured directly");
assert.match(currentInitNano, /applyNanoParamLimits\(lm\)/, "initNanoSession should apply the device's param limits");
assert.match(functionBody(sidebarJs, "describeNanoPromptError"), /QuotaExceededError/, "an over-long prompt should get a readable error");
assert.match(functionBody(sidebarJs, "recoverIfNanoModelRemoved"), /isModelUnloaded\s*=\s*true/, "a purged model should be re-initialised on the next send");
// Per-answer errors are rendered by showResponseError (one reply can hold several answers).
const showResponseError = functionBody(sidebarJs, "showResponseError");
assert.match(showResponseError, /recoverIfNanoModelRemoved\(\)/, "failed Nano prompts should check whether Chrome removed the model");
assert.match(showResponseError, /describeNanoPromptError\(err\)/, "failed Nano prompts should use the readable error");
assert.match(showResponseError, /AbortError[\s\S]*Generation stopped/, "a stopped answer should keep its streamed text");
assert.equal(/one time only/i.test(read("README.md")), false, "README should not promise a one-time Nano download");

// ===== Responses at once (1–5 parallel answers) =====
assert.match(sidebarJs, /const DEFAULT_RESPONSE_COUNT = 1;/, "one answer per message should be the default");
assert.match(sidebarJs, /const MAX_RESPONSE_COUNT = 5;/, "at most five answers at once");
{
  const radios = [...sidebarHtml.matchAll(/<input type="radio" name="response-count" value="(\d)"/g)].map(m => m[1]);
  assert.deepEqual(radios, ["1", "2", "3", "4", "5"], "settings should offer 1–5 responses at once");
  assert.match(sidebarHtml, /name="response-count" value="1" checked/, "the HTML default should be 1");
}
{
  const clamp = functionBody(sidebarJs, "clampResponseCount");
  assert.match(clamp, /Math\.min\(MAX_RESPONSE_COUNT,\s*Math\.max\(1,/, "saved counts must be clamped to 1–5");
  assert.match(clamp, /return DEFAULT_RESPONSE_COUNT/, "a missing/garbage count should fall back to the default");
}
assert.match(functionBody(sidebarJs, "saveSettings"), /responseCount/, "responses-at-once should be saved");
assert.match(functionBody(sidebarJs, "loadSettings"), /responseCount[\s\S]*setResponseCount/, "responses-at-once should be restored");
{
  const sendBody = functionBody(sidebarJs, "sendMessage");
  assert.match(sendBody, /Promise\.allSettled\(group\.bubbles\.map/, "answers should stream in parallel, one failure must not cancel the rest");
  assert.match(sendBody, /createNanoVariantSessions\(getResponseCount\(\)\)/, "Nano answers need one session each");
  assert.match(sendBody, /streamNano\(finalPrompt, bubble, imageToSend, nanoSessions\[i\]\)/, "each Nano answer should use its own session");
  assert.match(sendBody, /recordResponses\(group, results\)/, "the reply should be stored once, after all answers settle");
}
assert.equal(/chatHistory\.push/.test(streamNano), false, "streamNano must not push history itself (recordResponses does)");
assert.equal(/chatHistory\.push/.test(functionBody(sidebarJs, "streamOllama")), false, "streamOllama must not push history itself");
assert.match(streamNano, /chatSession\.promptStreaming/, "streamNano should prompt the session it was given");
{
  const record = functionBody(sidebarJs, "recordResponses");
  assert.match(record, /findIndex\(v => !v\.failed\)/, "the chat should continue from the first successful answer");
  assert.match(record, /if \(selected === -1\) return;/, "a reply with no usable answer must not be stored");
  assert.match(record, /variants\.length > 1[\s\S]*entry\.variants = variants/, "single-answer replies keep the old history shape");
  assert.match(record, /adoptNanoVariant\(selected\)/, "Nano should continue from the selected answer's session");
}
{
  const createVariants = functionBody(sidebarJs, "createNanoVariantSessions");
  assert.match(createVariants, /releaseNanoVariantSessions\(\)/, "old answer sessions must be freed before cloning new ones");
  assert.match(createVariants, /session\.clone\(\)[\s\S]*watchNanoContextOverflow/, "extra answers should be clones of the chat session");
  assert.match(createVariants, /catch[\s\S]*break;/, "a failed clone should yield fewer answers, not a failed reply");
}
assert.match(functionBody(sidebarJs, "releaseNanoVariantSessions"), /s === session\) continue/, "releasing answers must keep the adopted chat session");
assert.match(functionBody(sidebarJs, "destroyNanoSessions"), /releaseNanoVariantSessions\(\)/, "destroying Nano must free answer sessions too");
assert.match(functionBody(sidebarJs, "resetNanoChat"), /releaseNanoVariantSessions\(\)/, "New chat must free answer sessions");
{
  const bind = functionBody(sidebarJs, "bindVariantSelection");
  assert.match(bind, /variant\.failed[\s\S]*return/, "a failed answer can be viewed but not selected");
  assert.match(bind, /entry\.content = variant\.content/, "switching answers should change what history keeps");
  assert.match(bind, /chatHistory\[chatHistory\.length - 1\][\s\S]*adoptNanoVariant/, "only the latest reply may switch Nano's session");
}
assert.match(ollamaPromptStreaming, /const \{ variants, selected, \.\.\.message \} = m;/, "unused answers must not be sent to Ollama");
assert.match(functionBody(sidebarJs, "loadConversation"), /variants\?\.length > 1[\s\S]*appendSavedResponseGroup/, "saved multi-answer replies should restore with tabs");
{
  const group = functionBody(sidebarJs, "appendResponseGroup");
  assert.match(group, /count <= 1\) return singleResponseGroup\(appendMessage\("ai", "", true\)\)/, "one answer should render exactly like before");
  assert.match(group, /pane\.append\(bubble, createResponseActions\(bubble, false\)\)/, "each answer needs its own copy/hear actions inside its pane");
  assert.match(group, /setAttribute\("role", "tab"\)/, "answer tabs should be accessible tabs");
}
assert.match(sidebarCss, /\.variant-tab\.active\s*\{/, "the selected answer tab should be styled");
assert.match(sidebarCss, /\.segmented input:checked \+ span/, "the selected count should be highlighted");

// Attach menu + tab screenshots.
assert.match(sidebarHtml, /id="btn-attach"[\s\S]*<line x1="12" y1="5" x2="12" y2="19">/, "the attach button should be a plus icon");
assert.match(sidebarHtml, /id="attach-menu"[\s\S]*id="btn-upload-img"[\s\S]*id="btn-screenshot-tab"/, "the plus menu should offer upload and tab screenshot");
assert.match(sidebarHtml, /id="tab-screenshot-mode"[\s\S]*value="open">On open \(default\)[\s\S]*value="follow">Every page<[\s\S]*value="manual">Only with \+/,
  "settings should offer the three screenshot modes with plain names");
assert.match(sidebarJs, /DEFAULT_TAB_SCREENSHOT_MODE = "open"/, "screenshot on open is the default");
assert.deepEqual(manifestJson.optional_host_permissions, ["<all_urls>"], "screenshot site access must stay optional, not an install-time permission");
assert.equal(manifestJson.permissions.includes("tabs"), false, "host access already exposes the tab URL; no tabs permission needed");
assert.match(functionBody(sidebarJs, "loadSettings"), /tabScreenshotMode/, "the screenshot mode should be restored");
assert.match(functionBody(sidebarJs, "saveSettings"), /tabScreenshotMode/, "the screenshot mode should be saved");
{
  // The screenshot is shown in the prompt bar ahead of time, not added silently at send.
  assert.equal(/autoAttachTabScreenshot|sendFromUser/.test(sidebarJs), false, "send-time auto screenshots were replaced by the prompt-bar preview");
  const initBody = functionBody(sidebarJs, "init");
  assert.equal((initBody.match(/refreshAutoScreenshot\("open"\)/g) || []).length, 2, "both backends should show the screenshot once ready");
  assert.match(functionBody(sidebarJs, "startNewChat"), /refreshAutoScreenshot\("open"\)/, "a new chat should show the current page");

  const auto = functionBody(sidebarJs, "refreshAutoScreenshot");
  assert.match(auto, /mode === "manual"[\s\S]*canAttachImages\(\)/, "manual mode and non-vision models skip auto screenshots");
  assert.match(auto, /trigger === "tab-change" && !followsTabChanges\(mode\)\) return/, "tab changes go through followsTabChanges");
  assert.match(functionBody(sidebarJs, "followsTabChanges"), /mode === "follow" \|\| \(mode === "open" && chatHistory\.length === 0\)/,
    "open mode should follow tab switches until the first prompt is sent");
  assert.match(auto, /isWebsiteWorthCapturing\(tab\.url\)\) \{[\s\S]*trigger === "tab-change" && attachedImageIsAuto\) clearAttachedImage\(\)/,
    "switching to a search/browser page before the first prompt should drop the stale screenshot");
  assert.match(auto, /currentAttachedImage && !attachedImageIsAuto\) return/, "an image the user chose must never be replaced");
  assert.match(auto, /hasTabAccess\(\)\)\) \{\s*showScreenshotAccessCard\(\)/, "missing access should offer the Allow card");
  assert.match(auto, /mode === "open" && !isWebsiteWorthCapturing\(tab\.url\)/, "open mode skips search and browser pages");
  assert.match(auto, /trigger === "tab-change" && tab\.url === lastAutoScreenshotUrl/, "a reload of the same page should not re-add it");
  assert.match(auto, /catch \(err\) \{[\s\S]*if \(attachedImageIsAuto\) clearAttachedImage\(\)/, "a protected page should drop the stale screenshot");

  const watch = functionBody(sidebarJs, "watchTabsForScreenshots");
  assert.match(watch, /onActivated[\s\S]*windowId === panelWindowId/, "tab switches are followed only in the panel's window");
  assert.match(watch, /onUpdated[\s\S]*changeInfo\.status === "complete" && tab\.active/, "page loads in the active tab are followed");
  assert.match(functionBody(sidebarJs, "scheduleTabChangeScreenshot"), /clearTimeout\(tabChangeTimer\)/, "tab events must be debounced (capture rate limit)");
  assert.match(setupEventListeners, /watchTabsForScreenshots\(\)/, "tab watching should start with the listeners");

  // permissions.request needs the click's gesture, so it has to be the first await.
  assert.match(functionBody(sidebarJs, "screenshotTabFromMenu"), /^\s*closeAttachMenu\(\);\s*const granted = await requestTabAccess\(\);/,
    "the menu screenshot must request access before awaiting anything else");
  assert.match(functionBody(sidebarJs, "allowScreenshotsFromCard"), /^\s*const granted = await requestTabAccess\(\);/, "Allow must request on its click");
  assert.match(functionBody(sidebarJs, "onTabScreenshotModeChange"), /saveSettings\(\);[\s\S]*const granted = await requestTabAccess\(\);/,
    "choosing an automatic mode should ask for access");
  assert.match(sidebarHtml, /id="screenshot-access-card"[\s\S]*id="btn-allow-screenshots"[\s\S]*id="btn-dismiss-screenshot-access"/, "the access card needs Allow and dismiss");
  assert.match(functionBody(sidebarJs, "clearAttachedImage"), /attachedImageIsAuto = false/, "clearing should reset the auto flag");
  assert.match(functionBody(sidebarJs, "attachTabScreenshot"), /captureVisibleTab\(tab\.windowId/, "screenshots should capture the panel's window");
  assert.match(functionBody(sidebarJs, "setAttachAvailable"), /attachWrap\.classList\.toggle\("hidden", !available\)/, "the + button hides without vision");
}
{
  // Page watcher: refresh the screenshot after scrolling, and drag-select adds text + screenshot.
  const pageWatchJs = read("page-watch.js");
  const backgroundJs = read("background.js");
  const buildJs = read("scripts/build.mjs");
  assert.match(buildJs, /"page-watch\.js"/, "page-watch.js must be in SHARED_FILES so it ships");
  assert.ok(manifestJson.permissions.includes("scripting"), "registering/injecting the page watcher needs the scripting permission");
  assert.equal("content_scripts" in manifestJson, false, "a static content script would make site access an install-time permission");

  assert.match(pageWatchJs, /if \(window\.__myLocalAiPageWatch\) return;/, "the watcher must not run twice in one page");
  assert.match(functionBody(pageWatchJs, "onScroll"), /clearTimeout\(scrollTimer\)[\s\S]*SCROLL_SETTLE_MS/, "scrolling must wait until the user stops");
  assert.match(pageWatchJs, /addEventListener\("scroll", onScroll, SCROLL_OPTIONS\)/, "scroll is watched");
  assert.match(pageWatchJs, /SCROLL_OPTIONS = \{ capture: true, passive: true \}/, "scroll inside page panels counts and never blocks scrolling");
  assert.match(pageWatchJs, /addEventListener\("mouseup", onPointerUp, true\)/, "drag-selection is detected on mouse release");
  const report = functionBody(pageWatchJs, "reportSelection");
  assert.match(report, /if \(!text\) \{\s*lastSentSelection = "";\s*return;/, "a click that clears the selection keeps the context");
  assert.match(report, /text === lastSentSelection\) return/, "the same selection is not re-sent on every click");
  assert.match(functionBody(pageWatchJs, "notifyExtension"), /catch \(_\) \{\s*stopWatching\(\)/, "an orphaned script (extension reloaded) should stop quietly");

  const sync = functionBody(backgroundJs, "syncPageWatchScript");
  assert.match(sync, /permissions\.contains\(TAB_ACCESS\)/, "the watcher is registered only with site access");
  assert.match(sync, /registerContentScripts\([\s\S]*js: \["page-watch\.js"\][\s\S]*persistAcrossSessions: true/, "the watcher registration persists");
  assert.match(sync, /!granted && registered\.length > 0[\s\S]*unregisterContentScripts/, "revoking access removes the watcher");
  for (const event of ["runtime.onInstalled", "runtime.onStartup", "permissions.onAdded", "permissions.onRemoved"]) {
    assert.ok(backgroundJs.includes(`chrome.${event}.addListener(syncPageWatchScript)`), `${event} should resync the watcher`);
  }

  const auto = functionBody(sidebarJs, "refreshAutoScreenshot");
  assert.match(auto, /trigger === "scroll" && !hasAutoScreenshotPending\(\)\) return/, "scroll only refreshes a screenshot still in the prompt bar");
  assert.match(functionBody(sidebarJs, "hasAutoScreenshotPending"), /currentAttachedImage\) && attachedImageIsAuto/, "a user's own image is never 'pending auto'");
  const onPage = functionBody(sidebarJs, "onPageMessage");
  assert.match(onPage, /if \(!isFromWatchedTab\(sender\)\) return;/, "only the active tab of this panel's window counts");
  assert.match(onPage, /PAGE_TEXT_SELECTED[\s\S]*onPageTextSelected\(message\.text\)/, "selections are handled");
  assert.match(onPage, /PAGE_SCROLL_SETTLED[\s\S]*refreshAutoScreenshot\("scroll"\)/, "settled scrolls refresh the screenshot");
  assert.match(functionBody(sidebarJs, "onPageTextSelected"), /setContextFromSelection\(text\);\s*refreshAutoScreenshot\("selection"\)/,
    "a selection adds the text and a screenshot without the right-click menu");
  assert.match(functionBody(sidebarJs, "isFromWatchedTab"), /sender\?\.tab\?\.active[\s\S]*windowId === panelWindowId/, "other windows' tabs are ignored");
  assert.match(functionBody(sidebarJs, "ensurePageWatcher"), /executeScript\(\{ target: \{ tabId \}, files: \["page-watch\.js"\] \}\)\.catch/,
    "already-open tabs get the watcher injected, failing quietly on protected pages");
  const watch = functionBody(sidebarJs, "watchTabsForScreenshots");
  assert.match(watch, /panelWindowId = \(await chrome\.windows\.getCurrent\(\)\)\.id;\s*watchActiveTab\(\)/, "the open tab is watched when the panel starts");
  assert.match(watch, /onActivated[\s\S]*ensurePageWatcher\(tabId\)/, "switched-to tabs get the watcher");
  assert.match(functionBody(sidebarJs, "allowScreenshotsFromCard"), /watchActiveTab\(\)/, "granting access starts watching the open tab");
  assert.match(functionBody(sidebarJs, "onTabScreenshotModeChange"), /if \(granted\) \{\s*watchActiveTab\(\)/, "granting access starts watching the open tab");
}
{
  // Run the URL filter for real: it decides which pages get auto screenshots.
  const hostRegex = sidebarJs.match(/const SEARCH_ENGINE_HOST = (\/.+\/i);/)[1];
  const isWorth = new Function("rawUrl", `
    const SEARCH_ENGINE_HOST = ${hostRegex};
    function isSearchOrHomePage(url) {${functionBody(sidebarJs, "isSearchOrHomePage")}}
    ${functionBody(sidebarJs, "isWebsiteWorthCapturing")}`);
  const capture = ["https://example.com/article", "https://docs.google.com/document/d/1", "https://mail.google.com/mail/u/0", "http://localhost:3000/"];
  const skip = ["https://www.google.com/", "https://www.google.co.in/search?q=x", "https://www.bing.com/search?q=x",
    "https://duckduckgo.com/?q=x", "https://search.brave.com/search?q=x", "chrome://newtab/", "chrome-search://local-ntp/",
    "about:blank", "edge://settings", "not a url"];
  for (const url of capture) assert.equal(isWorth(url), true, `auto mode should capture ${url}`);
  for (const url of skip) assert.equal(isWorth(url), false, `auto mode should skip ${url}`);
}
{
  // History titles must never show the base64 of an attached image.
  const extractTitle = new Function("history", functionBody(sidebarJs, "extractTitle"));
  assert.equal(extractTitle([{ role: "user", content: "summarise__IMG__/9j/4AAQSkZJRgABAQ" }]), "summarise");
  assert.equal(
    extractTitle([{ role: "user", content: 'Context:\n"""\nx\n"""\n\nUser Question:\nwhat is this__IMG__/9j/4AAQ' }]),
    "what is this"
  );
  assert.match(functionBody(sidebarJs, "renderHistoryList"), /extractTitle\(s\.history\)/, "old saved titles should be recomputed");
}
assert.match(sidebarCss, /\.attach-menu\s*\{[^}]*bottom: calc\(100% \+ 8px\)/, "the attach menu should open above the input");
{
  // The context card shows as much of the selection as the panel width allows.
  const setCtx = functionBody(sidebarJs, "setContextFromSelection");
  assert.equal(/words\.slice\(0, 3\)/.test(setCtx), false, "the selection preview must not be cut to three words");
  assert.match(setCtx, /contextPreview\(trimmed\)[\s\S]*contextTextEl\.title = trimmed/, "the card shows the preview and hovers the full text");
  const preview = new Function("text", `const CONTEXT_PREVIEW_MAX_CHARS = 500;${functionBody(sidebarJs, "contextPreview")}`);
  assert.equal(preview("This app is\n\n great for   buying"), '"This app is great for buying"', "whitespace is flattened, all words kept");
  const long = preview("x".repeat(2000));
  assert.ok(long.length < 510 && long.endsWith('…"'), "very long selections are cut for the preview only");
  assert.match(sidebarCss, /#context-text,\s*\.img-preview-text\s*\{[^}]*white-space: normal[^}]*display: -webkit-box/, "previews wrap to the panel width");
  assert.match(sidebarCss, /#context-text \{ -webkit-line-clamp: 3;/, "the selection preview clamps at three lines");
  assert.match(sidebarCss, /\.img-preview-text \{ -webkit-line-clamp: 2;/, "the screenshot title clamps at two lines");
  assert.match(functionBody(sidebarJs, "attachImageDataUrl"), /imagePreviewText\.title = label/, "the screenshot title shows in full on hover");
}

// ===== Settings layout (grouped cards + pinned actions) =====
{
  const panel = sidebarHtml.match(/<div id="settings-panel"[\s\S]*?<!-- HISTORY PANEL -->/)[0];
  const cards = [...panel.matchAll(/<section[^>]*class="settings-card"/g)];
  assert.equal(cards.length, 4, "settings should be grouped into four cards");
  assert.match(panel, /<section id="ollama-settings" class="settings-card"/, "the Ollama card must keep the id applyEditionUI hides");
  assert.match(panel, /id="ollama-settings-label"/, "applyEditionUI renames the Ollama card title by this id");
  // Apply/Reset live outside the scrolling body so they stay reachable.
  const scrollEnd = panel.indexOf('<div class="settings-actions">');
  assert.ok(scrollEnd > 0, "settings should have a pinned actions footer");
  assert.match(panel.slice(scrollEnd), /id="btn-apply-settings"[\s\S]*id="btn-reset-all"/, "Apply and Reset belong in the footer");
  for (const id of ["saved-prompts", "sys-prompt", "temp-slider", "temp-value", "topk-slider", "topk-value",
    "idle-unload", "tab-screenshot-mode", "ollama-model", "ollama-url"]) {
    assert.ok(panel.slice(0, scrollEnd).includes(`id="${id}"`), `settings body should still contain #${id}`);
  }
  assert.match(sidebarCss, /#settings-panel\s*\{[^}]*max-height/, "the settings panel should cap its height");
  assert.match(sidebarCss, /\.settings-scroll\s*\{[^}]*overflow-y: auto/, "the settings body should scroll");
  assert.match(sidebarJs, /modelStatusSpan\.className = "settings-status"/, "the Ollama model status should be styled by class");
  // Idle-unload and screenshot dropdowns share one two-column row; the hint sits below it.
  assert.match(panel, /<div class="settings-row">\s*<div class="settings-group flex-1">\s*<label[^>]*for="idle-unload"[\s\S]*?<div class="settings-group flex-1">\s*<label[^>]*for="tab-screenshot-mode"/,
    "idle-unload and tab screenshot should sit side by side");
  assert.match(sidebarCss, /\.settings-row > \.settings-group\s*\{[^}]*justify-content: flex-end/, "column controls should align at the bottom");
}

console.log("Regression checks passed");
