/**
 * MyLocalAI — "capturing" indicator
 *
 * A glowing frame and a small label drawn on the web page while features/full-page-capture.js
 * photographs it. It has to be hidden around every picture, or it would be part of it.
 *
 * Exposes window.MyLocalAICaptureIndicator = { show, hide, remove }, each taking a tab id.
 */
(() => {
  "use strict";

  // If the panel closes mid-capture nothing would remove the glow, so it removes itself when no
  // new step arrives for this long.
  const ORPHAN_TIMEOUT_MS = 10000;
  // Time for the browser to repaint the page without the glow before the picture is taken.
  const REPAINT_WAIT_MS = 100;

  // ===================== FUNCTIONS RUN INSIDE THE PAGE =====================
  // chrome.scripting copies each function's source into the tab, so they must not use anything
  // from this file. They share their state through window.__myLocalAiCaptureGlow.

  function showCaptureGlow(message, orphanTimeoutMs) {
    let state = window.__myLocalAiCaptureGlow;
    if (!state) {
      const frame = document.createElement("div");
      // full-page-capture.js hides the page's own fixed elements; this marks ours to be left alone.
      frame.setAttribute("data-mylocalai-overlay", "");
      frame.setAttribute("aria-hidden", "true");
      // !important keeps the page's own stylesheet from moving or hiding the frame.
      frame.style.cssText = [
        "position:fixed", "inset:0", "display:block", "margin:0", "z-index:2147483647",
        "pointer-events:none", "box-sizing:border-box",
        "box-shadow:inset 0 0 0 3px rgba(139,92,246,0.95),inset 0 0 24px 6px rgba(139,92,246,0.6)," +
        "inset 0 0 64px 16px rgba(6,182,212,0.35)",
      ].map((rule) => `${rule} !important`).join(";");

      const label = document.createElement("div");
      label.style.cssText = [
        "position:absolute", "top:14px", "left:50%", "transform:translateX(-50%)",
        "padding:6px 14px", "border-radius:999px", "background:rgba(17,17,27,0.88)", "color:#fff",
        "font:600 13px/1.4 system-ui,sans-serif", "white-space:nowrap",
      ].map((rule) => `${rule} !important`).join(";");
      frame.appendChild(label);
      document.documentElement.appendChild(frame);

      if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        frame.animate?.([{ opacity: 0.55 }, { opacity: 1 }],
          { duration: 1100, iterations: Infinity, direction: "alternate", easing: "ease-in-out" });
      }
      state = window.__myLocalAiCaptureGlow = { frame, label, timer: null };
    }
    state.label.textContent = message;
    state.frame.style.setProperty("visibility", "visible", "important");
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.frame.remove();
      delete window.__myLocalAiCaptureGlow;
    }, orphanTimeoutMs);
  }

  async function hideCaptureGlow(repaintWaitMs) {
    const state = window.__myLocalAiCaptureGlow;
    if (!state) return;
    state.frame.style.setProperty("visibility", "hidden", "important");
    await new Promise((resolve) => setTimeout(resolve, repaintWaitMs));
  }

  function removeCaptureGlow() {
    const state = window.__myLocalAiCaptureGlow;
    if (!state) return;
    clearTimeout(state.timer);
    state.frame.remove();
    delete window.__myLocalAiCaptureGlow;
  }

  // ===================== PANEL SIDE =====================
  const runInPage = (tabId, func, args = []) => chrome.scripting.executeScript({ target: { tabId }, func, args });

  window.MyLocalAICaptureIndicator = {
    // The glow is decoration: a page that refuses it can still be captured.
    show: (tabId, message) => runInPage(tabId, showCaptureGlow, [message, ORPHAN_TIMEOUT_MS]).catch(() => { }),
    // Not caught: a picture must never be taken while the glow might still be on screen.
    hide: (tabId) => runInPage(tabId, hideCaptureGlow, [REPAINT_WAIT_MS]),
    // The tab may be closed by now; there is nothing left to remove then.
    remove: (tabId) => runInPage(tabId, removeCaptureGlow).catch(() => { }),
  };
})();
