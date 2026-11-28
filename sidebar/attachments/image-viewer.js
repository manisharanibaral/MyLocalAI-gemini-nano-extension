// Full-size preview of the images waiting in the prompt bar.
"use strict";

let viewedImageIndex = 0;

function openImageViewer(index) {
  showViewedImage(index);
  // A modal dialog gives Escape-to-close and keeps focus inside without extra code.
  if (!imageViewer.open) imageViewer.showModal();
}

function closeImageViewer() {
  if (imageViewer.open) imageViewer.close();
}

function showViewedImage(index) {
  const count = attachedImages.length;
  viewedImageIndex = Math.max(0, Math.min(index, count - 1));
  const title = count > 1 ? `Image ${viewedImageIndex + 1} of ${count}` : "Attached image";
  imageViewerImg.src = toImageDataUrl(attachedImages[viewedImageIndex]);
  imageViewerImg.alt = title;
  imageViewerTitle.textContent = title;
  imageViewerNav.classList.toggle("hidden", count < 2);
  btnViewerPrev.disabled = viewedImageIndex === 0;
  btnViewerNext.disabled = viewedImageIndex === count - 1;
}

// Stays open on the neighbouring image, so several can be reviewed and removed in a row.
function removeViewedImage() {
  removeAttachedImage(viewedImageIndex);
  if (attachedImages.length) showViewedImage(viewedImageIndex);
}

function onImageViewerKey(event) {
  if (event.key === "ArrowLeft") showViewedImage(viewedImageIndex - 1);
  if (event.key === "ArrowRight") showViewedImage(viewedImageIndex + 1);
}

function setupImageViewer() {
  btnViewerClose.addEventListener("click", closeImageViewer);
  btnViewerRemove.addEventListener("click", removeViewedImage);
  btnViewerPrev.addEventListener("click", () => showViewedImage(viewedImageIndex - 1));
  btnViewerNext.addEventListener("click", () => showViewedImage(viewedImageIndex + 1));
  imageViewer.addEventListener("keydown", onImageViewerKey);
}
