// Backends, safety defaults, speech, idle unload and Gemini Nano.
// Part of tests/regression-checks.mjs: static checks over the source files, no browser.
import assert from "node:assert/strict";
import { functionBody, read, sidebarCss, sidebarHtml, sidebarJs } from "../helpers/sources.mjs";

const contentJs = read("content.js");
const manifestJson = JSON.parse(read("manifest.json"));
const plist = read("docs/set-ollama-cors.plist");
const purify = read("vendor/purify.min.js");

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

// chatHistory already ends with the message being sent, so it must not be added a second time.
assert.doesNotMatch(functionBody(sidebarJs, "ollamaChatMessages"), /content:\s*text\b/,
  "ollamaChatMessages must not append the current user prompt after chatHistory already includes it");

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
assert.match(sidebarJs, /\nloadPreferredVoice\(\);/, "voices should be loaded at startup");
assert.match(
  functionBody(sidebarJs, "copyResponse"),
  /navigator\.clipboard\.writeText/,
  "Copy button should write to the clipboard"
);
assert.ok(manifestJson.permissions.includes("tts"), "manifest needs the tts permission for chrome.tts");
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
  functionBody(sidebarJs, "sendMessageNow"),
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
assert.match(functionBody(sidebarJs, "resetNanoChat"), /!nanoBaseSession \|\| nanoBaseSystemPrompt !== getSystemPrompt\(\)\)\s*\{\s*await initNanoSession\(\)/,
  "resetNanoChat should do a full init when no base exists, or when a memory changed the system prompt");
// After an idle unload, New chat / loading a chat must not pull the model back into RAM:
// nothing would restart the idle timer, so the model would stay loaded forever.
assert.match(
  functionBody(sidebarJs, "resetNanoChat"),
  /if \(isModelUnloaded\) return;[\s\S]*initNanoSession\(\)/,
  "resetNanoChat must leave an idle-unloaded model unloaded (the next send reloads it)"
);
// Every early return from sendMessageNow() runs inside sendMessage's finally, which restarts the idle timer.
assert.match(functionBody(sidebarJs, "sendMessage"), /try \{\s*await sendMessageNow\(text\);\s*\} finally \{[\s\S]*scheduleIdleUnload\(\)/,
  "every way out of a send should restart the idle timer");
assert.doesNotMatch(functionBody(sidebarJs, "makeRoomInNano"), /startNewChat\(\)/,
  "a full Nano context is trimmed in the same chat, not continued as a new one");
assert.match(functionBody(sidebarJs, "makeRoomInNano"), /resetNanoChat\(\)[\s\S]*restoreNanoContext\(chatHistory, promptTokens\)/,
  "a full Nano context gets a fresh session with the newest turns that leave room for the prompt");
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
assert.match(showResponseError, /AbortError[\s\S]*streamedText\.get\(bubble\)[\s\S]*stopped: true/, "a stopped answer should keep its streamed text");
assert.equal(/one time only/i.test(read("README.md")), false, "README should not promise a one-time Nano download");

// History: the delete-chat icon is parsed as XML, so it only renders with the SVG namespace.
const renderHistoryList = functionBody(sidebarJs, "renderHistoryList");
assert.match(renderHistoryList, /"image\/svg\+xml"/, "the delete-chat icon should still be parsed as SVG");
assert.match(renderHistoryList, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
  "the delete-chat icon needs xmlns, or the trash button is invisible");
assert.match(renderHistoryList, /delBtn\.setAttribute\("aria-label", "Delete chat"\)/, "the icon-only delete button needs an accessible name");

// History: deleting a chat has no undo, so the trash button asks first (deleteConversation itself stays dialog-free).
assert.match(renderHistoryList, /if \(!confirmDeleteChat\(title, memoriesFromChat\(s\.id\)\.length\)\) return;\s*deleteConversation\(s\.id\)/,
  "the trash button should confirm before deleting a chat");
assert.match(functionBody(sidebarJs, "confirmDeleteChat"), /confirm\(/, "confirmDeleteChat should ask the user");
assert.equal(/confirm\(/.test(functionBody(sidebarJs, "deleteConversation")), false,
  "deleteConversation must not open a dialog; callers confirm first");
assert.match(functionBody(sidebarJs, "deleteConversation"), /deleteMemoriesFromChat\(id\)/,
  "deleting a chat forgets the memories learned in it");

// History: past chats open from the keyboard too, not only with a mouse click.
assert.match(renderHistoryList, /contentDiv\.setAttribute\("role", "button"\)/, "a history row should be announced as a button");
assert.match(renderHistoryList, /contentDiv\.tabIndex = 0/, "a history row should be reachable with Tab");
assert.match(renderHistoryList, /addEventListener\("keydown"[\s\S]*"Enter"[\s\S]*" "[\s\S]*openChat\(\)/,
  "Enter and Space should open a history row");
assert.match(sidebarCss, /\.history-item-content:focus-visible/, "a focused history row should be visible");
