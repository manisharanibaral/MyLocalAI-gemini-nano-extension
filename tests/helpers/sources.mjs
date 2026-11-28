// Reads source files for the tests. sidebar.html is the single list of what the panel loads, so
// the tests follow it: adding or moving a file there needs no change here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), "utf8");

export const sidebarHtml = read("sidebar.html");

// Local files loaded by sidebar.html, in load order.
export const scriptPaths = [...sidebarHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
export const stylePaths = [...sidebarHtml.matchAll(/<link rel="stylesheet" href="(?!https?:)([^"]+)"/g)].map((m) => m[1]);

// The panel app: the classic scripts in sidebar/ share one scope, so tests treat them as one source.
export const sidebarPaths = scriptPaths.filter((path) => path.startsWith("sidebar/"));
export const sidebarJs = sidebarPaths.map(read).join("\n");
export const sidebarCss = stylePaths.map(read).join("");

function declarationOf(source, name) {
  const match = new RegExp(`(async )?function ${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} should exist`);
  return match;
}

// Index just past the brace that closes the one at braceStart.
function endOfBlock(source, braceStart, name) {
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return i + 1;
  }
  throw new Error(`Could not parse ${name}`);
}

// The code between a function's braces, for static checks.
export function functionBody(source, name) {
  const braceStart = source.indexOf("{", declarationOf(source, name).index);
  return source.slice(braceStart + 1, endOfBlock(source, braceStart, name) - 1);
}

// A whole function declaration, so a test can run it with stubbed surroundings.
export function functionSource(source, name) {
  const { index } = declarationOf(source, name);
  // ") {" skips default values such as `options = {}` in the parameter list.
  const braceStart = source.indexOf(") {", index) + 2;
  return source.slice(index, endOfBlock(source, braceStart, name));
}
