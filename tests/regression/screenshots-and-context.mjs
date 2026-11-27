// Attach menu, tab screenshots, page watcher, history titles and the context card.
// Part of tests/regression-checks.mjs: static checks over the source files, no browser.
import assert from "node:assert/strict";
import { functionBody, read, sidebarCss, sidebarHtml, sidebarJs } from "../helpers/sources.mjs";

const manifestJson = JSON.parse(read("manifest.json"));
const setupEventListeners = functionBody(sidebarJs, "setupEventListeners");

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
  // Nano, Ollama and the external provider (firebase-hybrid) each show it once ready.
  assert.equal((initBody.match(/refreshAutoScreenshot\("open"\)/g) || []).length, 3, "every backend should show the screenshot once ready");
  assert.match(functionBody(sidebarJs, "startNewChat"), /refreshAutoScreenshot\("open"\)/, "a new chat should show the current page");

  const auto = functionBody(sidebarJs, "refreshAutoScreenshot");
  assert.match(auto, /mode === "manual"[\s\S]*canAttachImages\(\)/, "manual mode and non-vision models skip auto screenshots");
  assert.match(auto, /trigger === "tab-change" && !followsTabChanges\(mode\)\) return/, "tab changes go through followsTabChanges");
  assert.match(functionBody(sidebarJs, "followsTabChanges"), /mode === "follow" \|\| \(mode === "open" && chatHistory\.length === 0\)/,
    "open mode should follow tab switches until the first prompt is sent");
  assert.match(auto, /isWebsiteWorthCapturing\(tab\.url\)\) \{[\s\S]*trigger === "tab-change" && attachedImageIsAuto\) clearAttachedImage\(\)/,
    "switching to a search/browser page before the first prompt should drop the stale screenshot");
  assert.match(auto, /attachedImages\.length && !attachedImageIsAuto\) return/, "an image the user chose must never be replaced");
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
  assert.match(functionBody(sidebarJs, "hasAutoScreenshotPending"), /attachedImages\.length > 0 && attachedImageIsAuto/, "a user's own image is never 'pending auto'");
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
  assert.match(functionBody(sidebarJs, "showImagePreview"), /imagePreviewText\.title = label/, "the screenshot title shows in full on hover");
}
