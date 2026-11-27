#!/usr/bin/env node
/**
 * Installs the CEP panel into the per-user CEP extensions folder.
 *
 *   %APPDATA%\Adobe\CEP\extensions\com.mcpbridge.ae
 *
 * Copying (rather than linking) keeps the extension self-contained: the panel ships its own copy of
 * the generated command library, because ExtendScript cannot load files from outside the extension.
 * A `.debug` file is written next to the manifest so CEP loads this unsigned extension; no registry
 * change and no admin rights are involved.
 *
 * Run again after changing the panel or the command library: `npm run install-cep`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, "cep");
const LIBRARY = path.join(HERE, "src", "scripts", "ae-commands.jsx");
const EXTENSION_ID = "com.mcpbridge.ae";

const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const target = path.join(appData, "Adobe", "CEP", "extensions", EXTENSION_ID);

if (!fs.existsSync(LIBRARY)) {
  console.error("src/scripts/ae-commands.jsx is missing — run `npm run build:commands` first.");
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(SOURCE, target, { recursive: true });
fs.mkdirSync(path.join(target, "jsx"), { recursive: true });
fs.copyFileSync(LIBRARY, path.join(target, "jsx", "ae-commands.jsx"));
// Marks the extension as debuggable so CEP loads it without a signature.
fs.writeFileSync(path.join(target, ".debug"), "");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(target, full));
  }
})(target);

console.log(`Installed the AFbridge MCP panel to:\n  ${target}\n`);
console.log(`Files: ${files.length}`);
for (const file of files) console.log(`  ${file}`);
console.log(`
Next:
  1. Restart After Effects (or reload the extension: Window > Extensions > AFbridge MCP).
  2. Open the panel: Window > Extensions > AFbridge MCP.
  3. It registers with the bridge as "AFbridge MCP" (id after-effects-panel) and waits for approval.
  4. Approve it in the bridge panel (Applications), then its tools appear in /api/tools and /mcp.

The bridge connector must be running:  cd ../mcp-bridge && node scripts/mcp.mjs up
`);
