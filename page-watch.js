/**
 * MyLocalAI — page watcher (content script)
 *
 * Tells the side panel about two things it cannot see from outside the page:
 *   PAGE_SCROLL_SETTLED - the user scrolled and then stopped, so the screenshot can be refreshed
 *   PAGE_TEXT_SELECTED  - the user finished selecting text with the mouse or keyboard
 *
 * It only runs where the user granted MyLocalAI site access (registered by background.js,
 * or injected into the already-open tab by the side panel), and it sends nothing anywhere
 * but the extension itself.
 */
(() => {
  // The panel injects this into tabs that were open before access was granted, and the
  // registered script also loads on the next navigation, so guard against running twice.
  if (window.__myLocalAiPageWatch) return;
  window.__myLocalAiPageWatch = true;

  // Long enough that a flick of the trackpad counts as one scroll, short enough to feel live.
  const SCROLL_SETTLE_MS = 700;
  // Lets the browser finish updating the selection after mouseup (e.g. a double-click word).
  const SELECTION_SETTLE_MS = 50;

  let scrollTimer = null;
  let lastSentSelection = "";
  // True between a real mouse press and its release. A page can select text by script and
  // send fake mouse or key events (event.isTrusted is false for those), which would put text
  // the user never chose into their prompt; only the user's own gestures report a selection.
  let userIsSelecting = false;

  // After the extension is reloaded, this old copy of the script can no longer reach it.
  function notifyExtension(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => { });
    } catch (_) {
      stopWatching();
    }
  }

  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => notifyExtension({ type: "PAGE_SCROLL_SETTLED" }), SCROLL_SETTLE_MS);
  }

  // A selection the user can't see (off-screen, zero-size) was not made by them.
  function isOnScreen(selection) {
    if (!selection?.rangeCount) return false;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function reportSelection() {
    const selection = window.getSelection();
    const text = (selection?.toString() || "").trim();
    // Clicking elsewhere clears the selection; keep the context the user already has, but
    // forget the last text so selecting it again (after removing it in the panel) re-sends it.
    if (!text) {
      lastSentSelection = "";
      return;
    }
    if (text === lastSentSelection || !isOnScreen(selection)) return;
    lastSentSelection = text;
    notifyExtension({ type: "PAGE_TEXT_SELECTED", text });
  }

  function onPointerDown(event) {
    userIsSelecting = event.isTrusted;
  }

  function onPointerUp(event) {
    if (!event.isTrusted || !userIsSelecting) return;
    userIsSelecting = false;
    setTimeout(reportSelection, SELECTION_SETTLE_MS);
  }

  // Shift+arrow selections end on a key release rather than a mouse release.
  function onKeyUp(event) {
    if (!event.isTrusted) return;
    if (event.shiftKey || event.key === "Shift") reportSelection();
  }

  // Capture phase so scrolling inside page panels (not just the window) is noticed too.
  const SCROLL_OPTIONS = { capture: true, passive: true };

  function stopWatching() {
    clearTimeout(scrollTimer);
    document.removeEventListener("scroll", onScroll, SCROLL_OPTIONS);
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("mouseup", onPointerUp, true);
    document.removeEventListener("keyup", onKeyUp, true);
  }

  document.addEventListener("scroll", onScroll, SCROLL_OPTIONS);
  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("mouseup", onPointerUp, true);
  document.addEventListener("keyup", onKeyUp, true);
})();
