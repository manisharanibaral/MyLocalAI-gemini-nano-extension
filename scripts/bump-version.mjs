#!/usr/bin/env node
/**
 * Bumps the patch version in manifest.json (1.1.0 → 1.1.1).
 * Called by .githooks/pre-commit on every second commit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const [major, minor, patch] = manifest.version.split(".").map(Number);
manifest.version = `${major}.${minor}.${patch + 1}`;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json version → ${manifest.version}`);
