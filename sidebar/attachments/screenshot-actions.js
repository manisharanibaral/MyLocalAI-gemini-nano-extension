// Screenshots the user asks for, and the site-access card.
"use strict";

// Automatic screenshots can't ask for site access themselves (no click to attach the
// permission prompt to), so a small card in the prompt bar offers the "Allow" click.
function showScreenshotAccessCard() {
  let dismissed = false;
  try { dismissed = localStorage.getItem("screenshotAccessDismissed") === "1"; } catch (_) { }
  screenshotAccessCard.classList.toggle("hidden", dismissed);
}

function hideScreenshotAccessCard() {
  screenshotAccessCard.classList.add("hidden");
}

async function allowScreenshotsFromCard() {
  const granted = await requestTabAccess(); // first await: keeps the click's gesture
  if (!granted) return;
  hideScreenshotAccessCard();
  watchActiveTab();
  refreshAutoScreenshot("open");
}

// Picking an automatic mode is a click, so it can ask for site access right away and
// show the screenshot immediately; it also undoes an earlier "Not now" on the card.
async function onTabScreenshotModeChange() {
  saveSettings();
  if (getTabScreenshotMode() === "manual") {
    hideScreenshotAccessCard();
    if (attachedImageIsAuto) clearAttachedImage();
    return;
  }
  const granted = await requestTabAccess(); // first await: keeps the change event's gesture
  try { localStorage.removeItem("screenshotAccessDismissed"); } catch (_) { }
  if (granted) {
    watchActiveTab();
    refreshAutoScreenshot("open");
  } else {
    showScreenshotAccessCard();
  }
}

function dismissScreenshotAccessCard() {
  hideScreenshotAccessCard();
  try { localStorage.setItem("screenshotAccessDismissed", "1"); } catch (_) { }
}

// "Screenshot this tab" in the + menu: works on any page Chrome lets us capture.
async function screenshotTabFromMenu() {
  closeAttachMenu();
  const granted = await requestTabAccess(); // first call, so it still has the click's gesture
  if (!granted) {
    alert(TAB_ACCESS_NEEDED_MESSAGE);
    return;
  }
  if (pageCapture) clearAttachedImage();
  try {
    const tab = await getActiveTab();
    if (!tab) throw new Error("No active tab");
    await attachTabScreenshot(tab);
    userInput.focus();
  } catch (err) {
    console.warn("[MyLocalAI] Screenshot failed:", err);
    alert(PROTECTED_PAGE_MESSAGE);
  }
}

// ----- "Screenshot whole page" (full-page-capture.js takes the pictures) -----
const TAB_ACCESS_NEEDED_MESSAGE = "MyLocalAI needs permission to see the page to take a screenshot. Nothing leaves your device.";
const PROTECTED_PAGE_MESSAGE = "Chrome doesn't allow screenshots of this page (browser pages like the New Tab or Web Store are protected).";

async function screenshotFullPageFromMenu() {
  closeAttachMenu();
  const granted = await requestTabAccess(); // first call, so it still has the click's gesture
  if (!granted) {
    alert(TAB_ACCESS_NEEDED_MESSAGE);
    return;
  }
  clearAttachedImage(); // also cancels an earlier capture
  const run = { cancel: new AbortController(), stop: new AbortController() };
  pageCapture = run;
  showCaptureStatus("Capturing the whole page…");
  updateSendButton();
  try {
    await attachFullPageScreenshot(run);
    userInput.focus();
  } catch (err) {
    if (run.cancel.signal.aborted) return; // cancelled by the user; the prompt bar already moved on
    console.warn("[MyLocalAI] Full-page screenshot failed:", err);
    clearAttachedImage();
    alert(err?.code === "PAGE_CHANGED"
      ? "The tab changed while capturing, so the full-page screenshot was cancelled. Stay on the page and try again."
      : PROTECTED_PAGE_MESSAGE);
  } finally {
    // A newer capture may already own the prompt bar.
    if (pageCapture === run) pageCapture = null;
    updateSendButton();
  }
}

// The preview card while capturing: progress text, "Stop & save", and ✕ to cancel.
function showCaptureStatus(text) {
  showImagePreview([], text);
  imagePreviewCard.classList.add("capturing");
  btnClearImage.title = "Cancel capture";
  btnStopCapture.disabled = Boolean(pageCapture?.stop.signal.aborted);
}

// "Stop & save": ends the capture early and attaches the parts taken so far.
function stopPageCapture() {
  if (!pageCapture) return;
  pageCapture.stop.abort();
  showCaptureStatus("Stopping… saving captured parts");
}

async function attachFullPageScreenshot({ cancel, stop }) {
  const tab = await getActiveTab();
  if (!tab) throw new Error("No active tab");
  const { images, totalParts, stopped } = await window.MyLocalAIFullPage.capture({
    tab,
    signal: cancel.signal,
    stopSignal: stop.signal,
    onProgress: (part, count) => {
      // After "Stop & save" the card keeps saying it is stopping.
      if (!cancel.signal.aborted && !stop.signal.aborted) showCaptureStatus(`Capturing… ${part} of ${count}`);
    },
  });
  // Each part keeps the size of a normal screenshot, which is what keeps its text readable.
  const compressed = await Promise.all(images.map(url => compressImageDataUrl(url, MAX_SCREENSHOT_SIDE)));
  if (cancel.signal.aborted) return;
  const page = {
    title: tab.title || "this tab",
    parts: compressed.map((_, i) => i + 1),
    captured: compressed.length,
    total: totalParts,
    stopped,
  };
  const { label, note } = describePageParts(page);
  setAttachedImages(compressed, label, note);
  attachedPage = page;
}

// The label is for the user; the note tells the model which parts of the page the images are.
function describePageParts({ title, parts, captured, total, stopped }) {
  if (total === 1) return { label: `Screenshot · ${title}`, note: "" };
  const count = parts.length;
  // True while the images are an unbroken run from the top of the page.
  const fromTop = count > 1 && parts.every((part, i) => part === i + 1);

  let label;
  if (count === total) label = `Whole page in ${count} images · ${title}`;
  else if (count < captured) label = `${count} of ${total} page parts · ${title}`;
  else if (stopped) label = `Stopped early: first ${count} of ${total} parts · ${title}`;
  else label = `Page too long: first ${count} of ${total} parts · ${title}`;

  if (!fromTop) {
    const shown = count === 1 ? `image is part ${parts[0]}` : `images are parts ${parts.join(", ")}`;
    return {
      label,
      note: `The attached ${shown} of ${total} screen-sized parts of one web page, numbered from ` +
        "top to bottom. The other parts are not attached.",
    };
  }
  let note = `The ${count} attached images are consecutive screenshots of one web page, ` +
    "ordered from top to bottom. Neighbouring images overlap slightly.";
  if (count < total) note += " The page continues below the last image, which was not captured.";
  return { label, note };
}
