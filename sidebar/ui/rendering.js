// Markdown rendering, sanitizing, auto-scroll and the token line.
"use strict";

// Streaming render: coalesced to one DOM update per frame, and the bubble
// can only grow while streaming (min-height ratchet) so half-parsed markdown
// never makes the response area jump smaller.
function renderStreamingText(bubble, text, reasoning = "") {
  const pending = pendingRenders.get(bubble);
  if (pending) { pending.text = text; pending.reasoning = reasoning; return; }
  pendingRenders.set(bubble, { text, reasoning });
  requestAnimationFrame(() => {
    const job = pendingRenders.get(bubble);
    pendingRenders.delete(bubble);
    if (!job || bubble.dataset.done) return;
    let html = "";
    if (job.reasoning) {
      html += `<details class="thinking-block" open><summary>Thinking...</summary><div class="thinking-content">${formatResponseText(job.reasoning)}</div></details>`;
    }
    html += formatResponseText(job.text) + '<span class="cursor">\u200B</span>';
    setSafeHtml(bubble, html);
    const h = bubble.offsetHeight;
    if (h > (parseFloat(bubble.style.minHeight) || 0)) bubble.style.minHeight = h + "px";
    scrollToBottom();
  });
}

function finalizeMessage(bubble, text, reasoning = "") {
  bubble.dataset.done = "1";
  pendingRenders.delete(bubble);
  bubble.style.minHeight = "";
  let html = "";
  if (reasoning) {
    // close it when finished
    html += `<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">${formatResponseText(reasoning)}</div></details>`;
  }
  html += formatResponseText(text);
  setSafeHtml(bubble, html);
  const actions = bubble.parentElement?.querySelector(".msg-actions");
  if (actions) actions.classList.remove("hidden");
}

// Markdown rendering via the vendored `marked` library (GFM: tables, lists,
// task lists, strikethrough…). Output is always sanitized by DOMPurify.
function getMarkdownRenderer() {
  if (markdownRendererCache !== undefined) return markdownRendererCache;
  if (typeof marked === "undefined") return (markdownRendererCache = null);
  const renderer = new marked.Renderer();
  const baseTable = marked.Renderer.prototype.table;

  // Keep the code header + Copy button.
  renderer.code = ({ text, lang }) => {
    const label = escapeHtml((lang || "").split(/\s+/)[0] || "code");
    return `<div class="code-container"><div class="code-header"><span class="code-lang">${label}</span><button class="btn-copy-code" type="button" title="Copy code">Copy</button></div><pre class="code-block"><code>${escapeHtml(text)}</code></pre></div>`;
  };
  // Scrollable wrapper so wide tables don't break the layout.
  renderer.table = function (token) {
    return `<div class="table-container">${baseTable.call(this, token)}</div>`;
  };
  // Never pass raw HTML from the model through; show it as text.
  renderer.html = ({ text }) => escapeHtml(text);

  if (typeof DOMPurify !== "undefined") {
    // Links inside the sidebar must open in a new tab, not replace the chat.
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  return (markdownRendererCache = renderer);
}

function formatResponseText(text) {
  if (!text) return "";
  const renderer = getMarkdownRenderer();
  if (!renderer) return escapeHtml(text);
  return marked.parse(text, { gfm: true, breaks: true, async: false, renderer });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setSafeHtml(element, htmlString) {
  const cleanHtml = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(htmlString) : htmlString;
  const doc = new DOMParser().parseFromString(cleanHtml, "text/html");
  element.replaceChildren(...doc.body.childNodes);
}

// Auto-scroll follows the stream only while the user is "pinned" to the
// bottom. Any upward user scroll unpins; scrolling back down re-pins.
function scrollToBottom(force = false) {
  if (force) isAutoScrollEnabled = true;
  if (!isAutoScrollEnabled || scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    if (!isAutoScrollEnabled) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    lastScrollTop = messagesEl.scrollTop;
  });
}

function updateTokenInfo() {
  tokenInfo.title = "";
  if (activeBackend === "nano" && session) {
    const used = nanoUsed();
    const max = nanoWindow();
    const left = Math.max(0, max - used);
    if (max > 0) {
      const pct = Math.round((used / max) * 100);
      const trimmedNote = nanoContextTrimmed ? " · oldest messages forgotten" : "";
      tokenInfo.textContent = `${used.toLocaleString()} / ${max.toLocaleString()} tokens · ${left.toLocaleString()} left${trimmedNote}`;
      if (nanoContextTrimmed) {
        tokenInfo.title = "The conversation outgrew Gemini Nano's context window, so it dropped the earliest turns. Start a new chat for a clean slate.";
      }
      tokenInfo.style.color = pct > 85 ? "#F87171" : pct > 65 ? "#FBBF24" : "";
    }
  } else if (activeBackend === "ollama") {
    tokenInfo.textContent = `${chatHistory.length} messages`;
    tokenInfo.style.color = "";
  } else if (isProviderActive()) {
    tokenInfo.textContent = externalProvider.statusLine(chatHistory.length);
    tokenInfo.style.color = "";
  } else {
    tokenInfo.textContent = "";
    tokenInfo.style.color = "";
  }
}
