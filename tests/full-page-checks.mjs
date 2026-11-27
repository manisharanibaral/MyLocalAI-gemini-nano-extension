// Checks for "Screenshot whole page" and for sending several images in one message.
// Unlike the static checks, these execute code: full-page-capture.js runs against a fake page and
// a fake chrome API, and selected sidebar/ functions run with stubbed surroundings.
// Nothing here renders a real page or talks to a real model.
import assert from "node:assert/strict";
import vm from "node:vm";
import { SHARED_FILES } from "../scripts/build.mjs";
import { functionSource, read, scriptPaths, sidebarHtml, sidebarJs, sidebarPaths } from "./helpers/sources.mjs";

const captureJs = read("features/full-page-capture.js");
// Values built inside a vm belong to another realm; copy them before deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));

// ===================== FAKE PAGE =====================
class FakeStyle {
  constructor(element) { this.element = element; }
  setProperty(name, value, priority) {
    const previous = this.element.attrs.style ?? "";
    this.element.attrs.style = `${previous}${name}: ${value}${priority ? ` !${priority}` : ""};`;
  }
}

class FakeElement {
  constructor({ position = "static", overflowY = "visible", clientHeight = 0, clientWidth = 1000, scrollHeight = clientHeight, children = [], style } = {}) {
    Object.assign(this, { clientHeight, clientWidth, scrollHeight, children });
    this.computed = { position, overflowY };
    this.attrs = style === undefined ? {} : { style };
    this.style = new FakeStyle(this);
    this.top = 0;
    this.maxTop = Math.max(0, scrollHeight - clientHeight);
  }
  get scrollTop() { return this.top; }
  set scrollTop(value) { this.top = Math.min(this.maxTop, Math.max(0, value)); } // browsers clamp
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
}

// A tab: the injected functions are re-created from their source in the page's own realm,
// exactly like chrome.scripting does, so they fail here if they depend on the module.
function createBrowser({ viewHeight = 800, root, elements = [], onCapture } = {}) {
  const page = vm.createContext({
    window: { innerHeight: viewHeight },
    document: { scrollingElement: root, querySelectorAll: () => [root, ...elements] },
    getComputedStyle: (el) => el.computed,
    setTimeout: (done) => setImmediate(done),
  });
  const browser = { page, root, activeTabId: 7, captures: [], log: [] };
  const chrome = {
    scripting: {
      async executeScript({ target, func, args }) {
        assert.equal(target.tabId, 7, "scripts go into the captured tab");
        browser.log.push(func.name);
        const result = await vm.runInContext(`(${func})(...${JSON.stringify(args)})`, page);
        return [{ result }];
      },
    },
    tabs: {
      async query() { return [{ id: browser.activeTabId }]; },
      async captureVisibleTab(windowId) {
        assert.equal(windowId, 3, "the panel's window is captured");
        browser.captures.push(snapshot(browser, elements));
        await onCapture?.(browser);
        return `data:image/jpeg;base64,part${browser.captures.length}`;
      },
    },
  };
  const sandbox = vm.createContext({ window: {}, chrome, DOMException, setTimeout: (done) => setImmediate(done) });
  vm.runInContext(captureJs, sandbox);
  browser.api = sandbox.window.MyLocalAIFullPage;
  browser.tab = { id: 7, windowId: 3 };
  return browser;
}

function snapshot(browser, elements) {
  const scroller = browser.page.window.__myLocalAiFullPage.scroller;
  return { top: scroller.scrollTop, styles: elements.map((el) => el.getAttribute("style")) };
}

const scrollingRoot = (scrollHeight, clientHeight = 800) => new FakeElement({ clientHeight, scrollHeight });

// ===================== SCROLL PLAN =====================
{
  const { planScrollPositions: plan, MAX_PAGE_PARTS } = createBrowser({ root: scrollingRoot(800) }).api;
  assert.equal(MAX_PAGE_PARTS, 8);
  assert.deepEqual(plain(plan(800, 800)), { positions: [0], totalParts: 1 }, "a page that fits needs one image");
  assert.deepEqual(plain(plan(500, 800)), { positions: [0], totalParts: 1 }, "a short page never scrolls");
  assert.deepEqual(plain(plan(2000, 800)).positions, [0, 740, 1200], "parts overlap and the last ends at the bottom");
  assert.deepEqual(plain(plan(1540, 800)).positions, [0, 740], "no extra image when the second part reaches the bottom");
  for (const [height, view] of [[801, 800], [5000, 700], [3333, 123], [900, 2]]) {
    const { positions } = plan(height, view);
    if (positions.length === MAX_PAGE_PARTS) continue;
    assert.equal(positions.at(-1) + view, height, `the bottom of a ${height}px page is covered`);
    positions.slice(1).forEach((top, i) => assert.ok(top <= positions[i] + view, `no gap in a ${height}px page`));
  }
  const long = plan(50000, 800);
  assert.equal(long.positions.length, MAX_PAGE_PARTS, "very long pages are cut off");
  assert.ok(long.totalParts > MAX_PAGE_PARTS, "…and the caller can tell");
  assert.equal(long.positions[0], 0, "the cut keeps the top of the page");
}

