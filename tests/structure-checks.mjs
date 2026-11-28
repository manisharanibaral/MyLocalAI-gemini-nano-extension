// Checks how the repo is organised, then boots the split sidebar against a fake browser to
// prove the files still work together. Nothing here renders a page or talks to a real model.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { read, scriptPaths, sidebarPaths, stylePaths } from "./helpers/sources.mjs";
import { bootPanel, until } from "./helpers/fake-panel.mjs";

const MAX_LINES = 500;
const root = new URL("../", import.meta.url);
// Generated or third-party files, which we don't edit.
const NOT_OURS = new Set([".git", "dist", "node_modules", "vendor", "package-lock.json"]);

function filesUnder(folder = "") {
  return readdirSync(new URL(folder || "./", root), { withFileTypes: true })
    .filter((entry) => !NOT_OURS.has(entry.name))
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(`${folder}${entry.name}/`) : [`${folder}${entry.name}`]));
}

// ===================== FILE SIZE =====================
for (const path of filesUnder().filter((p) => /\.(js|mjs|css|html|md)$/.test(p))) {
  const lines = read(path).replace(/\n$/, "").split("\n").length;
  assert.ok(lines <= MAX_LINES, `${path} has ${lines} lines; split it (limit ${MAX_LINES})`);
}

// ===================== sidebar.html LOADS EVERYTHING ONCE =====================
for (const path of [...scriptPaths, ...stylePaths]) {
  assert.ok(existsSync(new URL(path, root)), `sidebar.html loads ${path}, which does not exist`);
}
for (const [folder, loaded] of [["sidebar/", scriptPaths], ["features/", scriptPaths], ["providers/", scriptPaths], ["styles/", stylePaths]]) {
  const onDisk = filesUnder(folder).filter((p) => /\.(js|css)$/.test(p)).sort();
  const inHtml = loaded.filter((p) => p.startsWith(folder)).sort();
  assert.deepEqual(inHtml, onDisk, `sidebar.html should load every file in ${folder} exactly once`);
}
assert.equal(sidebarPaths.at(-1), "sidebar/main.js", "main.js starts the panel, so everything must be loaded before it");
for (const path of sidebarPaths) {
  assert.match(read(path), /^"use strict";$/m, `${path} should keep strict mode`);
}

// ===================== BOOT: OLLAMA =====================
function ndjsonStream(frames) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
      controller.close();
    },
  });
}

{
  const requests = [];
  const fetch = async (url) => {
    requests.push(new URL(url).pathname);
    if (url.endsWith("/api/chat")) {
      return { ok: true, body: ndjsonStream([{ message: { content: "Hello " } }, { message: { content: "there" } }]) };
    }
    return { ok: true, json: async () => ({ models: [{ name: "gemma4:e4b" }], capabilities: [] }) };
  };
  const panel = bootPanel({ globals: { fetch } });
  await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");
  assert.match(panel.element("#header-badge").textContent, /^Ollama · gemma4:e4b/);
  assert.equal(panel.element("#status-overlay").classList.contains("hidden"), true, "the overlay closes once ready");
  assert.deepEqual(requests, ["/api/tags", "/api/show"]);

  panel.element("#user-input").value = "hi";
  panel.element("#btn-send").fire("click");
  await until(() => panel.evaluate("!isGenerating && chatHistory.length === 2"), "the Ollama answer");
  const saved = JSON.parse(panel.evaluate('localStorage.getItem("chatSessions")'));
  assert.deepEqual(saved[0].history.map((m) => [m.role, m.content]), [["user", "hi"], ["assistant", "Hello there"]]);

  panel.element("#history-panel").classList.add("hidden"); // as sidebar.html starts it
  panel.element("#btn-history").fire("click");
  assert.equal(panel.element("#history-list").children.length, 1, "the chat shows in History");
  await panel.evaluate("startNewChat()");
  assert.equal(panel.evaluate("chatHistory.length"), 0);
}

// ===================== BOOT: GEMINI NANO =====================
{
  const session = () => ({
    clone: async () => session(),
    destroy() { },
    addEventListener() { },
    promptStreaming: async () => ["Nano ", "answer"],
  });
  const LanguageModel = { availability: async () => "available", create: async () => session() };
  const panel = bootPanel({ globals: { LanguageModel } });
  await until(() => panel.evaluate("activeBackend") === "nano", "the Nano backend");
  assert.match(panel.element("#header-badge").textContent, /^Gemini Nano/);

  await panel.evaluate('sendMessage("hi")');
  assert.equal(panel.evaluate("chatHistory.at(-1).content"), "Nano answer");
}

// ===================== BOOT: NOTHING AVAILABLE =====================
{
  const panel = bootPanel({ globals: { fetch: async () => { throw new TypeError("offline"); } } });
  await until(() => panel.element("#status-title").textContent === "No AI Backend Found", "the error overlay");
  assert.match(panel.element("#status-message").textContent, /Gemini Nano is not available/);
}

// ===================== BEHAVIOUR, BY TOPIC =====================
await import("./panel/chat-saving.mjs");
await import("./panel/ollama.mjs");
await import("./panel/settings.mjs");
await import("./panel/context-and-length.mjs");
await import("./panel/context-budget.mjs");
await import("./panel/memory.mjs");
await import("./panel/selected-text.mjs");

console.log("Structure checks passed");
