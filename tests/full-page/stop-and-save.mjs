// "Stop & save" and the capturing glow drawn on the page.
// Part of tests/full-page-checks.mjs: runs the capture against a fake page, nothing is rendered.
import assert from "node:assert/strict";
import { createBrowser, FakeElement, loadFunctions, plain, scrollingRoot } from "../helpers/fake-page.mjs";
import { functionSource, read, sidebarCss, sidebarHtml, sidebarJs } from "../helpers/sources.mjs";

// ===================== PAGE GLOW =====================
{
  const browser = createBrowser({ root: scrollingRoot(2000) });
  await browser.api.capture({ tab: browser.tab });
  assert.deepEqual(browser.captures.map((c) => c.glow.visibility), ["hidden", "hidden", "hidden"],
    "the glow is never part of a picture");
  assert.deepEqual(browser.captures.map((c) => c.glow.text), [1, 2, 3].map((n) => `Capturing… ${n} of 3`));
  assert.equal(browser.overlays.length, 0, "the glow is removed afterwards");
  assert.equal(browser.longTimers.size, 0, "…along with its self-removal timer");
  const shows = browser.log.filter((name) => name === "showCaptureGlow");
  assert.equal(shows.length, 3, "the glow comes back for every part");
}
{
  // A cancelled or failed capture cleans up too, and the page scan leaves the glow visible.
  const controller = new AbortController();
  let styleWhileScrolled;
  const browser = createBrowser({
    root: scrollingRoot(2000),
    onCapture: (b) => {
      if (b.captures.length < 2) return;
      styleWhileScrolled = b.overlays[0].getAttribute("style");
      controller.abort();
    },
  });
  await assert.rejects(browser.api.capture({ tab: browser.tab, signal: controller.signal }), { name: "AbortError" });
  assert.equal(browser.overlays.length, 0, "cancelling removes the glow");
  assert.doesNotMatch(styleWhileScrolled, /opacity/, "the page's pinned-element hiding skips the glow");
}
{
  // The panel closing mid-capture leaves the page to remove the glow on its own.
  let orphaned;
  const browser = createBrowser({
    root: scrollingRoot(800),
    onCapture: (b) => {
      assert.equal(b.longTimers.size, 1, "one self-removal timer, restarted at each step");
      const [fire] = b.longTimers.values();
      fire();
      orphaned = b.overlays.length;
    },
  });
  await browser.api.capture({ tab: browser.tab });
  assert.equal(orphaned, 0);
}

// ===================== STOP & SAVE =====================
// Presses "Stop & save" while picture number `during` is being taken.
async function captureAndStop(during) {
  const stop = new AbortController();
  const root = scrollingRoot(5000);
  root.top = 40;
  const header = new FakeElement({ position: "fixed" });
  const browser = createBrowser({
    root,
    elements: [header],
    onCapture: (b) => { if (b.captures.length === during) stop.abort(); },
  });
  const result = await browser.api.capture({ tab: browser.tab, stopSignal: stop.signal });
  return { browser, result, root, header };
}
{
  const { browser, result, root, header } = await captureAndStop(2);
  assert.equal(result.images.length, 2, "stopping keeps the parts taken so far");
  assert.equal(result.stopped, true);
  assert.ok(result.totalParts > 2, "the caller knows the page goes on");
  assert.equal(browser.captures.length, 2, "no further pictures");
  assert.equal(root.scrollTop, 40, "the page is restored after stopping");
  assert.equal(header.getAttribute("style"), null);
  assert.equal(browser.overlays.length, 0);
}
{
  // Pressed before anything was captured: take one part, so there is something to save.
  const browser = createBrowser({ root: scrollingRoot(5000) });
  const stop = new AbortController();
  stop.abort();
  const result = await browser.api.capture({ tab: browser.tab, stopSignal: stop.signal });
  assert.equal(result.images.length, 1);
  assert.equal(result.stopped, true);
}
{
  // Pressed during the last picture: nothing was missed.
  const { result } = await captureAndStop(7); // a 5000px page has 7 parts
  assert.equal(result.images.length, 7);
  assert.equal(result.stopped, false);
  const whole = createBrowser({ root: scrollingRoot(1500) });
  assert.equal((await whole.api.capture({ tab: whole.tab })).stopped, false);
}
{
  // whenIdle() waits for a capture that is still cleaning up the page.
  const controller = new AbortController();
  const browser = createBrowser({ root: scrollingRoot(2000), onCapture: () => controller.abort() });
  const run = browser.api.capture({ tab: browser.tab, signal: controller.signal }).catch(() => { });
  await browser.api.whenIdle();
  assert.equal(browser.overlays.length, 0);
  assert.equal(browser.page.window.__myLocalAiFullPage, undefined);
  await run;
}

