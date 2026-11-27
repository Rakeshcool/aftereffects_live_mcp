#!/usr/bin/env node
/**
 * Guard against the zod install that makes `tsc` collapse.
 *
 * The MCP SDK declares `zod: "^3.25 || ^4.0"`. Against an older zod -- or with a
 * second zod copy nested inside the SDK, so that src/ and the SDK's .d.ts see
 * different type graphs -- its `tool()` overloads never resolve. Every single
 * registration reports TS2589 and costs 8-30 s, and a file with a handful of
 * tools exhausts the heap ("Ineffective mark-compacts near heap limit", exit
 * 134) minutes later, which looks like a broken Node install.
 *
 * This runs in milliseconds and prints what is wrong instead.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIREMENT = "^3.25 || ^4.0";
const SUGGESTED_MINIMUM = "3.25.76";
const ROOT = join(process.cwd(), "node_modules");

function versionAt(dir) {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function supported(version) {
  const [major, minor] = version.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major >= 4 || (major === 3 && minor >= 25);
}

function fail(lines) {
  process.stderr.write(["\n\u2716 zod check failed\n", ...lines, ""].join("\n") + "\n");
  process.exit(1);
}

const top = versionAt(join(ROOT, "zod"));

if (!top) {
  fail([
    "  node_modules/zod is missing.",
    "",
    "  Run:  npm install",
  ]);
}

// Any nested copy is a second, independent set of zod types. Even a supported
// version there is fatal: src/index.ts resolves one copy and the SDK's
// declarations resolve the other.
const nested = [];
if (existsSync(ROOT)) {
  for (const entry of readdirSync(ROOT)) {
    if (entry.startsWith(".")) continue;
    const owners = entry.startsWith("@")
      ? readdirSync(join(ROOT, entry))
          .filter((inner) => !inner.startsWith("."))
          .map((inner) => join(entry, inner))
      : [entry];
    for (const owner of owners) {
      const version = versionAt(join(ROOT, owner, "node_modules", "zod"));
      if (version) nested.push({ owner, version });
    }
  }
}

if (!supported(top)) {
  fail([
    `  Installed: node_modules/zod -> ${top}`,
    `  Required:  ${REQUIREMENT}   (@modelcontextprotocol/sdk peer dependency)`,
    "",
    "  Type-checking against this version fails inside the SDK's tool() generics:",
    "  every registration reports TS2589 and the compiler aborts with",
    '  "JavaScript heap out of memory" (exit 134) after minutes of GC.',
    "",
    `  Fix:  npm install zod@^${SUGGESTED_MINIMUM}`,
  ]);
}

if (nested.length > 0) {
  fail([
    `  Duplicate zod: node_modules/zod -> ${top}`,
    ...nested.map(({ owner, version }) => `                 ${join("node_modules", owner, "node_modules", "zod").replaceAll("\\", "/")} -> ${version}`),
    "",
    "  src/ and the SDK's declarations then resolve different copies, so the",
    "  SDK's schema generics never resolve and tsc dies with TS2589",
    '("Type instantiation is excessively deep") and then a heap OOM, exit 134.',
    "",
    `  Fix:  npm dedupe && npm install zod@^${SUGGESTED_MINIMUM}`,
  ]);
}

process.stdout.write(`zod ${top} ok (${REQUIREMENT})\n`);
