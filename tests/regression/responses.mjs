// Responses at once (1–5 parallel answers).
// Part of tests/regression-checks.mjs: static checks over the source files, no browser.
import assert from "node:assert/strict";
import { functionBody, sidebarCss, sidebarHtml, sidebarJs } from "../helpers/sources.mjs";

const ollamaPromptStreaming = functionBody(sidebarJs, "ollamaPromptStreaming");
const streamNano = functionBody(sidebarJs, "streamNano");

// ===== Responses at once (1–5 parallel answers) =====
assert.match(sidebarJs, /const DEFAULT_RESPONSE_COUNT = 1;/, "one answer per message should be the default");
assert.match(sidebarJs, /const MAX_RESPONSE_COUNT = 5;/, "at most five answers at once");
{
  const radios = [...sidebarHtml.matchAll(/<input type="radio" name="response-count" value="(\d)"/g)].map(m => m[1]);
  assert.deepEqual(radios, ["1", "2", "3", "4", "5"], "settings should offer 1–5 responses at once");
  assert.match(sidebarHtml, /name="response-count" value="1" checked/, "the HTML default should be 1");
}
{
  const clamp = functionBody(sidebarJs, "clampResponseCount");
  assert.match(clamp, /Math\.min\(MAX_RESPONSE_COUNT,\s*Math\.max\(1,/, "saved counts must be clamped to 1–5");
  assert.match(clamp, /return DEFAULT_RESPONSE_COUNT/, "a missing/garbage count should fall back to the default");
}
assert.match(functionBody(sidebarJs, "saveSettings"), /responseCount/, "responses-at-once should be saved");
assert.match(functionBody(sidebarJs, "loadSettings"), /responseCount[\s\S]*setResponseCount/, "responses-at-once should be restored");
{
  const sendBody = functionBody(sidebarJs, "sendMessageNow");
  assert.match(sendBody, /Promise\.allSettled\(group\.bubbles\.map/, "answers should stream in parallel, one failure must not cancel the rest");
  assert.match(sendBody, /createNanoVariantSessions\(getResponseCount\(\)\)/, "Nano answers need one session each");
  assert.match(sendBody, /streamNano\(finalPrompt, bubble, imagesToSend, nanoSessions\[i\]\)/, "each Nano answer should use its own session");
  assert.match(sendBody, /recordResponses\(group, results, chat\)/, "the reply should be stored once, after all answers settle");
}
assert.equal(/chatHistory\.push/.test(streamNano), false, "streamNano must not push history itself (recordResponses does)");
assert.equal(/chatHistory\.push/.test(functionBody(sidebarJs, "streamOllama")), false, "streamOllama must not push history itself");
assert.match(streamNano, /chatSession\.promptStreaming/, "streamNano should prompt the session it was given");
{
  const record = functionBody(sidebarJs, "recordResponses");
  assert.match(record, /findIndex\(v => !v\.failed\)/, "the chat should continue from the first successful answer");
  assert.match(record, /if \(selected >= 0\) \{[\s\S]*\}\s*saveConversation\(chat\.id, chat\.history\);/,
    "the question is saved even when no answer came back");
  assert.match(record, /variants\.length > 1[\s\S]*entry\.variants = variants/, "single-answer replies keep the old history shape");
  assert.match(record, /adoptNanoVariant\(selected\)/, "Nano should continue from the selected answer's session");
}
{
  const createVariants = functionBody(sidebarJs, "createNanoVariantSessions");
  assert.match(createVariants, /releaseNanoVariantSessions\(\)/, "old answer sessions must be freed before cloning new ones");
  assert.match(createVariants, /session\.clone\(\)[\s\S]*watchNanoContextOverflow/, "extra answers should be clones of the chat session");
  assert.match(createVariants, /catch[\s\S]*break;/, "a failed clone should yield fewer answers, not a failed reply");
}
assert.match(functionBody(sidebarJs, "releaseNanoVariantSessions"), /s === session\) continue/, "releasing answers must keep the adopted chat session");
assert.match(functionBody(sidebarJs, "destroyNanoSessions"), /releaseNanoVariantSessions\(\)/, "destroying Nano must free answer sessions too");
assert.match(functionBody(sidebarJs, "resetNanoChat"), /releaseNanoVariantSessions\(\)/, "New chat must free answer sessions");
{
  const bind = functionBody(sidebarJs, "bindVariantSelection");
  assert.match(bind, /variant\.failed[\s\S]*return/, "a failed answer can be viewed but not selected");
  assert.match(bind, /entry\.content = variant\.content/, "switching answers should change what history keeps");
  assert.match(bind, /chatHistory\[chatHistory\.length - 1\][\s\S]*adoptNanoVariant/, "only the latest reply may switch Nano's session");
}
assert.match(ollamaPromptStreaming, /const \{ variants, selected, \.\.\.message \} = m;/, "unused answers must not be sent to Ollama");
assert.match(functionBody(sidebarJs, "loadConversation"), /variants\?\.length > 1[\s\S]*appendSavedResponseGroup/, "saved multi-answer replies should restore with tabs");
{
  const group = functionBody(sidebarJs, "appendResponseGroup");
  assert.match(group, /count <= 1\) return singleResponseGroup\(appendMessage\("ai", "", true\)\)/, "one answer should render exactly like before");
  assert.match(group, /pane\.append\(bubble, createResponseActions\(bubble, false\)\)/, "each answer needs its own copy/hear actions inside its pane");
  assert.match(group, /setAttribute\("role", "tab"\)/, "answer tabs should be accessible tabs");
}
assert.match(sidebarCss, /\.variant-tab\.active\s*\{/, "the selected answer tab should be styled");
assert.match(sidebarCss, /\.segmented input:checked \+ span/, "the selected count should be highlighted");