// ===================== CAPTURE =====================
{
  // Whole page: one image per screen, pinned elements handled, page put back as it was.
  const root = scrollingRoot(2000);
  root.top = 321;
  const header = new FakeElement({ position: "fixed", style: "color: red;" });
  const toolbar = new FakeElement({ position: "sticky" });
  const text = new FakeElement();
  const browser = createBrowser({ root, elements: [header, toolbar, text] });
  const progress = [];
  const result = await browser.api.capture({ tab: browser.tab, onProgress: (part, count) => progress.push([part, count]) });

  assert.deepEqual(plain(result), {
    images: [1, 2, 3].map((n) => `data:image/jpeg;base64,part${n}`), totalParts: 3,
  });
  assert.deepEqual(browser.captures.map((c) => c.top), [0, 740, 1200], "captured top to bottom");
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(browser.captures[0].styles, ["color: red;", null, null], "the first image keeps pinned headers");
  assert.match(browser.captures[1].styles[0], /opacity: 0 !important/, "fixed elements don't repeat");
  assert.match(browser.captures[1].styles[1], /position: relative !important;top: auto !important/, "sticky elements return to their place");
  assert.equal(browser.captures[2].styles[2], null, "ordinary elements are untouched");
  assert.equal(root.scrollTop, 321, "the scroll position is restored");
  assert.equal(header.getAttribute("style"), "color: red;", "original inline styles come back");
  assert.equal(toolbar.getAttribute("style"), null);
  assert.equal(root.getAttribute("style"), null, "the scroll-behavior override is removed");
  assert.equal(browser.page.window.__myLocalAiFullPage, undefined, "no state is left in the page");
}
{
  // Web apps that scroll an inner pane; a fixed shell around that pane must stay visible.
  const root = scrollingRoot(800);
  const pane = new FakeElement({ overflowY: "auto", clientHeight: 600, scrollHeight: 1500 });
  const smallPane = new FakeElement({ overflowY: "auto", clientHeight: 450, clientWidth: 200, scrollHeight: 4000 });
  const shell = new FakeElement({ position: "fixed", children: [pane] });
  const browser = createBrowser({ root, elements: [shell, pane, smallPane] });
  const result = await browser.api.capture({ tab: browser.tab });
  assert.deepEqual(browser.captures.map((c) => c.top), [0, 540, 900], "the largest scrolling pane is scrolled");
  assert.equal(result.images.length, 3);
  assert.equal(browser.captures[1].styles[0], null, "the container of the scrolled pane is not hidden");
  assert.equal(smallPane.scrollTop, 0);
}
{
  // A page that refuses to scroll gives one image, not the same one repeated.
  const root = scrollingRoot(3000);
  root.maxTop = 0;
  const browser = createBrowser({ root });
  const result = await browser.api.capture({ tab: browser.tab });
  assert.equal(result.images.length, 1);
  assert.ok(result.totalParts > 1, "the caller can say the rest is missing");
}

async function assertFailsAndRestores({ onCapture, signal, expected, message }) {
  const root = scrollingRoot(5000);
  root.top = 50;
  const header = new FakeElement({ position: "fixed" });
  const browser = createBrowser({ root, elements: [header], onCapture });
  await assert.rejects(browser.api.capture({ tab: browser.tab, signal }), expected, message);
  assert.equal(root.scrollTop, 50, `${message}: scroll restored`);
  assert.equal(header.getAttribute("style"), null, `${message}: styles restored`);
  return browser;
}
{
  const switched = await assertFailsAndRestores({
    onCapture: (browser) => { if (browser.captures.length === 2) browser.activeTabId = 99; },
    expected: { code: "PAGE_CHANGED" },
    message: "switching tabs mid-capture cancels it",
  });
  assert.equal(switched.captures.length, 2, "no more pictures of the other tab");

  // A reload wipes the state startPageCapture() left behind.
  const root = scrollingRoot(5000);
  const browser = createBrowser({ root, onCapture: (b) => { delete b.page.window.__myLocalAiFullPage; } });
  await assert.rejects(browser.api.capture({ tab: browser.tab }), { code: "PAGE_CHANGED" }, "a reload cancels the capture");

  const controller = new AbortController();
  const cancelled = await assertFailsAndRestores({
    onCapture: () => controller.abort(),
    signal: controller.signal,
    expected: { name: "AbortError" },
    message: "cancelling stops the capture",
  });
  assert.equal(cancelled.captures.length, 1);
}
{
  // A new capture waits for a cancelled one to restore the page.
  const first = new AbortController();
  const browser = createBrowser({ root: scrollingRoot(1500), onCapture: () => first.abort() });
  const a = browser.api.capture({ tab: browser.tab, signal: first.signal });
  const b = browser.api.capture({ tab: browser.tab });
  await assert.rejects(a, { name: "AbortError" });
  assert.equal((await b).images.length, 2);
  const steps = browser.log.filter((name) => name !== "scrollPageTo");
  assert.deepEqual(steps, ["startPageCapture", "restorePage", "startPageCapture", "restorePage"], "captures never overlap");
}