// ===================== SIDEBAR =====================
{
  const shown = [];
  const run = { cancel: new AbortController(), stop: new AbortController() };
  const classes = new Set();
  const sandbox = loadFunctions(["showCaptureStatus", "stopPageCapture", "attachFullPageScreenshot", "describePageParts"], {
    pageCapture: run,
    attachedPage: null,
    btnStopCapture: { disabled: false },
    btnClearImage: {},
    imagePreviewCard: { classList: { add: (name) => classes.add(name) } },
    showImagePreview: (_urls, label) => shown.push(label),
    MAX_SCREENSHOT_SIDE: 1280,
    getActiveTab: async () => ({ title: "Docs" }),
    compressImageDataUrl: async (url) => `small:${url}`,
    setAttachedImages: (...args) => { sandbox.attached = args; },
    window: {
      MyLocalAIFullPage: {
        async capture({ signal, stopSignal, onProgress }) {
          assert.equal(signal, run.cancel.signal);
          assert.equal(stopSignal, run.stop.signal);
          onProgress(1, 5);
          sandbox.stopPageCapture();
          onProgress(2, 5);
          return { images: ["A", "B"], totalParts: 5, stopped: true };
        },
      },
    },
  });
  await sandbox.attachFullPageScreenshot(run);
  assert.deepEqual(shown, ["Capturing… 1 of 5", "Stopping… saving captured parts"],
    "progress doesn't overwrite the stopping message");
  assert.ok(classes.has("capturing"));
  assert.equal(sandbox.btnStopCapture.disabled, true, "Stop & save can't be pressed twice");
  assert.equal(run.cancel.signal.aborted, false, "stopping is not cancelling");
  assert.deepEqual(plain(sandbox.attached[0]), ["small:A", "small:B"]);
  assert.equal(sandbox.attached[1], "Stopped early: first 2 of 5 parts · Docs");
  assert.match(sandbox.attached[2], /not captured/);
  assert.deepEqual(plain(sandbox.attachedPage), { title: "Docs", parts: [1, 2], captured: 2, total: 5, stopped: true });
}

// ===================== WIRING =====================
assert.match(sidebarHtml, /id="image-preview-card"[\s\S]*class="capture-dot"[\s\S]*id="btn-stop-capture"[^>]*>Stop &amp; save</);
assert.match(sidebarJs, /btnStopCapture\.addEventListener\("click", stopPageCapture\)/);
assert.match(sidebarCss, /\.capture-dot, #btn-stop-capture \{ display: none; \}/, "Stop shows only while capturing");
assert.match(sidebarCss, /\.capturing #btn-stop-capture \{ display: block; \}/);
assert.match(functionSource(sidebarJs, "attachTabScreenshot"), /await window\.MyLocalAIFullPage\.whenIdle\(\);[\s\S]*captureVisibleTab/,
  "a tab screenshot waits until a cancelled capture has removed its glow");
assert.match(read("features/capture-indicator.js"), /"pointer-events:none"/, "the glow never blocks the page");
