// Static checks over source files (no browser). The checks are grouped by topic in
// tests/regression/; a failing assertion in any of them fails this script.
import "./regression/core.mjs";
import "./regression/responses.mjs";
import "./regression/screenshots-and-context.mjs";
import "./regression/settings-and-switcher.mjs";

console.log("Regression checks passed");
