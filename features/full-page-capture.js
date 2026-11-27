/**
 * MyLocalAI — full-page screenshot
 *
 * One tall image of a whole page gets shrunk by the model until its text is unreadable. So the
 * page is scrolled one screen at a time and each screen is kept as its own image, at the same
 * size as a normal tab screenshot.
 *
 * sidebar/attachments/screenshot-actions.js calls window.MyLocalAIFullPage.capture(); this file
 * only talks to the page and to chrome.tabs / chrome.scripting. It needs the optional site
 * access to be granted already.
 */
(() => {
  "use strict";

  // Every image costs model context and storage, so very long pages are cut off here.
  const MAX_PAGE_PARTS = 8;
  // Neighbouring images share this strip, so a line cut at one edge is whole in the next image.
  const PART_OVERLAP_PX = 60;
  // captureVisibleTab allows about 2 calls per second. The wait also lets the page repaint.
  const CAPTURE_INTERVAL_MS = 600;

  // Scroll offsets that cover the page top to bottom. totalParts says how many the whole page
  // needs, which is more than positions.length when the page is cut off at MAX_PAGE_PARTS.
  function planScrollPositions(pageHeight, viewHeight) {
    const step = Math.max(1, viewHeight - Math.min(PART_OVERLAP_PX, Math.floor(viewHeight / 4)));
    const lastTop = Math.max(0, pageHeight - viewHeight);
    const positions = [];
    for (let top = 0; top < lastTop; top += step) positions.push(top);
    positions.push(lastTop);
    return { positions: positions.slice(0, MAX_PAGE_PARTS), totalParts: positions.length };
  }

  // ===================== FUNCTIONS RUN INSIDE THE PAGE =====================
  // chrome.scripting copies each function's source into the tab, so they must not use anything
  // from this file. They share their state through window.__myLocalAiFullPage.

  // Remembers how the page looked and reports how far it scrolls.
  function startPageCapture() {
    const root = document.scrollingElement || document.documentElement;
    let scroller = root;
    // Many web apps keep the window still and scroll a large inner pane instead.
    if (root.scrollHeight <= window.innerHeight + 1) {
      const panes = [...document.querySelectorAll("*")].filter((el) =>
        el !== root &&
        el.clientHeight >= window.innerHeight / 2 &&
        el.scrollHeight > el.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY));
      panes.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      scroller = panes[0] || root;
    }
    window.__myLocalAiFullPage = {
      scroller,
      originalTop: scroller.scrollTop,
      originalStyles: new Map(), // "element → its style attribute before we touched it"
    };
    window.__myLocalAiFullPage.originalStyles.set(scroller, scroller.getAttribute("style"));
    // Smooth scrolling would still be moving when the picture is taken.
    scroller.style.setProperty("scroll-behavior", "auto", "important");
    const viewHeight = scroller === root ? window.innerHeight : Math.min(scroller.clientHeight, window.innerHeight);
    return { pageHeight: scroller.scrollHeight, viewHeight };
  }

  // Scrolls and returns where the page really ended up, or null if the page was reloaded.
  async function scrollPageTo(top) {
    const state = window.__myLocalAiFullPage;
    if (!state) return null;
    state.scroller.scrollTop = top;
    // Gives the page time to react (lazy images, headers that appear on scroll).
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Pinned headers and banners would repeat in every image and hide the text under them.
    // The first image keeps them, so they are still captured once.
    if (top > 0) {
      for (const el of document.querySelectorAll("*")) {
        const position = getComputedStyle(el).position;
        if ((position !== "fixed" && position !== "sticky") || el.contains(state.scroller)) continue;
        if (!state.originalStyles.has(el)) state.originalStyles.set(el, el.getAttribute("style"));
        if (position === "fixed") {
          el.style.setProperty("opacity", "0", "important");
        } else {
          // A sticky element has its own place in the page; put it back there.
          for (const [name, value] of [["position", "relative"], ["top", "auto"], ["bottom", "auto"]]) {
            el.style.setProperty(name, value, "important");
          }
        }
      }
    }
    return state.scroller.scrollTop;
  }

  // Puts the scroll position and every changed style back.
  function restorePage() {
    const state = window.__myLocalAiFullPage;
    if (!state) return;
    state.scroller.scrollTop = state.originalTop; // while smooth scrolling is still off
    for (const [el, style] of state.originalStyles) {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
    delete window.__myLocalAiFullPage;
  }

  // ===================== CAPTURE =====================
  async function runInPage(tabId, func, args = []) {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return injection?.result;
  }

  function pageChangedError() {
    const error = new Error("The page changed during the capture");
    error.code = "PAGE_CHANGED";
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException("Page capture cancelled", "AbortError");
  }

  // captureVisibleTab photographs whatever tab is in front, so a tab switch mid-capture would
  // silently attach a different page.
  async function assertTabStillVisible(tab) {
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id) throw pageChangedError();
  }

  async function captureParts(tab, positions, signal, onProgress) {
    const images = [];
    let previousTop = -1;
    for (const position of positions) {
      throwIfAborted(signal);
      const top = await runInPage(tab.id, scrollPageTo, [position]);
      if (top === null || top === undefined) throw pageChangedError();
      if (top <= previousTop) break; // the page won't scroll further; don't repeat an image
      previousTop = top;

      onProgress?.(images.length + 1, positions.length);
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_INTERVAL_MS));
      throwIfAborted(signal);
      await assertTabStillVisible(tab);
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
      await assertTabStillVisible(tab);
      images.push(image);
    }
    return images;
  }

  async function captureNow({ tab, signal, onProgress }) {
    throwIfAborted(signal);
    const { pageHeight, viewHeight } = await runInPage(tab.id, startPageCapture);
    try {
      const { positions, totalParts } = planScrollPositions(pageHeight, viewHeight);
      const images = await captureParts(tab, positions, signal, onProgress);
      return { images, totalParts };
    } finally {
      // The tab may be closed by now; there is nothing left to restore then.
      await runInPage(tab.id, restorePage).catch(() => { });
    }
  }

  // Captures run one at a time: a cancelled one must restore the page before the next starts,
  // or its cleanup would undo the new capture's changes.
  let previousCapture = Promise.resolve();

  /** Resolves to { images: [JPEG data URL, top to bottom], totalParts }. */
  function capture(options) {
    const run = previousCapture.then(() => captureNow(options));
    previousCapture = run.catch(() => { });
    return run;
  }

  window.MyLocalAIFullPage = { capture, planScrollPositions, MAX_PAGE_PARTS };
})();
