// Copy and read-aloud buttons under an answer.
"use strict";

// ===================== RESPONSE ACTIONS (copy / speak) =====================
// Reads the rendered answer at click time so it is correct for streamed and
// restored messages alike. The "Thinking..." block is not part of the answer.
function getResponseText(bubble) {
  const clone = bubble.cloneNode(true);
  clone.querySelectorAll(".thinking-block, .code-header").forEach(el => el.remove());
  return clone.textContent.trim();
}

function createResponseActions(bubble, visible) {
  const row = document.createElement("div");
  row.className = "msg-actions";
  if (!visible) row.classList.add("hidden");

  const copyBtn = createActionButton("Copy", "Copy response");
  copyBtn.addEventListener("click", () => copyResponse(bubble, copyBtn));

  const speakBtn = createActionButton("Hear", "Read response aloud");
  speakBtn.addEventListener("click", () => toggleSpeech(bubble, speakBtn));

  row.appendChild(copyBtn);
  row.appendChild(speakBtn);
  return row;
}

// A provider may say where an answer ran ({ kind, label, title }, e.g. Firebase: on-device or
// cloud). It sits with the answer's buttons so the user sees it on every answer.
function showAnswerSource(bubble, source) {
  const row = bubble.parentElement?.querySelector(".msg-actions");
  if (!row || !source?.label) return;
  row.querySelector(".msg-source")?.remove();
  const chip = document.createElement("span");
  chip.className = `msg-source msg-source-${source.kind === "cloud" ? "cloud" : "device"}`;
  chip.textContent = source.label;
  chip.title = source.title || "";
  row.appendChild(chip);
}

function createActionButton(text, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "msg-action-btn";
  btn.textContent = text;
  btn.title = title;
  return btn;
}

async function copyResponse(bubble, button) {
  try {
    await navigator.clipboard.writeText(getResponseText(bubble));
    flashButtonLabel(button, "Copied!");
  } catch {
    flashButtonLabel(button, "Failed");
  }
}

function flashButtonLabel(button, text) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  setTimeout(() => { button.textContent = original; }, 1500);
}

// Without an explicit voice Chrome falls back to the OS default, which is often a
// robotic one. We pick the most natural-sounding voice matching the UI language.
let preferredVoiceName;

// Higher score = more natural. "Google" voices are neural; macOS "Enhanced"/"Premium"
// and Windows "Natural" voices are the high-quality OS ones.
function scoreVoice(voice) {
  let score = 0;
  if (/natural|neural|premium|enhanced/i.test(voice.voiceName)) score += 3;
  if (/^google/i.test(voice.voiceName)) score += 2;
  if (voice.remote === false) score += 1; // local voices start instantly, work offline
  return score;
}

function pickBestVoice(voices, language) {
  const base = language.split("-")[0].toLowerCase();
  const matching = voices.filter(v => (v.lang || "").toLowerCase().startsWith(base));
  const ranked = matching.sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return ranked.length ? ranked[0].voiceName : undefined;
}

function loadPreferredVoice() {
  if (!chrome.tts) return;
  chrome.tts.getVoices(voices => {
    preferredVoiceName = pickBestVoice(voices || [], navigator.language || "en");
  });
}

// Raw markdown output sounds broken when spoken ("asterisk asterisk", URLs, code).
function cleanTextForSpeech(text) {
  return text
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[*_`#>~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Uses Chrome's text-to-speech API (needs the "tts" permission).
// Clicking again while speaking stops playback.
function toggleSpeech(bubble, button) {
  if (!chrome.tts) {
    flashButtonLabel(button, "Unsupported");
    return;
  }
  const wasSpeakingThis = button.classList.contains("speaking");
  stopAllSpeech();
  if (wasSpeakingThis) return;

  const reset = () => {
    button.classList.remove("speaking");
    button.textContent = "Hear";
  };
  button.classList.add("speaking");
  button.textContent = "Stop";
  chrome.tts.speak(cleanTextForSpeech(getResponseText(bubble)), {
    voiceName: preferredVoiceName,
    lang: preferredVoiceName ? undefined : navigator.language,
    // "end" fires on completion; "interrupted"/"cancelled"/"error" when stopped early.
    onEvent: (event) => {
      if (["end", "interrupted", "cancelled", "error"].includes(event.type)) reset();
    },
  });
}

function stopAllSpeech() {
  chrome.tts.stop();
  messagesEl.querySelectorAll(".msg-action-btn.speaking").forEach(btn => {
    btn.classList.remove("speaking");
    btn.textContent = "Hear";
  });
}
