// A fake web page and chrome API for running features/full-page-capture.js (and the glow it
// draws) in Node, plus a loader for single sidebar/ functions. Nothing here renders anything.
import assert from "node:assert/strict";
import vm from "node:vm";
import { functionSource, read, sidebarJs } from "./sources.mjs";

const captureScripts = ["features/capture-indicator.js", "features/full-page-capture.js"].map(read);
// Timers this long are the glow's self-removal, which tests fire by hand.
const LONG_TIMER_MS = 1000;

// Values built inside a vm belong to another realm; copy them before deepEqual.
export const plain = (value) => JSON.parse(JSON.stringify(value));

export function loadFunctions(names, stubs) {
  const sandbox = vm.createContext({ console, ...stubs });
  vm.runInContext(names.map((name) => functionSource(sidebarJs, name)).join("\n"), sandbox);
  return sandbox;
}

class FakeStyle {
  constructor(element) { this.element = element; }
  setProperty(name, value, priority) {
    if (name === "visibility") this.visibility = value;
    const previous = this.element.attrs.style ?? "";
    this.element.attrs.style = `${previous}${name}: ${value}${priority ? ` !${priority}` : ""};`;
  }
}

export class FakeElement {
  constructor({ position = "static", overflowY = "visible", clientHeight = 0, clientWidth = 1000, scrollHeight = clientHeight, children = [], style } = {}) {
    Object.assign(this, { clientHeight, clientWidth, scrollHeight, children });
    this.computed = { position, overflowY };
    this.attrs = style === undefined ? {} : { style };
    this.style = new FakeStyle(this);
    this.top = 0;
    this.maxTop = Math.max(0, scrollHeight - clientHeight);
  }
  get scrollTop() { return this.top; }
  set scrollTop(value) { this.top = Math.min(this.maxTop, Math.max(0, value)); } // browsers clamp
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return name in this.attrs; }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}

// A tab: the injected functions are re-created from their source in the page's own realm,
// exactly like chrome.scripting does, so they fail here if they depend on the module.
export function createBrowser({ viewHeight = 800, root, elements = [], onCapture } = {}) {
  const documentElement = new FakeElement();
  const overlays = documentElement.children; // what the extension adds to the page
  const longTimers = new Map();
  const page = vm.createContext({
    window: { innerHeight: viewHeight },
    document: {
      scrollingElement: root,
      documentElement,
      // The glow is "fixed" in a real page, so the page scan must meet it as such.
      createElement: () => new FakeElement({ position: "fixed" }),
      querySelectorAll: () => [root, ...elements, ...overlays],
    },
    getComputedStyle: (el) => el.computed,
    setTimeout: (done, ms) => {
      if (ms < LONG_TIMER_MS) return setImmediate(done);
      const id = Symbol("timer");
      longTimers.set(id, done);
      return id;
    },
    clearTimeout: (id) => longTimers.delete(id),
  });
  const browser = { page, root, overlays, longTimers, activeTabId: 7, captures: [], log: [] };
  const chrome = {
    scripting: {
      async executeScript({ target, func, args }) {
        assert.equal(target.tabId, 7, "scripts go into the captured tab");
        browser.log.push(func.name);
        const result = await vm.runInContext(`(${func})(...${JSON.stringify(args)})`, page);
        return [{ result }];
      },
    },
    tabs: {
      async query() { return [{ id: browser.activeTabId }]; },
      async captureVisibleTab(windowId) {
        assert.equal(windowId, 3, "the panel's window is captured");
        browser.captures.push(snapshot(browser, elements));
        await onCapture?.(browser);
        return `data:image/jpeg;base64,part${browser.captures.length}`;
      },
    },
  };
  const sandbox = vm.createContext({ window: {}, chrome, DOMException, setTimeout: (done) => setImmediate(done) });
  for (const script of captureScripts) vm.runInContext(script, sandbox);
  browser.api = sandbox.window.MyLocalAIFullPage;
  browser.tab = { id: 7, windowId: 3 };
  return browser;
}

function snapshot(browser, elements) {
  const scroller = browser.page.window.__myLocalAiFullPage.scroller;
  const [glow] = browser.overlays;
  return {
    top: scroller.scrollTop,
    styles: elements.map((el) => el.getAttribute("style")),
    glow: glow && { visibility: glow.style.visibility, text: glow.children[0].textContent },
  };
}

export const scrollingRoot = (scrollHeight, clientHeight = 800) => new FakeElement({ clientHeight, scrollHeight });
