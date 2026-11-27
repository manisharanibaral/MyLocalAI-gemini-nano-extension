import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { scriptPaths, sidebarJs, stylePaths } from "./helpers/sources.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "ignore" });

function loadConfig(path) {
  const sandbox = { window: {} };
  vm.runInNewContext(read(path), sandbox);
  // Round-trip through JSON so arrays from the vm realm compare with deepEqual.
  return JSON.parse(JSON.stringify(sandbox.window.MYLOCALAI_CONFIG));
}

const expected = {
  nano: { backends: ["nano"], hosts: false },
  ollama: { backends: ["ollama"], hosts: true },
  mixed: { backends: ["nano", "ollama"], hosts: true },
  "firebase-hybrid": { backends: ["firebase"], hosts: true },
};

const names = new Set();
for (const [edition, { backends, hosts }] of Object.entries(expected)) {
  const dir = `dist/mylocalai-${edition}/`;
  const manifest = JSON.parse(read(`${dir}manifest.json`));

  assert.deepEqual(loadConfig(`${dir}config.js`).backends, backends, `${edition} config backends`);
  assert.equal(Boolean(manifest.host_permissions?.length), hosts, `${edition} host_permissions`);
  assert.equal(manifest.side_panel.default_path, "sidebar.html");
  for (const file of ["sidebar.html", ...scriptPaths.filter((path) => path !== "config.js"), ...stylePaths, "background.js", "page-watch.js", "icons/icon128.png"]) {
    assert.ok(existsSync(new URL(`${dir}${file}`, root)), `${edition} should ship ${file}`);
  }
  names.add(manifest.name);
}
assert.equal(names.size, Object.keys(expected).length, "each edition needs a distinct name so they can be installed side by side");

// The root folder must stay loadable as the mixed edition.
assert.deepEqual(loadConfig("config.js").backends, ["nano", "ollama"], "root config.js is the mixed edition");
const html = read("sidebar.html");
assert.ok(html.indexOf('src="config.js"') < html.indexOf('src="sidebar/'), "config.js must load before the sidebar scripts");

assert.match(sidebarJs, /if\s*\(\s*nanoEnabled\s*\)\s*\{\s*try\s*\{\s*await initNanoSession\(\)/, "Nano init gated by config");
assert.match(sidebarJs, /if\s*\(\s*ollamaEnabled\s*\)\s*\{\s*try\s*\{\s*await initOllamaSession\(\)/, "Ollama init gated by config");

console.log("Edition checks passed");
