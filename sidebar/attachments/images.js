// Images waiting in the prompt bar.
"use strict";

function processImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  if (!canAttachImages()) return;
  // The user's own image wins over a page capture that is still running.
  if (pageCapture) clearAttachedImage();

  const reader = new FileReader();
  reader.onload = (e) => {
    attachImageDataUrl(e.target.result, MAX_UPLOAD_IMAGE_SIDE)
      .catch((err) => console.warn("[MyLocalAI] Could not read image:", err));
  };
  reader.readAsDataURL(file);
}

// Shrinks an image so its longest side is at most maxSide and re-encodes it as JPEG
// (quality 0.7) to keep prompts and saved history small.
function compressImageDataUrl(dataUrl, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => reject(new Error("Image could not be decoded"));
    img.src = dataUrl;
  });
}

// Makes one image the pending attachment and shows it in the preview card.
async function attachImageDataUrl(dataUrl, maxSide, label = "Attached image") {
  const compressed = await compressImageDataUrl(dataUrl, maxSide);
  setAttachedImages([compressed], label);
}

// Replaces whatever is waiting in the prompt bar. dataUrls are already compressed JPEGs.
function setAttachedImages(dataUrls, label, note = "") {
  attachedImages = dataUrls.map(url => url.split(",")[1]);
  attachedImagesNote = note;
  attachedImageIsAuto = false; // automatic callers set it back to true after this
  attachedPage = null; // the full-page capture sets it again after this
  closeImageViewer(); // it was showing the replaced images
  showImagePreview(dataUrls, label);
  updateSendButton();
}

function showImagePreview(dataUrls, label) {
  imagePreviewThumbs.replaceChildren(...dataUrls.map((url, i) => createThumbnail(url, i, dataUrls.length)));
  imagePreviewText.textContent = label;
  imagePreviewText.title = label;
  btnClearImage.title = "Clear image";
  imagePreviewCard.classList.remove("capturing");
  imagePreviewCard.classList.remove("hidden");
}

// A thumbnail opens the full-size view. With several images each one can also be removed on its
// own; a single image already has the card's ✕.
function createThumbnail(url, index, count) {
  const thumb = document.createElement("div");
  thumb.className = "img-thumb";

  const img = document.createElement("img");
  img.src = url;
  img.alt = `Attached image preview ${index + 1}`;
  const view = createThumbButton("img-thumb-view", `Preview image ${index + 1}`, () => openImageViewer(index));
  view.appendChild(img);
  thumb.appendChild(view);

  if (count > 1) {
    const remove = createThumbButton("img-thumb-remove", `Remove image ${index + 1}`, () => removeAttachedImage(index));
    remove.textContent = "✕";
    thumb.appendChild(remove);
  }
  return thumb;
}

function createThumbButton(className, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function toImageDataUrl(base64) {
  return `data:image/jpeg;base64,${base64}`;
}

function removeAttachedImage(index) {
  if (attachedImages.length <= 1) {
    clearAttachedImage();
    return;
  }
  // A new array: a message that is being sent may still hold the old one.
  attachedImages = attachedImages.filter((_, i) => i !== index);
  // The user picked this set, so an automatic screenshot must not replace it.
  attachedImageIsAuto = false;
  let label = "Attached image";
  if (attachedPage) {
    attachedPage = { ...attachedPage, parts: attachedPage.parts.filter((_, i) => i !== index) };
    ({ label, note: attachedImagesNote } = describePageParts(attachedPage));
  }
  showImagePreview(attachedImages.map(toImageDataUrl), label);
  updateSendButton();
}

// Also cancels a running page capture: its ✕, New chat and a model without vision all end here.
function clearAttachedImage() {
  pageCapture?.cancel.abort();
  pageCapture = null;
  attachedImages = [];
  attachedImagesNote = "";
  attachedPage = null;
  closeImageViewer();
  imagePreviewCard.classList.remove("capturing");
  imagePreviewCard.classList.add("hidden");
  imagePreviewThumbs.replaceChildren();
  imagePreviewText.textContent = "Attached image";
  imagePreviewText.title = "";
  attachedImageIsAuto = false;
  fileUpload.value = "";
  updateSendButton();
}

// Nothing can be sent while an answer streams or a page capture is still adding images.
function updateSendButton() {
  const empty = !userInput.value.trim() && !attachedImages.length;
  btnSend.disabled = empty || isGenerating || Boolean(pageCapture);
}

function canAttachImages() {
  return (activeBackend === "nano" || activeBackend === "ollama" || isProviderActive()) && modelSupportsVision;
}

function base64ToImageBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "image/jpeg" });
}

// squashes every image into a square, so a wide screenshot gets its
// text distorted (Chrome logs "Image input will be stretched..."). Letterboxing it
// onto a square canvas keeps the original proportions. Only the copy sent to Nano
// is padded; the preview, saved history and Ollama keep the original image.
async function padImageToSquare(imageBlob) {
  const bitmap = await createImageBitmap(imageBlob);
  const { width, height } = bitmap;
  if (width === height) {
    bitmap.close();
    return imageBlob;
  }

  const side = Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  // White bars: JPEG has no transparency, and most screenshots are light.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(bitmap, Math.round((side - width) / 2), Math.round((side - height) / 2));
  bitmap.close();

  return new Promise((resolve) => {
    // Fall back to the unpadded image rather than failing the whole prompt.
    canvas.toBlob((blob) => resolve(blob || imageBlob), "image/jpeg", 0.85);
  });
}

function getImageFileFromItems(items) {
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

function getImageFileFromFiles(files) {
  if (!files) return null;
  for (const file of files) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}
