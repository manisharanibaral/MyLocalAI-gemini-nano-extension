// The attach menu and automatic tab screenshots.
"use strict";

// ===================== ATTACH MENU & TAB SCREENSHOTS =====================
// The + button only offers image options, so it is hidden when the model has no vision.
function setAttachAvailable(available) {
  attachWrap.classList.toggle("hidden", !available);
  if (!available) {
    closeAttachMenu();
    clearAttachedImage();
  }
}

function toggleAttachMenu() {
  const open = attachMenu.classList.toggle("hidden") === false;
  btnAttach.setAttribute("aria-expanded", String(open));
  if (open) attachMenu.querySelector(".attach-menu-item")?.focus();
}

function closeAttachMenu() {
  attachMenu.classList.add("hidden");
  btnAttach.setAttribute("aria-expanded", "false");
}

function getTabScreenshotMode() {
  return tabScreenshotSelect.value || DEFAULT_TAB_SCREENSHOT_MODE;
}

// chrome.permissions.request only works during a user gesture, so callers must reach it
// straight from a click/keydown handler, before awaiting anything else.
function requestTabAccess() {
  if (!chrome.permissions?.request) return Promise.resolve(false);
  return chrome.permissions.request(TAB_ACCESS).catch(() => false);
}

function hasTabAccess() {
  if (!chrome.permissions?.contains) return Promise.resolve(false);
  return chrome.permissions.contains(TAB_ACCESS).catch(() => false);
}

async function getActiveTab() {
  // In the side panel, "currentWindow" is the window the panel is docked in.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// Search engines live at their root or under /search; other pages on the same domain
// (Gmail, Docs, Maps…) are real content and are still captured.
const SEARCH_ENGINE_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|search\.brave|startpage)\.[a-z.]+$/i;

function isSearchOrHomePage(url) {
  if (!SEARCH_ENGINE_HOST.test(url.hostname)) return false;
  return url.pathname === "/" || /^\/(search|webhp|web)\b/.test(url.pathname);
}

// Auto mode only captures real websites: browser pages (new tab, settings, home) are
// not http(s), and search result pages add noise rather than context.
function isWebsiteWorthCapturing(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch (_) { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !isSearchOrHomePage(url);
}

async function attachTabScreenshot(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
  const label = tab.title ? `Screenshot · ${tab.title}` : "Screenshot of this tab";
  await attachImageDataUrl(dataUrl, MAX_SCREENSHOT_SIDE, label);
}

// Puts a screenshot of the current tab in the prompt bar without being asked.
//   trigger "open":       panel opened, backend (re)started or New chat (open + follow modes)
//   trigger "tab-change": user switched tab or a page finished loading
//                         (follow mode, or open mode before the first prompt)
//   trigger "scroll":     user stopped scrolling; only refreshes a screenshot already waiting
//                         in the prompt bar, so removing or sending it stops the updates
//   trigger "selection":  user selected text on the page; an explicit action, so it also
//                         works after the first prompt
// Failures are silent: an automatic screenshot is a convenience, never an error.
async function refreshAutoScreenshot(trigger) {
  const mode = getTabScreenshotMode();
  if (mode === "manual" || !canAttachImages()) return;
  // A full-page capture scrolls the page itself and owns the prompt bar until it finishes.
  if (pageCapture) return;
  if (trigger === "tab-change" && !followsTabChanges(mode)) return;
  if (trigger === "scroll" && !hasAutoScreenshotPending()) return;
  // Never replace an image the user chose themselves.
  if (attachedImages.length && !attachedImageIsAuto) return;
  if (!(await hasTabAccess())) {
    showScreenshotAccessCard();
    return;
  }
  hideScreenshotAccessCard();

  const tab = await getActiveTab().catch(() => null);
  // Opening/New chat always captures; tab events skip a page that was already captured
  // (e.g. a reload), which also respects the user removing that page's screenshot.
  if (!tab?.url || (trigger === "tab-change" && tab.url === lastAutoScreenshotUrl)) return;
  lastAutoScreenshotUrl = tab.url;
  if (mode === "open" && !isWebsiteWorthCapturing(tab.url)) {
    // Switched to a search/browser page before the first prompt: the previous page's
    // screenshot no longer matches what the user is looking at.
    if (trigger === "tab-change" && attachedImageIsAuto) clearAttachedImage();
    return;
  }
  try {
    await attachTabScreenshot(tab);
    attachedImageIsAuto = true;
  } catch (err) {
    // Protected page (New Tab, Web Store…): drop the previous page's screenshot so the
    // prompt bar doesn't show a page the user has left.
    if (attachedImageIsAuto) clearAttachedImage();
    console.warn("[MyLocalAI] Auto screenshot skipped:", err.message || err);
  }
}

// "On open" means the screenshot shows the page the chat starts from, so until the
// first prompt is sent a tab switch still updates it; after that it stays put.
function followsTabChanges(mode) {
  return mode === "follow" || (mode === "open" && chatHistory.length === 0);
}

function hasAutoScreenshotPending() {
  return attachedImages.length > 0 && attachedImageIsAuto;
}

// captureVisibleTab is limited to ~2 calls per second, and one navigation fires several
// tab events, so tab changes are coalesced into one capture after things settle.
let tabChangeTimer = null;
function scheduleTabChangeScreenshot() {
  clearTimeout(tabChangeTimer);
  tabChangeTimer = setTimeout(() => refreshAutoScreenshot("tab-change"), TAB_CHANGE_SETTLE_MS);
}

// Follows tab switches and page loads in the window this panel belongs to.
async function watchTabsForScreenshots() {
  if (!chrome.tabs?.onActivated || !chrome.windows?.getCurrent) return;
  panelWindowId = (await chrome.windows.getCurrent()).id;
  watchActiveTab();
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId !== panelWindowId) return;
    ensurePageWatcher(tabId);
    scheduleTabChangeScreenshot();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active && tab.windowId === panelWindowId) {
      scheduleTabChangeScreenshot();
    }
  });
}

// ----- Page watcher: scroll + text selection inside the tab -----
// page-watch.js reports scrolling and selections. background.js registers it for pages
// loaded after site access was granted; tabs that were already open get it injected here.
let panelWindowId = null;

function ensurePageWatcher(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) return;
  // Fails on protected pages or without site access; the watcher is optional, so stay quiet.
  chrome.scripting.executeScript({ target: { tabId }, files: ["page-watch.js"] }).catch(() => { });
}

function watchActiveTab() {
  getActiveTab().then(tab => ensurePageWatcher(tab?.id)).catch(() => { });
}

// Only the visible tab of this panel's window counts; other windows have their own panel.
function isFromWatchedTab(sender) {
  return Boolean(sender?.tab?.active) && sender.tab.windowId === panelWindowId;
}

// Dragging over text replaces the right-click menu: the text becomes context and the
// page (with the selection highlighted) goes into the prompt bar.
function onPageTextSelected(text) {
  setContextFromSelection(text);
  refreshAutoScreenshot("selection");
}

// Scroll events are already debounced in the page, so this only has to respect the
// capture rate limit shared with tab changes.
function onPageMessage(message, sender) {
  if (!isFromWatchedTab(sender)) return;
  if (message.type === "PAGE_TEXT_SELECTED") onPageTextSelected(message.text);
  if (message.type === "PAGE_SCROLL_SETTLED") refreshAutoScreenshot("scroll");
}
