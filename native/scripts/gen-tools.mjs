#!/usr/bin/env node
/**
 * Regenerates src/tools.json — the tool catalogue that main.rs embeds with include_str!.
 *
 * The After Effects tools are defined by the CEP panel, not by this crate, so the catalogue is read
 * from the bridge's /api/tools rather than copied by hand. Run it only when the tool set changes:
 *
 *   node native/scripts/gen-tools.mjs
 *
 * Requires the bridge (node scripts/mcp.mjs up in mcp-bridge) and the panel open and approved.
 * Output is sorted by name and written with two-space indentation, so an unchanged tool set
 * regenerates a byte-identical file and produces an empty diff.
 *
 *   --port <n>     bridge port (default 7800)
 *   --base <url>   full bridge URL, overrides --port and $AFBRIDGE_BASE
 *   --out <path>   output file, relative to native/ (default src/tools.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

// AFBRIDGE_BASE only, exactly like main.rs: a stray PORT in the caller's shell must not point this
// at some unrelated service.
const port = option("--port", "7800");
const base = option("--base", process.env.AFBRIDGE_BASE || `http://127.0.0.1:${port}`);
const out = path.resolve(ROOT, option("--out", path.join("src", "tools.json")));
const url = `${base.replace(/\/+$/, "")}/api/tools`;

let payload;
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  payload = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
} catch (error) {
  console.error(`Could not read ${url}: ${error.message}`);
  console.error("Start the bridge (node scripts/mcp.mjs up) and open the AFbridge MCP panel in After Effects,");
  console.error("then approve it under Applications — the tool list comes from the panel, not from this repo.");
  process.exit(1);
}

const rows = Array.isArray(payload) ? payload : (payload.tools ?? []);
if (rows.length === 0) {
  console.error(`No tools at ${url}. Is the panel open and approved?`);
  process.exit(1);
}

const tools = rows
  .map((tool) => ({
    name: tool.toolName || String(tool.exposedName || "").split("__").pop(),
    description: tool.description || "",
    inputSchema: tool.inputSchema || { type: "object", properties: {} },
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

if (tools.some((tool) => !tool.name)) {
  console.error("A tool came back without a name; refusing to write a broken catalogue.");
  process.exit(1);
}

fs.writeFileSync(out, `${JSON.stringify(tools, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, out)} — ${tools.length} tools from ${url}`);
if (tools.length !== 27) {
  console.warn(`note: the panel now publishes ${tools.length} tools (it was 27 when the binary was verified)`);
}
