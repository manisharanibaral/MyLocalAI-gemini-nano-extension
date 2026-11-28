// Selected text ("Use selection as MyLocalAI context") is shown in the user's message, both when
// sent and when the chat is reopened. Part of tests/structure-checks.mjs.
import assert from "node:assert/strict";
import { bootPanel, until } from "../helpers/fake-panel.mjs";
import { fakeOllama } from "./fake-models.mjs";

const ollama = fakeOllama();
const panel = bootPanel({ globals: { fetch: ollama.fetch } });
await until(() => panel.evaluate("activeBackend") === "ollama", "the Ollama backend");

const userBubbles = () => panel.element("#messages").children
  .filter((msg) => msg.className === "msg user")
  .map((msg) => msg.children[1]);
const quoteIn = (bubble) => bubble.children.find((child) => child.className === "msg-selection");

// ===================== SENDING SHOWS THE SELECTION ABOVE THE QUESTION =====================
const selection = "The mitochondria is the powerhouse of the cell. ".repeat(10);
panel.evaluate(`setContextFromSelection(${JSON.stringify(selection)})`);
await panel.evaluate('sendMessage("explain this")');

const saved = panel.evaluate("chatHistory[0]");
assert.equal(saved.selectedText, selection.trim(), "history keeps the selection apart from the prompt");
assert.match(saved.content, /User Question:\nexplain this$/, "the model still gets the selection inside the prompt");

const quote = quoteIn(userBubbles()[0]);
assert.ok(quote, "the user message shows the selected text");
assert.equal(userBubbles()[0].children[0], quote, "above the question");
const [label, text, toggle] = quote.children;
assert.equal(label.textContent, "Selected text");
assert.equal(text.textContent, selection.trim(), "as plain text (a web page can't inject HTML)");
assert.equal(toggle.textContent, "Show all", "a long selection can be expanded");
toggle.fire("click");
assert.equal(quote.classList.contains("expanded"), true);
assert.equal(toggle.textContent, "Show less");

// ===================== A SHORT SELECTION NEEDS NO TOGGLE; PLAIN MESSAGES NO QUOTE =====================
panel.evaluate('setContextFromSelection("short quote")');
await panel.evaluate('sendMessage("and this?")');
assert.equal(quoteIn(userBubbles()[1]).children.length, 2, "no Show all for a short selection");
await panel.evaluate('sendMessage("no selection here")');
assert.equal(quoteIn(userBubbles()[2]), undefined, "a message without a selection has no quote");

// ===================== REOPENING THE CHAT SHOWS IT AGAIN =====================
const id = panel.evaluate("currentSessionId");
await panel.evaluate("startNewChat()");
panel.evaluate(`loadConversation(${JSON.stringify(id)})`);
assert.equal(quoteIn(userBubbles()[0]).children[1].textContent, selection.trim(), "a saved chat shows its selection");
assert.equal(quoteIn(userBubbles()[2]), undefined);