// ===================== SIDEBAR: SEVERAL IMAGES PER MESSAGE =====================
function loadFunctions(names, stubs) {
  const sandbox = vm.createContext({ console, ...stubs });
  vm.runInContext(names.map((name) => functionSource(sidebarJs, name)).join("\n"), sandbox);
  return sandbox;
}

{
  const { describePageParts } = loadFunctions(["describePageParts"]);
  assert.deepEqual(plain(describePageParts("Docs", 1, 1)), { label: "Screenshot · Docs", note: "" }, "a one-screen page is a normal screenshot");
  const whole = describePageParts("Docs", 4, 4);
  assert.equal(whole.label, "Whole page in 4 images · Docs");
  assert.match(whole.note, /^The 4 attached images are consecutive screenshots of one web page, ordered from top to bottom/);
  assert.equal(/not captured/.test(whole.note), false);
  const cut = describePageParts("Docs", 8, 20);
  assert.equal(cut.label, "Page too long: first 8 of 20 parts · Docs", "the user is told the page was cut off");
  assert.match(cut.note, /not captured/, "…and so is the model");
}
{
  // Nano: every image becomes its own padded image part.
  let prompted;
  const sandbox = loadFunctions(["streamNano"], {
    abortController: { signal: null },
    session: null,
    base64ToImageBlob: (data) => `blob:${data}`,
    padImageToSquare: async (blob) => `padded:${blob}`,
    renderStreamingText() { }, scrollToBottom() { }, finalizeMessage() { },
  });
  const chat = { promptStreaming: async (prompt) => { prompted = prompt; return ["ok"]; } };
  await sandbox.streamNano("hi", {}, ["A", "B"], chat);
  assert.deepEqual(plain(prompted), [{
    role: "user",
    content: [{ type: "text", value: "hi" }, { type: "image", value: "padded:blob:A" }, { type: "image", value: "padded:blob:B" }],
  }]);
  await sandbox.streamNano("hi", {}, [], chat);
  assert.equal(prompted, "hi", "a message without images stays a plain string");
}
{
  // Ollama: all images of a message go into its images array.
  let body;
  const sandbox = loadFunctions(["ollamaPromptStreaming"], {
    getOllamaUrl: () => "http://x", getOllamaModel: () => "m", sysPromptEl: { value: "sys" }, DEFAULT_SYSTEM_PROMPT: "",
    chatHistory: [{ role: "user", content: "old__IMG__A" }, { role: "assistant", content: "a" }, { role: "user", content: "page__IMG__B__IMG__C" }],
    MAX_CHAT_MESSAGES: 100, tempSlider: { value: "1" }, topkSlider: { value: "3" }, modelSupportsThinking: false,
    GENERATION_TIMEOUT_MS: 1,
    fetchWithTimeout: async (url, options) => { body = JSON.parse(options.body); return { ok: true, body: { getReader() { } } }; },
  });
  await sandbox.ollamaPromptStreaming("page", null);
  assert.deepEqual(body.messages.slice(1).map((m) => [m.content, m.images]),
    [["old", ["A"]], ["a", undefined], ["page", ["B", "C"]]]);
}
{
  // Firebase: one inlineData part per image.
  const sandbox = { window: {}, console };
  vm.runInNewContext(read("providers/firebase-backend.js"), sandbox);
  const { buildRequest } = sandbox.window.MYLOCALAI_PROVIDERS.firebase;
  assert.equal(buildRequest("q", []), "q");
  assert.deepEqual(plain(buildRequest("q", ["A", "B"])), ["q",
    { inlineData: { data: "A", mimeType: "image/jpeg" } }, { inlineData: { data: "B", mimeType: "image/jpeg" } }]);
}
{
  // Storage full: images go before any chat is deleted, and the open chat keeps its own copy.
  let stored = "";
  const openMessage = { role: "user", content: `q__IMG__${"x".repeat(500)}` };
  const sandbox = loadFunctions(["saveAllSessions", "tryWriteSessions", "freeSessionStorage", "withoutImages"], {
    chatSessions: [
      { id: "new", history: [openMessage] },
      { id: "old", history: [{ role: "user", content: `p__IMG__${"y".repeat(500)}` }, { role: "assistant", content: "keep" }] },
    ],
    localStorage: { setItem(_key, value) { if (value.length > 800) throw new Error("QuotaExceededError"); stored = value; } },
  });
  sandbox.saveAllSessions();
  const saved = JSON.parse(stored);
  assert.deepEqual(saved.map((s) => s.id), ["new", "old"], "no chat is deleted while dropping images is enough");
  assert.equal(saved[1].history[0].content, "p", "the oldest chat loses its images first");
  assert.equal(saved[1].history[1].content, "keep");
  assert.match(saved[0].history[0].content, /__IMG__/, "newer images stay when they fit");
  assert.match(openMessage.content, /__IMG__/, "the open chat's message objects are not modified");

  sandbox.localStorage.setItem = (_key, value) => { if (value.length > 60) throw new Error("full"); stored = value; };
  sandbox.saveAllSessions();
  assert.deepEqual(JSON.parse(stored).map((s) => s.id), ["new"], "whole chats are dropped only as a last resort");
}
{
  // Prompt bar state: several images, the send button, and cancelling a running capture.
  const preview = [];
  const sandbox = loadFunctions(["setAttachedImages", "clearAttachedImage", "updateSendButton"], {
    attachedImages: [], attachedImagesNote: "", attachedImageIsAuto: true, pageCapture: null, isGenerating: false,
    userInput: { value: "" }, btnSend: { disabled: true }, fileUpload: { value: "x" },
    imagePreviewCard: { classList: { add() { } } }, imagePreviewThumbs: { replaceChildren() { } }, imagePreviewText: {},
    showImagePreview: (urls, label) => preview.push([urls.length, label]),
  });
  sandbox.setAttachedImages(["data:image/jpeg;base64,A", "data:image/jpeg;base64,B"], "Whole page", "note");
  assert.deepEqual([...sandbox.attachedImages], ["A", "B"]);
  assert.equal(sandbox.attachedImagesNote, "note");
  assert.equal(sandbox.attachedImageIsAuto, false, "a page capture is the user's own choice, never auto-replaced");
  assert.equal(sandbox.btnSend.disabled, false, "images alone can be sent");
  assert.deepEqual(preview, [[2, "Whole page"]]);

  const controller = new AbortController();
  sandbox.pageCapture = controller;
  sandbox.userInput.value = "typed";
  sandbox.updateSendButton();
  assert.equal(sandbox.btnSend.disabled, true, "no sending while a capture is still adding images");
  sandbox.clearAttachedImage();
  assert.equal(controller.signal.aborted, true, "removing the preview cancels the capture");
  assert.equal(sandbox.pageCapture, null);
  assert.deepEqual([...sandbox.attachedImages], []);
  assert.equal(sandbox.attachedImagesNote, "");
  assert.equal(sandbox.btnSend.disabled, false, "typed text can be sent again");
}

