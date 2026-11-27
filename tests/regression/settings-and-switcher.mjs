// Settings layout and the prompt-bar model switcher.
// Part of tests/regression-checks.mjs: static checks over the source files, no browser.
import assert from "node:assert/strict";
import vm from "node:vm";
import { functionBody, read, scriptPaths, sidebarCss, sidebarHtml, sidebarJs, sidebarPaths } from "../helpers/sources.mjs";

// ===== Settings layout (grouped cards + pinned actions) =====
{
  const panel = sidebarHtml.match(/<div id="settings-panel"[\s\S]*?<!-- HISTORY PANEL -->/)[0];
  const cards = [...panel.matchAll(/<section[^>]*class="settings-card"/g)];
  assert.equal(cards.length, 4, "settings should be grouped into four cards");
  assert.match(panel, /<section id="ollama-settings" class="settings-card"/, "the Ollama card must keep the id applyEditionUI hides");
  assert.match(panel, /id="ollama-settings-label"/, "applyEditionUI renames the Ollama card title by this id");
  // Apply/Reset live outside the scrolling body so they stay reachable.
  const scrollEnd = panel.indexOf('<div class="settings-actions">');
  assert.ok(scrollEnd > 0, "settings should have a pinned actions footer");
  assert.match(panel.slice(scrollEnd), /id="btn-apply-settings"[\s\S]*id="btn-reset-all"/, "Apply and Reset belong in the footer");
  for (const id of ["saved-prompts", "sys-prompt", "temp-slider", "temp-value", "topk-slider", "topk-value",
    "idle-unload", "tab-screenshot-mode", "ollama-model", "ollama-url"]) {
    assert.ok(panel.slice(0, scrollEnd).includes(`id="${id}"`), `settings body should still contain #${id}`);
  }
  assert.match(sidebarCss, /#settings-panel\s*\{[^}]*max-height/, "the settings panel should cap its height");
  assert.match(sidebarCss, /\.settings-scroll\s*\{[^}]*overflow-y: auto/, "the settings body should scroll");
  assert.match(sidebarJs, /modelStatusSpan\.className = "settings-status"/, "the Ollama model status should be styled by class");
  // Idle-unload and screenshot dropdowns share one two-column row; the hint sits below it.
  assert.match(panel, /<div class="settings-row">\s*<div class="settings-group flex-1">\s*<label[^>]*for="idle-unload"[\s\S]*?<div class="settings-group flex-1">\s*<label[^>]*for="tab-screenshot-mode"/,
    "idle-unload and tab screenshot should sit side by side");
  assert.match(sidebarCss, /\.settings-row > \.settings-group\s*\{[^}]*justify-content: flex-end/, "column controls should align at the bottom");
}

// ===== Model switcher (prompt-bar pill) =====
{
  const switcherJs = read("features/model-switcher.js");
  assert.equal(switcherJs.includes("innerHTML"), false, "model-switcher.js builds the menu with DOM calls, never innerHTML");

  // --- Minimal fake DOM: just what model-switcher.js touches. ---
  class FakeElement {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.attrs = {};
      this.dataset = {};
      this.classes = new Set();
      this.className = "";
      this.textContent = "";
      this.title = "";
      this.disabled = false;
      this.classList = {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
        contains: (name) => this.classes.has(name),
        toggle: (name, force) => (force ? this.classes.add(name) : this.classes.delete(name)),
      };
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    focus() { fakeDocument.activeElement = this; }
    contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
    descendants() { return this.children.flatMap((child) => [child, ...(child.descendants?.() ?? [])]); }
    querySelectorAll(selector) {
      const className = selector.slice(1);
      return this.descendants().filter((node) => node.className.split(" ").includes(className));
    }
    fire(type, event = {}) { (this.listeners[type] || []).forEach((handler) => handler({ target: this, ...event })); }
  }
  const fakeDocument = {
    activeElement: null,
    listeners: [],
    createElement: (tag) => new FakeElement(tag),
    addEventListener(type, handler) { if (type === "click") this.listeners.push(handler); },
    click(target) { this.listeners.forEach((handler) => handler({ target })); },
  };
  const sandbox = { window: {}, document: fakeDocument };
  vm.runInNewContext(switcherJs, sandbox);
  const api = sandbox.window.MyLocalAIModelSwitcher;
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // --- Pure option builders ---
  assert.deepEqual({ ...api.nanoOption() }, { id: "nano", label: "Gemini Nano", detail: "On-device · private" });
  const ollama = api.ollamaOptions(["qwen3:8b", "gemma4:e4b", "gemma4:e4b", "kimi-k2:cloud"], "llama3");
  assert.deepEqual([...ollama.map((o) => o.label)], ["gemma4:e4b", "kimi-k2:cloud", "llama3", "qwen3:8b"],
    "installed models are de-duplicated and sorted, and the configured model is always offered");
  assert.equal(ollama.find((o) => o.label === "kimi-k2:cloud").detail, "Ollama · cloud", "cloud models are labelled");
  assert.equal(ollama.find((o) => o.label === "qwen3:8b").detail, "Ollama · local");
  assert.deepEqual([...api.ollamaOptions([], "gemma4:e4b").map((o) => o.id)], ["ollama:gemma4:e4b"],
    "with Ollama unreachable the menu still lists the configured model");
  assert.deepEqual({ ...api.parseModelId("nano") }, { backend: "nano" });
  assert.deepEqual({ ...api.parseModelId("ollama:gemma4:e4b") }, { backend: "ollama", model: "gemma4:e4b" },
    "model names containing ':' survive the id round trip");
  assert.equal(api.parseModelId("ollama:"), null, "an empty model name is not a model");
  assert.equal(api.parseModelId("bogus"), null);

  // --- Menu behaviour ---
  function buildSwitcher({ onSelect }) {
    const root = new FakeElement("div");
    const button = new FakeElement("button");
    const labelEl = new FakeElement("span");
    const menu = new FakeElement("div");
    menu.classList.add("hidden");
    root.append(button, menu);
    const options = [{ id: "a", label: "Model A", detail: "one" }, { id: "b", label: "Model B", detail: "two" }];
    const api2 = api.create({ root, button, labelEl, menu, loadOptions: async () => ({ options, currentId: "a" }), onSelect });
    const items = () => menu.querySelectorAll(".model-menu-item");
    return { root, button, labelEl, menu, items, controls: api2 };
  }

  {
    const selected = [];
    const ui = buildSwitcher({ onSelect: async (id) => { selected.push(id); } });
    ui.controls.setCurrent("Model A");
    assert.equal(ui.labelEl.textContent, "Model A", "the pill shows the answering model");
    assert.match(ui.button.title, /Model A/);

    ui.button.fire("click");
    await settle();
    assert.equal(ui.menu.classList.contains("hidden"), false, "clicking the pill opens the menu");
    assert.equal(ui.button.attrs["aria-expanded"], "true");
    assert.deepEqual(ui.items().map((i) => i.attrs["aria-checked"]), ["true", "false"], "the current model is ticked");
    assert.equal(fakeDocument.activeElement, ui.items()[0], "focus starts on the current model");

    ui.items()[0].fire("click");
    await settle();
    assert.deepEqual(selected, [], "choosing the current model switches nothing");
    assert.equal(ui.menu.classList.contains("hidden"), true, "…and just closes the menu");

    ui.button.fire("click");
    await settle();
    ui.items()[1].fire("click");
    await settle();
    assert.deepEqual(selected, ["b"], "choosing another model calls onSelect with its id");
    assert.equal(ui.menu.classList.contains("hidden"), true, "a successful switch closes the menu");

    ui.button.fire("click");
    ui.menu.fire("keydown", { key: "Escape" });
    assert.equal(ui.menu.classList.contains("hidden"), true, "Escape closes the menu");
    ui.button.fire("click");
    fakeDocument.click(new FakeElement("div"));
    assert.equal(ui.menu.classList.contains("hidden"), true, "clicking elsewhere closes the menu");

    ui.button.fire("click");
    ui.controls.setDisabled(true);
    assert.equal(ui.button.disabled, true, "the pill is disabled while an answer streams");
    assert.equal(ui.menu.classList.contains("hidden"), true, "…and an open menu is closed");
    ui.controls.setDisabled(false);
    assert.equal(ui.button.disabled, false);

    ui.controls.setVisible(false);
    assert.equal(ui.root.classList.contains("hidden"), true, "editions with one model hide the pill");
  }

  {
    // A failed switch keeps the menu open and says why.
    const ui = buildSwitcher({ onSelect: async () => { throw new Error("Can't reach Ollama"); } });
    ui.button.fire("click");
    await settle();
    ui.items()[1].fire("click");
    await settle();
    assert.equal(ui.menu.classList.contains("hidden"), false, "a failed switch leaves the menu open");
    const note = ui.menu.children.find((child) => child.attrs.role === "alert");
    assert.equal(note?.textContent, "Can't reach Ollama", "the error text is shown in the menu");
    assert.deepEqual(ui.items().map((i) => i.attrs["aria-checked"]), ["true", "false"], "the previous model stays ticked");
    assert.deepEqual(ui.items().map((i) => i.disabled), [false, false], "items can be clicked again");
  }

  {
    // While a switch runs, items are locked and an outside click must not hide the progress.
    let finish;
    const ui = buildSwitcher({ onSelect: () => new Promise((resolve) => { finish = resolve; }) });
    ui.button.fire("click");
    await settle();
    ui.items()[1].fire("click");
    assert.deepEqual(ui.items().map((i) => i.disabled), [true, true], "items are locked while switching");
    assert.equal(ui.items()[1].children[1].textContent, "Switching…");
    fakeDocument.click(new FakeElement("div"));
    assert.equal(ui.menu.classList.contains("hidden"), false, "an outside click can't close the menu mid-switch");
    finish();
    await settle();
    assert.equal(ui.menu.classList.contains("hidden"), true, "the menu closes once the switch finishes");
  }

  // --- Wiring in the page ---
  const pillAt = sidebarHtml.indexOf('id="model-switcher"');
  assert.ok(pillAt > sidebarHtml.indexOf('<div class="input-wrap">') && pillAt > sidebarHtml.indexOf('id="user-input"') &&
    pillAt < sidebarHtml.indexOf('id="btn-send"'),
    "the model pill sits inside the input bar, between the text box and the send button");
  for (const id of ["btn-model", "model-pill-label", "model-menu"]) {
    assert.ok(sidebarHtml.includes(`id="${id}"`), `sidebar.html should contain #${id}`);
  }
  assert.ok(scriptPaths.indexOf("features/model-switcher.js") >= 0 &&
    scriptPaths.indexOf("features/model-switcher.js") < scriptPaths.indexOf(sidebarPaths[0]), "model-switcher.js loads before the sidebar scripts");
  assert.match(sidebarCss, /\.model-pill\s*\{/, "the pill is styled");
  assert.match(sidebarCss, /\.model-menu\s*\{[^}]*bottom: calc\(100% \+ 10px\);\s*right: 0/, "the menu opens upward, anchored to the right edge");

  assert.match(functionBody(sidebarJs, "updateBackendUI"), /refreshModelPill\(\)/, "the pill follows the active backend");
  assert.match(functionBody(sidebarJs, "setupEventListeners"), /setupModelSwitcher\(\)/, "the switcher is set up once with the other listeners");
  const sendMessageBody = functionBody(sidebarJs, "sendMessage");
  assert.match(sendMessageBody, /isGenerating = true;\s*modelSwitcher\?\.setDisabled\(true\)/, "no switching while an answer streams");
  assert.match(sendMessageBody, /isGenerating = false;\s*modelSwitcher\?\.setDisabled\(false\)/, "switching is re-enabled afterwards");

  const switchModel = functionBody(sidebarJs, "switchModel");
  assert.match(switchModel, /if \(isGenerating\) throw/, "switchModel refuses mid-answer");
  assert.match(switchModel, /scheduleIdleUnload\(\)/, "the idle-unload timer is restarted after a switch");
  assert.equal(/chatHistory\s*=\s*\[\]/.test(switchModel), false, "switching models keeps the chat");

  const toOllama = functionBody(sidebarJs, "switchToOllamaModel");
  assert.match(toOllama, /catch \(err\) \{\s*ollamaModelInput\.value = previousModel;\s*throw err;/, "a failed Ollama switch restores the model field");
  assert.match(toOllama, /saveOllamaModelSetting\(\)/, "the chosen Ollama model is remembered");
  assert.equal(/saveSettings\(\)/.test(toOllama), false, "switching must not persist unapplied settings edits");
  assert.match(toOllama, /destroyNanoSessions\(\)/, "leaving Nano frees its memory");
  const toNano = functionBody(sidebarJs, "switchToNano");
  assert.match(toNano, /modelSupportsVision = previousVision/, "a failed Nano switch restores the capability flags");
  assert.match(toNano, /can't see the earlier messages/, "the user is told Nano starts without the chat so far");

  // Only editions with more than one model get a pill.
  const hasChoices = new Function("ollamaEnabled", "externalProvider", functionBody(sidebarJs, "modelSwitcherHasChoices"));
  assert.equal(hasChoices(false, null), false, "Nano edition: nothing to switch to");
  assert.equal(hasChoices(true, null), true, "Ollama and Mixed editions list Ollama models");
  assert.equal(hasChoices(false, { listModels() {} }), true, "a provider that lists models gets the pill");
  assert.equal(hasChoices(false, {}), false, "a provider without listModels does not");

  const errorText = new Function("externalProvider", "getOllamaUrl", `return function describeSwitchError(err) {${functionBody(sidebarJs, "describeSwitchError")}}`);
  const describeOllama = errorText(null, () => "http://localhost:11434");
  assert.match(describeOllama(new Error("OLLAMA_CONNECT_FAILED")), /Can't reach Ollama at http:\/\/localhost:11434/);
  assert.match(describeOllama(new Error("NANO_NEEDS_GESTURE")), /Click the model again/);
  assert.equal(describeOllama(new Error("boom")), "boom");
  const describeProvider = errorText({ helpLines: () => ["On-device Gemini Nano isn't available."] }, () => "");
  assert.equal(describeProvider(Object.assign(new Error("DEVICE_UNAVAILABLE"), { code: "DEVICE_UNAVAILABLE" })), "On-device Gemini Nano isn't available.",
    "provider setup errors are explained with the provider's own help text");
}
