// Previewing and removing the images waiting in the prompt bar.
// Part of tests/full-page-checks.mjs: runs sidebar/ functions with stubbed surroundings.
import assert from "node:assert/strict";
import { loadFunctions, plain } from "../helpers/fake-page.mjs";
import { functionSource, sidebarCss, sidebarHtml, sidebarJs } from "../helpers/sources.mjs";

// ===================== PAGE LABEL AND NOTE =====================
{
  const { describePageParts: describe } = loadFunctions(["describePageParts"]);
  const page = (parts, extra = {}) => ({ title: "Docs", parts, captured: parts.length, total: parts.length, stopped: false, ...extra });

  assert.deepEqual(plain(describe(page([1]))), { label: "Screenshot · Docs", note: "" }, "a one-screen page is a normal screenshot");
  const whole = describe(page([1, 2, 3, 4]));
  assert.equal(whole.label, "Whole page in 4 images · Docs");
  assert.match(whole.note, /^The 4 attached images are consecutive screenshots of one web page, ordered from top to bottom/);
  assert.doesNotMatch(whole.note, /not captured/);

  const cut = describe(page([1, 2, 3, 4, 5, 6, 7, 8], { total: 20 }));
  assert.equal(cut.label, "Page too long: first 8 of 20 parts · Docs", "the user is told the page was cut off");
  assert.match(cut.note, /not captured/, "…and so is the model");
  assert.equal(describe(page([1, 2], { total: 5, stopped: true })).label, "Stopped early: first 2 of 5 parts · Docs");

  const gap = describe(page([1, 3], { captured: 3, total: 3 }));
  assert.equal(gap.label, "2 of 3 page parts · Docs");
  assert.match(gap.note, /images are parts 1, 3 of 3/, "the model is not told removed parts are there");
  assert.doesNotMatch(gap.note, /consecutive/);
  const one = describe(page([2], { captured: 3, total: 3 }));
  assert.match(one.note, /^The attached image is part 2 of 3/);
}

// ===================== REMOVING =====================
{
  const labels = [];
  let cleared = 0;
  const original = ["A", "B", "C"];
  const sandbox = loadFunctions(["removeAttachedImage", "describePageParts", "toImageDataUrl"], {
    attachedImages: original,
    attachedImagesNote: "old",
    attachedImageIsAuto: true,
    attachedPage: { title: "Docs", parts: [1, 2, 3], captured: 3, total: 3, stopped: false },
    showImagePreview: (urls, label) => labels.push([urls, label]),
    updateSendButton() { },
    clearAttachedImage: () => { cleared += 1; },
  });
  sandbox.removeAttachedImage(1);
  assert.deepEqual(plain(sandbox.attachedImages), ["A", "C"]);
  assert.deepEqual(original, ["A", "B", "C"], "a message being sent keeps its own list");
  assert.deepEqual(plain(sandbox.attachedPage.parts), [1, 3]);
  assert.match(sandbox.attachedImagesNote, /parts 1, 3 of 3/);
  assert.equal(sandbox.attachedImageIsAuto, false, "a hand-picked set is never auto-replaced");
  assert.deepEqual(plain(labels), [[["data:image/jpeg;base64,A", "data:image/jpeg;base64,C"], "2 of 3 page parts · Docs"]]);
  sandbox.removeAttachedImage(0);
  assert.deepEqual(plain(sandbox.attachedImages), ["C"]);
  assert.equal(cleared, 0);
  sandbox.removeAttachedImage(0);
  assert.equal(cleared, 1, "removing the last image clears the card");
}

// ===================== VIEWER =====================
{
  const classes = new Set();
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const sandbox = loadFunctions(
    ["openImageViewer", "closeImageViewer", "showViewedImage", "removeViewedImage", "onImageViewerKey", "toImageDataUrl"], {
      viewedImageIndex: 0,
      attachedImages: ["A", "B", "C"],
      imageViewer: dialog,
      imageViewerImg: {}, imageViewerTitle: {}, btnViewerPrev: {}, btnViewerNext: {},
      imageViewerNav: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
      removeAttachedImage(index) {
        sandbox.attachedImages = sandbox.attachedImages.filter((_, i) => i !== index);
        if (!sandbox.attachedImages.length) sandbox.closeImageViewer();
      },
    });
  const shown = () => [sandbox.imageViewerImg.src.split(",")[1], sandbox.imageViewerTitle.textContent];

  sandbox.openImageViewer(1);
  assert.equal(dialog.open, true);
  assert.deepEqual(shown(), ["B", "Image 2 of 3"]);
  sandbox.onImageViewerKey({ key: "ArrowRight" });
  assert.deepEqual(shown(), ["C", "Image 3 of 3"]);
  assert.equal(sandbox.btnViewerNext.disabled, true);
  sandbox.onImageViewerKey({ key: "ArrowRight" });
  assert.deepEqual(shown(), ["C", "Image 3 of 3"], "navigation stops at the ends");

  sandbox.removeViewedImage();
  assert.deepEqual(shown(), ["B", "Image 2 of 2"], "removing the last one steps back");
  sandbox.removeViewedImage();
  assert.deepEqual(shown(), ["A", "Attached image"]);
  assert.equal(classes.has("hidden"), true, "one image needs no previous/next");
  sandbox.removeViewedImage();
  assert.equal(dialog.open, false, "the viewer closes with nothing left to show");
}

// ===================== WIRING =====================
assert.match(sidebarHtml, /<dialog id="image-viewer"[\s\S]*id="btn-viewer-remove"[\s\S]*id="btn-viewer-close"[\s\S]*id="image-viewer-img"/);
assert.match(sidebarJs, /setupImageViewer\(\);/);
assert.match(functionSource(sidebarJs, "createThumbnail"), /openImageViewer\(index\)[\s\S]*if \(count > 1\)[\s\S]*removeAttachedImage\(index\)/);
for (const name of ["setAttachedImages", "clearAttachedImage"]) {
  assert.match(functionSource(sidebarJs, name), /closeImageViewer\(\);/, `${name} closes a viewer showing old images`);
}
assert.match(functionSource(sidebarJs, "refreshAutoScreenshot"), /if \(imageViewer\.open\) return;/,
  "an automatic screenshot doesn't replace the image being previewed");
assert.match(sidebarCss, /\.image-viewer\[open\] \{ display: flex;/, "a closed dialog must stay hidden");
