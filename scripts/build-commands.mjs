/**
 * Builds `src/scripts/ae-commands.jsx` from the ScriptUI panel.
 *
 * The command implementations live in `mcp-bridge-auto.jsx`, which also builds a ScriptUI window and
 * starts a file-polling loop when it loads. A CEP panel cannot load that file (it would open a second
 * floating window and start a second poller), and copying ~1500 lines of AE logic would create two
 * divergent copies. So the top-level command functions are extracted verbatim into a UI-free library
 * with a small `mcpRunCommand(name, args)` entry point, and both clients use that one implementation:
 *
 *   ScriptUI panel  → mcp-bridge-auto.jsx (unchanged, talks to the file bridge)
 *   CEP panel       → ae-commands.jsx (talks to the WebSocket bridge connector)
 *
 * The panel file interleaves UI construction between function definitions, so blocks are taken by
 * name rather than by line range. Run with `npm run build:commands`; the generated file is committed
 * so the CEP installer needs no build step.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.join(ROOT, "src", "scripts", "mcp-bridge-auto.jsx");
const TARGET = path.join(ROOT, "src", "scripts", "ae-commands.jsx");

/** Tool name (what the bridge and model see) → the command implementation it runs. */
const COMMANDS = {
  "get-project-info": "getProjectInfo()",
  "list-compositions": "listCompositions()",
  "get-layer-info": "getLayerInfo()",
  "create-composition": "createComposition(args)",
  "create-text-layer": "createTextLayer(args)",
  "create-shape-layer": "createShapeLayer(args)",
  "create-solid-layer": "createSolidLayer(args)",
  "create-camera": "createCamera(args)",
  duplicate: "duplicateLayer(args)",
  "delete-layer": "deleteLayer(args)",
  "set-layer-mask": "setLayerMask(args)",
  "set-layer-properties": "setLayerProperties(args)",
  "batch-set-layer-properties": "batchSetLayerProperties(args)",
  "set-layer-keyframe": "setLayerKeyframe(args.compIndex, args.layerIndex, args.propertyName, args.timeInSeconds, args.value)",
  "set-layer-expression": "setLayerExpression(args.compIndex, args.layerIndex, args.propertyName, args.expressionString)",
  "set-composition-properties": "setCompositionProperties(args)",
  "apply-effect": "applyEffect(args)",
  "apply-effect-template": "applyEffectTemplate(args)",
  "run-script-file": "runScriptFile(args)",
  "test-bridge-effects": "bridgeTestEffects(args)",
};

/**
 * Functions the CEP panel must not ship: the ScriptUI shell, the entry point this library replaces,
 * and the helpers that only serve its file-polling loop (`getCommandFilePath`, `getResultFilePath`,
 * `isoNowString`). No command reaches them.
 */
const EXCLUDED = new Set([
  "executeCommand",
  "logToPanel",
  "updateCommandStatus",
  "checkForCommands",
  "startCommandChecker",
  "getCommandFilePath",
  "getResultFilePath",
  "isoNowString",
]);

/**
 * Splits the source into top-level function blocks by brace depth, ignoring braces inside strings
 * and comments (a JSON string in the panel code would otherwise end a block early).
 */
function extractFunctions(source) {
  const lines = source.split(/\r?\n/);
  const blocks = new Map();
  let current = null;
  let depth = 0;
  let name = "";

  const scan = (line) => {
    let inString = null;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (inString) {
        if (char === "\\") i += 1;
        else if (char === inString) inString = null;
        continue;
      }
      if (char === "/" && next === "/") break;
      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
  };

  for (const line of lines) {
    if (!current) {
      const match = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
      if (!match) continue;
      name = match[1];
      current = [line];
      depth = 0;
      scan(line);
      if (depth === 0 && line.includes("}")) {
        blocks.set(name, current.join("\n"));
        current = null;
      }
      continue;
    }
    current.push(line);
    scan(line);
    if (depth === 0) {
      blocks.set(name, current.join("\n"));
      current = null;
    }
  }
  if (current) throw new Error(`unbalanced braces while reading function ${name}`);
  return blocks;
}

const source = fs.readFileSync(SOURCE, "utf8");
const blocks = extractFunctions(source);

const missing = Object.values(COMMANDS)
  .map((call) => /^([A-Za-z_$][\w$]*)\(/.exec(call)?.[1])
  .filter((fn) => fn && !blocks.has(fn));
if (missing.length) {
  throw new Error(`mcp-bridge-auto.jsx no longer defines: ${[...new Set(missing)].join(", ")}`);
}

const selected = [...blocks.entries()].filter(([fn]) => !EXCLUDED.has(fn));
const uiLeak = selected.filter(([, body]) => /new Window\(|\.add\("(button|statictext|checkbox|edittext)"/.test(body));
if (uiLeak.length) {
  throw new Error(`ScriptUI construction leaked into: ${uiLeak.map(([fn]) => fn).join(", ")}`);
}

const body = selected.map(([, code]) => code).join("\n\n");

const entries = Object.entries(COMMANDS)
  .map(([toolName, call]) => `    ${JSON.stringify(toolName)}: function (args) { return ${call}; },`)
  .join("\n");

const output = `// ae-commands.jsx — GENERATED by scripts/build-commands.mjs, do not edit by hand.
//
// After Effects command implementations shared by the ScriptUI panel and the CEP panel. The CEP panel
// loads this file with $.evalFile() and calls mcpRunCommand(name, args); the ScriptUI panel keeps its
// own copy inline and is unaffected.

(function (host) {
  "use strict";

  // Supplied by the ScriptUI panel; no-ops here because the CEP panel has its own log.
  function logToPanel() {}

  var aeVersion = parseFloat(app.version);
  var isAE2025OrLater = aeVersion >= 25.0;

${body}

  var COMMANDS = {
${entries}
  };

  /**
   * Runs one After Effects command and returns its JSON string.
   * @param {string} name tool name as announced to the bridge, e.g. "create-composition"
   * @param {object} args tool arguments
   */
  host.mcpRunCommand = function (name, args) {
    var run = COMMANDS[name];
    if (!run) return JSON.stringify({ ok: false, error: "Unknown After Effects command: " + name });
    var result = run(args || {});
    if (result === undefined || result === null) return JSON.stringify({ ok: true });
    return String(result);
  };
})(this);
`;

fs.writeFileSync(TARGET, output, "utf8");
console.log(
  `wrote ${path.relative(ROOT, TARGET)} — ${output.split(/\r?\n/).length} lines, ` +
    `${selected.length} functions, ${Object.keys(COMMANDS).length} tools`,
);
