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
  const controller = new AbortController();
  pageCapture = controller;
  showImagePreview([], "Capturing the whole page…");
  updateSendButton();
  try {
    await attachFullPageScreenshot(controller.signal);
    userInput.focus();
  } catch (err) {
    if (controller.signal.aborted) return; // cancelled by the user; the prompt bar already moved on
    console.warn("[MyLocalAI] Full-page screenshot failed:", err);
    clearAttachedImage();
    alert(err?.code === "PAGE_CHANGED"
      ? "The tab changed while capturing, so the full-page screenshot was cancelled. Stay on the page and try again."
      : PROTECTED_PAGE_MESSAGE);
  } finally {
    // A newer capture may already own the prompt bar.
    if (pageCapture === controller) pageCapture = null;
    updateSendButton();
  }
}

async function attachFullPageScreenshot(signal) {
  const tab = await getActiveTab();
  if (!tab) throw new Error("No active tab");
  const { images, totalParts } = await window.MyLocalAIFullPage.capture({
    tab,
    signal,
    onProgress: (part, count) => {
      if (!signal.aborted) showImagePreview([], `Capturing the whole page… ${part} of ${count}`);
    },
  });
  // Each part keeps the size of a normal screenshot, which is what keeps its text readable.
  const compressed = await Promise.all(images.map(url => compressImageDataUrl(url, MAX_SCREENSHOT_SIDE)));
  if (signal.aborted) return;
  const { label, note } = describePageParts(tab.title || "this tab", compressed.length, totalParts);
  setAttachedImages(compressed, label, note);
}

// The label is for the user; the note tells the model that the images are one page, in order.
function describePageParts(title, captured, total) {
  const cutOff = captured < total;
  if (captured === 1 && !cutOff) return { label: `Screenshot · ${title}`, note: "" };
  const label = cutOff
    ? `Page too long: first ${captured} of ${total} parts · ${title}`
    : `Whole page in ${captured} images · ${title}`;
  let note = `The ${captured} attached images are consecutive screenshots of one web page, ` +
    "ordered from top to bottom. Neighbouring images overlap slightly.";
  if (cutOff) note += " The page continues below the last image, which was not captured.";
  return { label, note };
}