// ===================== WIRING =====================
assert.ok(SHARED_FILES.includes("features"), "features/full-page-capture.js must ship in every edition");
assert.ok(scriptPaths.indexOf("features/full-page-capture.js") >= 0 &&
  scriptPaths.indexOf("features/full-page-capture.js") < scriptPaths.indexOf(sidebarPaths[0]), "it loads before the sidebar scripts");
assert.match(sidebarHtml, /id="attach-menu"[\s\S]*id="btn-screenshot-page"[\s\S]*Screenshot whole page/, "the + menu offers the whole page");
assert.match(sidebarHtml, /id="image-preview-thumbs"/);
assert.match(sidebarJs, /btnScreenshotPage\.addEventListener\("click", screenshotFullPageFromMenu\)/);
assert.match(functionSource(sidebarJs, "screenshotFullPageFromMenu"), /\{\s*closeAttachMenu\(\);\s*const granted = await requestTabAccess\(\);/,
  "site access is requested while the click still counts as a user gesture");
assert.match(functionSource(sidebarJs, "refreshAutoScreenshot"), /if \(pageCapture\) return;/, "auto screenshots stay out of a running capture");
assert.match(functionSource(sidebarJs, "sendMessage"), /isGenerating \|\| pageCapture\) return;/, "Enter can't send half a capture");
assert.match(functionSource(sidebarJs, "sendMessage"), /if \(attachedImagesNote\) promptPreamble\.push\(attachedImagesNote\);/, "the model is told the images are one page");
assert.match(functionSource(sidebarJs, "processImage"), /if \(pageCapture\) clearAttachedImage\(\);/, "the user's own image cancels a capture");
assert.match(read(".githooks/pre-commit"), /node tests\/full-page-checks\.mjs/, "the pre-commit hook should run these checks");

console.log("Full-page checks passed");
