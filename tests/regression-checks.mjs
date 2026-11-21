import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const sidebarJs = read("sidebar.js");
const contentJs = read("content.js");
const manifestJson = JSON.parse(read("manifest.json"));
const sidebarHtml = read("sidebar.html");
const plist = read("set-ollama-cors.plist");
const purify = read("purify.min.js");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart + 1, i);
  }
  throw new Error(`Could not parse body for ${name}`);
}

const initOllamaSession = functionBody(sidebarJs, "initOllamaSession");
assert.equal(
  /chatHistory\s*=\s*\[\]/.test(initOllamaSession),
  false,
  "initOllamaSession must not clear restored chat history"
);

const setupEventListeners = functionBody(sidebarJs, "setupEventListeners");
assert.match(
  sidebarJs,
  /let\s+listenersInitialized\s*=\s*false/,
  "sidebar state should include a listenersInitialized guard"
);
assert.match(
  setupEventListeners,
  /if\s*\(\s*listenersInitialized\s*\)\s*return/,
  "setupEventListeners should return early after first registration"
);

const ollamaPromptStreaming = functionBody(sidebarJs, "ollamaPromptStreaming");
assert.equal(
  /\.\.\.chatHistory\.map[\s\S]*\{\s*role:\s*"user",\s*content:\s*text/.test(ollamaPromptStreaming),
  false,
  "ollamaPromptStreaming must not append the current user prompt after chatHistory already includes it"
);

const initNanoSession = functionBody(sidebarJs, "initNanoSession");
assert.match(
  initNanoSession,
  /expectedInputs:\s*\[[\s\S]*\{\s*type:\s*"image",\s*languages:\s*\["en"\]\s*\}/,
  "Gemini Nano should request image input support when available"
);
assert.match(
  initNanoSession,
  /outputLanguage:\s*"en"/,
  "Gemini Nano legacy API requests should specify an output language"
);
assert.match(
  initNanoSession,
  /\{\s*type:\s*"image",\s*languages:\s*\["en"\]\s*\}/,
  "Gemini Nano image input should declare the expected image language"
);

const streamNano = functionBody(sidebarJs, "streamNano");
assert.match(
  streamNano,
  /type:\s*"image"[\s\S]*base64ToImageBlob/,
  "Gemini Nano image prompts should use the Prompt API multimodal image part"
);

assert.match(
  setupEventListeners,
  /addEventListener\("paste"[\s\S]*processImage/,
  "image attachment should support paste from the clipboard"
);

assert.equal(
  contentJs.includes("selectionchange"),
  false,
  "content script should not send selected text automatically on every selectionchange"
);
assert.match(
  contentJs,
  /GET_SELECTED_TEXT/,
  "content script should expose selected text only when explicitly requested"
);
assert.equal(
  (manifestJson.content_scripts || []).some((script) => script.matches.includes("<all_urls>")),
  false,
  "manifest should avoid automatic content-script injection into every URL"
);

assert.equal(
  sidebarHtml.includes("nemotron-3-super:cloud"),
  false,
  "default Ollama model should not be a cloud model"
);
assert.equal(
  sidebarJs.includes('OLLAMA_ORIGINS "*"'),
  false,
  "runtime CORS guidance should not recommend wildcard origins"
);
assert.equal(
  plist.includes("ilkfkklfhnghddibnclfafkgjacibeeg"),
  false,
  "plist should not hardcode a single extension ID"
);

assert.match(
  purify,
  /DOMPurify 3\.4\.0/,
  "DOMPurify should be updated to the fixed 3.4.0 build"
);

console.log("Regression checks passed");
