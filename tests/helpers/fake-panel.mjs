// A just-enough browser for booting the side panel in Node: every element lookup succeeds, and
// only the behaviour the boot and send paths touch is real. It renders nothing.
import vm from "node:vm";
import { read, scriptPaths } from "./sources.mjs";

class FakeElement {
  constructor() {
    this.children = [];
    this.options = [];
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.value = "";
    this.textContent = "";
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force = !classes.has(name)) => {
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      },
    };
  }
  get innerHTML() { return this.textContent; }
  set innerHTML(html) { this.textContent = html; this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  fire(type, event = {}) { (this.listeners[type] || []).forEach((handler) => handler({ target: this, ...event })); }
  setAttribute() { }
  // Class selectors only: that is how the panel looks inside elements it has just built.
  querySelector(selector) {
    for (const child of this.children) {
      if (`.${child.className}`.split(" ")[0] === selector) return child;
      const found = child.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll() { return []; }
  contains() { return false; }
  focus() { }
}

function fakeDocument() {
  const bySelector = new Map();
  const responseCounts = ["1", "2", "3", "4", "5"].map((value) => Object.assign(new FakeElement(), { value }));
  return {
    createElement: () => new FakeElement(),
    addEventListener() { },
    querySelector(selector) {
      if (!bySelector.has(selector)) bySelector.set(selector, new FakeElement());
      return bySelector.get(selector);
    },
    querySelectorAll: (selector) => (selector.includes("response-count") ? responseCounts : []),
    getElementById: () => null,
  };
}

function fakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    clear: () => items.clear(),
  };
}

// Runs sidebar.html's scripts one by one in a shared global scope, as the browser does.
// Vendor libraries are left out: the panel falls back to plain text without them.
export function bootPanel({ globals = {} } = {}) {
  const document = fakeDocument();
  const windowListeners = {};
  const context = vm.createContext({
    addEventListener: (type, handler) => (windowListeners[type] ||= []).push(handler),
    console: { log() { }, info() { }, warn() { }, error: console.error },
    document,
    localStorage: fakeStorage(),
    navigator: { userAgent: "Chrome/140", language: "en" },
    chrome: {
      runtime: { id: "test", sendMessage: (_message, reply) => reply({}), onMessage: { addListener() { } } },
      tts: { getVoices: (reply) => reply([]), stop() { } },
    },
    DOMParser: class { parseFromString() { return { body: { childNodes: [] }, documentElement: new FakeElement() }; } },
    requestAnimationFrame: (frame) => setImmediate(frame),
    setTimeout, clearTimeout, AbortController, TextDecoder, Blob, URL,
    ...globals,
  });
  context.window = context;
  for (const path of scriptPaths.filter((p) => !p.startsWith("vendor/"))) {
    vm.runInContext(read(path), context, { filename: path });
  }
  return {
    element: (selector) => document.querySelector(selector),
    // Reads a top-level `let`/`const` of the panel scripts, which are not properties of the context.
    evaluate: (code) => vm.runInContext(code, context),
    // Delivers a window event, e.g. the "storage" event another window's panel causes.
    fireWindowEvent: (type, event) => (windowListeners[type] || []).forEach((handler) => handler(event)),
  };
}

export async function until(condition, what) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
