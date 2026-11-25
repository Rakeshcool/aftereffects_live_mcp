import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { fileURLToPath } from 'url';

// Create an MCP server
const server = new McpServer({
  name: "AfterEffectsServer",
  version: "1.1.0"
});

// ES Modules replacement for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define paths
const SCRIPTS_DIR = path.join(__dirname, "scripts");

// Resolve the folder the AE panel calls Folder.myDocuments. On Windows it is
// commonly redirected (OneDrive, enterprise profile), while os.homedir() +
// "Documents" is not: the panel would read one file while the server watched
// another, and every command would sit unexecuted.
function getDocumentsDir(): string {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    // The shell folder is the only authoritative source for a redirect.
    try {
      const out = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 }
      );
      const match = out.match(/Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
      if (match) {
        candidates.push(match[1].trim().replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? `%${name}%`));
      }
    } catch {
      // Registry unavailable: fall back to the well-known layouts below.
    }
    // Usual redirect target when the registry cannot be read.
    candidates.push(path.join(os.homedir(), 'OneDrive', 'Documents'));
  }

  candidates.push(path.join(os.homedir(), 'Documents'));

  for (const dir of candidates) {
    // An unexpanded %VAR% cannot exist on disk; skip it rather than stat it.
    if (dir && !dir.includes('%') && fs.existsSync(dir)) return dir;
  }
  return candidates[candidates.length - 1];
}

// Get the correct directory for AE bridge files
// Use <Documents>/ae-mcp-bridge for reliable cross-process access
function getAETempDir(): string {
  const bridgeDir = path.join(getDocumentsDir(), 'ae-mcp-bridge');
  // Ensure the directory exists
  if (!fs.existsSync(bridgeDir)) {
    fs.mkdirSync(bridgeDir, { recursive: true });
  }
  return bridgeDir;
}

// Wait for the panel to write a *new* result file. Freshness is detected by
// modification time rather than by the _commandExecuted marker: older panels
// write results without stamping them, and a stale file must never be returned
// as this command's output. Returns null on timeout.
async function waitForFreshResult(timeoutMs = 20000, pollMs = 250): Promise<string | null> {
  const resultPath = path.join(getAETempDir(), 'ae_mcp_result.json');
  const baseline = fs.existsSync(resultPath) ? fs.statSync(resultPath).mtimeMs : 0;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    if (!fs.existsSync(resultPath)) continue;
    if (fs.statSync(resultPath).mtimeMs > baseline) {
      // give the writer a moment to finish before reading
      await new Promise(r => setTimeout(r, 50));
      return fs.readFileSync(resultPath, 'utf8');
    }
  }
  return null;
}

// Path of the bridge's single command slot.
function getCommandFilePath(): string {
  return path.join(getAETempDir(), 'ae_command.json');
}

// Helper function to write command to file
function writeCommandFile(command: string, args: Record<string, any> = {}): void {
  try {
    const commandFile = getCommandFilePath();
    const commandData = {
      command,
      args,
      timestamp: new Date().toISOString(),
      status: "pending"  // pending, running, completed, error
    };
    fs.writeFileSync(commandFile, JSON.stringify(commandData, null, 2));
    console.error(`Command "${command}" written to ${commandFile}`);
  } catch (error) {
    console.error("Error writing command file:", error);
  }
}

// Helper function to clear the results file to avoid stale cache
function clearResultsFile(): void {
  try {
    const resultFile = path.join(getAETempDir(), 'ae_mcp_result.json');

    // Write a placeholder message to indicate the file is being reset
    const resetData = {
      status: "waiting",
      message: "Waiting for new result from After Effects...",
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(resultFile, JSON.stringify(resetData, null, 2));
    console.error(`Results file cleared at ${resultFile}`);
  } catch (error) {
    console.error("Error clearing results file:", error);
  }
}

type ToolResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function textResult(text: string, isError = false): ToolResponse {
  return { content: [{ type: "text", text }], isError };
}

// After Effects reports its own failures inside the result payload ({"status":"error",…}
// or {"success":false,…}). Surface those as tool errors, so a client is not told that a
// command succeeded when After Effects refused it.
function isBridgeError(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as { status?: unknown; success?: unknown; error?: unknown };
    return parsed.status === "error" || parsed.success === false || typeof parsed.error === "string";
  } catch {
    return false;
  }
}

// How long a command may take before its tool gives up. Edit commands answer in
// seconds; a render blocks the panel until the render queue finishes, so it gets a
// budget measured in minutes instead of the default.
const DEFAULT_RESULT_TIMEOUT_MS = 20000;
const RENDER_RESULT_TIMEOUT_MS = 30 * 60 * 1000;

function waitLabel(timeoutMs: number): string {
  return timeoutMs >= 60000 ? `${Math.round(timeoutMs / 60000)} min` : `${Math.round(timeoutMs / 1000)} s`;
}

// The file bridge has one command slot and the panel runs only a command whose status is
// "pending". A second write while the first command is queued or running makes the panel
// stamp the replacement "completed" without running it, so calls take the slot in turn.
let bridgeSlot: Promise<void> = Promise.resolve();

class BridgeBusyError extends Error {}

async function withBridgeSlot<T>(body: () => Promise<T>): Promise<T> {
  const previous = bridgeSlot;
  let release: () => void = () => {};
  bridgeSlot = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await waitForIdleSlot();
    return await body();
  } finally {
    release();
  }
}

// A command still pending or running belongs to someone else (a call from a process that has
// since exited, or a manual run). Waiting covers the moment the panel needs to stamp its last
// command completed; after that the call is refused rather than overwriting that command.
async function waitForIdleSlot(timeoutMs: number = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let status: unknown = null;
    try {
      status = (JSON.parse(fs.readFileSync(getCommandFilePath(), "utf8")) as { status?: unknown }).status;
    } catch {
      return; // no command file yet
    }
    if (status !== "pending" && status !== "running") return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new BridgeBusyError(
    "After Effects still has a command it has not finished. This call was not sent, so that " +
    "command was not overwritten: nothing was lost. Retry once the panel is idle.",
  );
}

// Queue one command and wait for its own result. One tool call used to be two
// (queue, then get-results), which leaked the previous command's payload
// whenever the caller skipped the second step and made the tools look
// indistinguishable. Every tool below returns the output of the call it made.
async function runBridgeTool(
  command: string,
  args: Record<string, unknown>,
  timeoutMs: number = DEFAULT_RESULT_TIMEOUT_MS,
): Promise<ToolResponse> {
  let result: string | null;
  try {
    result = await withBridgeSlot(async () => {
      clearResultsFile();
      writeCommandFile(command, args);
      return waitForFreshResult(timeoutMs, 250);
    });
  } catch (error) {
    if (error instanceof BridgeBusyError) return textResult(error.message, true);
    throw error;
  }
  if (result === null) {
    return textResult(
      `No result after ${waitLabel(timeoutMs)}. The panel is probably not open in After Effects ` +
      `(Window > Extensions > MCP Bridge, or Window > mcp-bridge-auto.jsx with "Auto-run commands" ` +
      `checked), a dialog is blocking it, or the command is still running. ` +
      `Command and result files are in ${getAETempDir()}.`,
      true,
    );
  }
  return textResult(result, isBridgeError(result));
}

// Add a resource to expose project compositions
server.resource(
  "compositions",
  "aftereffects://compositions",
  async (uri) => {
    let result: string | null;
    try {
      result = await withBridgeSlot(async () => {
        clearResultsFile();
        writeCommandFile("listCompositions", {});
        return waitForFreshResult(6000, 250);
      });
    } catch (error) {
      if (!(error instanceof BridgeBusyError)) throw error;
      result = JSON.stringify({ error: error.message });
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: result ?? JSON.stringify({ error: "No result from After Effects." }),
      }],
    };
  }
);

// Add prompts for common After Effects tasks
server.prompt(
  "list-compositions",
  "List compositions in the current After Effects project",
  () => {
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Please list all compositions in the current After Effects project."
        }
      }]
    };
  }
);

server.prompt(
  "analyze-composition",
  {
    compositionName: z.string().describe("Name of the composition to analyze")
  },
  (args) => {
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please analyze the composition named "${args.compositionName}" in the current After Effects project. Provide details about its duration, frame rate, resolution, and layers.`
        }
      }]
    };
  }
);

server.prompt(
  "create-composition",
  "Create a new composition with specified settings",
  () => {
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please create a new composition with custom settings. You can specify parameters like name, width, height, frame rate, etc.`
        }
      }]
    };
  }
);

// ---------------------------------------------------------------------------
// Tool surface
//
// Every tool is kebab-case and named after the After Effects command it runs,
// the same names the CEP panel announces, so a name maps one-to-one to a
// capability. There is exactly one tool per capability: the former duplicate
// pairs (apply-effect vs mcp_aftereffects_applyEffect, get-help vs the effects
// help) and the debug-only tools (run-bridge-test, test-animation) are gone.
// ---------------------------------------------------------------------------

const COMPOSITION = z.string().optional().describe(
  "Composition name, exactly as list-compositions reports it. Omit to use the composition open in the viewer."
);
const COMPOSITION_INDEX = z.number().int().positive().optional().describe(
  "Project item index of the composition, as list-compositions reports it. Use compName unless you only have the index."
);
const LAYER_INDEX = z.number().int().positive().optional().describe("1-based layer index, as get-layer-info reports it.");
const LAYER_NAME = z.string().optional().describe("Layer name, exactly as get-layer-info reports it.");

// --- Read ---

server.tool(
  "get-project-info",
  "Report the open After Effects project: name, path, item counts (compositions, footage, folders, solids), the active composition, and the first 50 project items.",
  {},
  async () => runBridgeTool("getProjectInfo", {})
);

server.tool(
  "list-compositions",
  "List every composition in the project with its index, name, dimensions, duration, frame rate and layer count. Start here to learn the compName and compIndex the other tools take.",
  {},
  async () => runBridgeTool("listCompositions", {})
);

server.tool(
  "get-layer-info",
  "List the layers of a composition (index, name, match name, visibility, 3D and adjustment flags, timing, parent, position, effect count), or describe one layer when layerIndex or layerName is given. Text layers also report their source text.",
  {
    compName: COMPOSITION,
    compIndex: COMPOSITION_INDEX,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME
  },
  async (args) => runBridgeTool("getLayerInfo", args)
);

server.tool(
  "get-property-value",
  "Read one property: its value (at timeInSeconds, default the composition's current time), its expression, and its first 100 keyframes. Accepts a plain name ('Position') or a slash path ('Transform/Position', 'Effects/Gaussian Blur/Blurriness').",
  {
    compName: COMPOSITION,
    compIndex: COMPOSITION_INDEX,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME,
    propertyName: z.string().describe("Property name or slash-separated path, e.g. 'Opacity' or 'Transform/Position'."),
    timeInSeconds: z.number().optional().describe("Time to sample at. Defaults to the composition's current time.")
  },
  async (args) => runBridgeTool("getPropertyValue", args)
);

// --- Compositions ---

server.tool(
  "create-composition",
  "Create a new composition and return its resulting settings.",
  {
    name: z.string().describe("Name of the composition"),
    width: z.number().int().positive().optional().describe("Width in pixels (default 1920)"),
    height: z.number().int().positive().optional().describe("Height in pixels (default 1080)"),
    pixelAspect: z.number().positive().optional().describe("Pixel aspect ratio (default 1.0)"),
    duration: z.number().positive().optional().describe("Duration in seconds (default 10)"),
    frameRate: z.number().positive().optional().describe("Frame rate in frames per second (default 30)"),
    backgroundColor: z.object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255)
    }).optional().describe("Background colour as 0-255 RGB")
  },
  async (args) => runBridgeTool("createComposition", args)
);

server.tool(
  "set-composition-properties",
  "Change a composition's duration, frame rate, or dimensions (width and height together).",
  {
    compName: COMPOSITION,
    duration: z.number().positive().optional().describe("New duration in seconds"),
    frameRate: z.number().positive().optional().describe("New frame rate in frames per second"),
    width: z.number().int().positive().optional().describe("New width in pixels; requires height"),
    height: z.number().int().positive().optional().describe("New height in pixels; requires width")
  },
  async (args) => runBridgeTool("setCompositionProperties", args)
);

// --- Layers ---

server.tool(
  "create-text-layer",
  "Add a text layer to a composition.",
  {
    compName: COMPOSITION,
    text: z.string().optional().describe("Text content (default 'Text Layer')"),
    position: z.array(z.number()).length(2).optional().describe("[x, y] position in pixels"),
    fontSize: z.number().positive().optional().describe("Font size in pixels (default 72)"),
    color: z.array(z.number()).length(3).optional().describe("[r, g, b] fill colour, 0-1"),
    fontFamily: z.string().optional().describe("Font family (default 'Arial')"),
    alignment: z.enum(["left", "center", "right"]).optional().describe("Paragraph justification (default 'center')"),
    startTime: z.number().optional().describe("Layer start time in seconds"),
    duration: z.number().min(0).optional().describe("Layer duration in seconds (default 5); 0 keeps the composition duration")
  },
  async (args) => runBridgeTool("createTextLayer", args)
);

server.tool(
  "create-shape-layer",
  "Add a shape layer (rectangle, ellipse, polygon or star) to a composition.",
  {
    compName: COMPOSITION,
    shapeType: z.enum(["rectangle", "ellipse", "polygon", "star"]).describe("Shape to draw"),
    position: z.array(z.number()).length(2).optional().describe("[x, y] position in pixels"),
    size: z.array(z.number()).length(2).optional().describe("[width, height] in pixels for a rectangle or ellipse, or the outer diameter for a polygon or star (default [200, 200])"),
    fillColor: z.array(z.number()).length(3).optional().describe("[r, g, b] fill colour, 0-1"),
    strokeColor: z.array(z.number()).length(3).optional().describe("[r, g, b] stroke colour, 0-1"),
    strokeWidth: z.number().min(0).optional().describe("Stroke width in pixels; 0 means no stroke"),
    points: z.number().int().min(3).optional().describe("Number of points for polygon or star (default 5)"),
    name: z.string().optional().describe("Layer name (default 'Shape Layer')"),
    startTime: z.number().optional().describe("Layer start time in seconds"),
    duration: z.number().min(0).optional().describe("Layer duration in seconds (default 5); 0 keeps the composition duration")
  },
  async (args) => runBridgeTool("createShapeLayer", args)
);

server.tool(
  "create-solid-layer",
  "Add a solid layer to a composition, optionally as an adjustment layer.",
  {
    compName: COMPOSITION,
    name: z.string().optional().describe("Layer name (default 'Solid Layer')"),
    color: z.array(z.number()).length(3).optional().describe("[r, g, b] colour, 0-1"),
    size: z.array(z.number()).length(2).optional().describe("[width, height] in pixels; defaults to the composition size"),
    position: z.array(z.number()).length(2).optional().describe("[x, y] position in pixels"),
    isAdjustment: z.boolean().optional().describe("Create an adjustment layer instead of a solid"),
    startTime: z.number().optional().describe("Layer start time in seconds"),
    duration: z.number().min(0).optional().describe("Layer duration in seconds (default 5); 0 keeps the composition duration")
  },
  async (args) => runBridgeTool("createSolidLayer", args)
);

server.tool(
  "create-camera",
  "Add a camera layer to a composition.",
  {
    compName: COMPOSITION,
    name: z.string().optional().describe("Camera name (default 'Camera')"),
    zoom: z.number().positive().optional().describe("Zoom in pixels (default 1777.78, about 50mm)"),
    position: z.array(z.number()).length(3).optional().describe("[x, y, z] camera position"),
    pointOfInterest: z.array(z.number()).length(3).optional().describe("[x, y, z] point of interest; not set when oneNode is true"),
    oneNode: z.boolean().optional().describe("Turn auto-orientation off. A scripted camera always keeps a Point of Interest (After Effects cannot script a one-node camera), so pointOfInterest is then left at its default")
  },
  async (args) => runBridgeTool("createCamera", args)
);

server.tool(
  "duplicate-layer",
  "Duplicate a layer, optionally renaming the copy.",
  {
    compName: COMPOSITION,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME,
    newName: z.string().optional().describe("Name for the duplicated layer")
  },
  async (args) => runBridgeTool("duplicateLayer", args)
);

server.tool(
  "delete-layer",
  "Delete a layer from a composition.",
  {
    compName: COMPOSITION,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME
  },
  async (args) => runBridgeTool("deleteLayer", args)
);

server.tool(
  "set-layer-properties",
  "Set transform, text, timing or blending properties on one layer.",
  {
    compName: COMPOSITION,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME,
    position: z.array(z.number()).min(2).max(3).optional().describe("[x, y] or [x, y, z] position. Clears position keyframes."),
    scale: z.array(z.number()).length(2).optional().describe("[width, height] scale where 100 is 100%"),
    rotation: z.number().optional().describe("Rotation in degrees (Z rotation on a 3D layer)"),
    opacity: z.number().min(0).max(100).optional().describe("Opacity as a percentage"),
    threeDLayer: z.boolean().optional().describe("Make the layer 3D or 2D"),
    trackMatteType: z.enum(["none", "alpha", "alphaInverted", "luma", "lumaInverted"]).optional().describe("Track matte mode"),
    blendMode: z.enum([
      "normal", "add", "multiply", "screen", "overlay", "softLight", "hardLight",
      "colorDodge", "colorBurn", "darken", "lighten", "difference", "exclusion",
      "hue", "saturation", "color", "luminosity"
    ]).optional().describe("Blending mode"),
    enabled: z.boolean().optional().describe("Show or hide the layer"),
    startTime: z.number().optional().describe("Layer start time in seconds"),
    duration: z.number().positive().optional().describe("Layer duration in seconds"),
    text: z.string().optional().describe("Source text (text layers only)"),
    fontFamily: z.string().optional().describe("Font family (text layers only)"),
    fontSize: z.number().positive().optional().describe("Font size in pixels (text layers only)"),
    fillColor: z.array(z.number()).length(3).optional().describe("[r, g, b] text fill colour, 0-1")
  },
  async (args) => runBridgeTool("setLayerProperties", args)
);

server.tool(
  "batch-set-layer-properties",
  "Apply position, scale, rotation, opacity, 3D, blend mode and timing changes to several layers in one call. Each operation needs layerIndex or layerName. Text, track matte, enabled and duration belong to set-layer-properties, not here.",
  {
    compName: COMPOSITION,
    operations: z.array(z.record(z.string(), z.unknown())).min(1).describe(
      "Array of { layerIndex | layerName, position?, scale?, rotation?, opacity?, threeDLayer?, blendMode?, startTime?, outPoint? }"
    )
  },
  async (args) => runBridgeTool("batchSetLayerProperties", args)
);

server.tool(
  "set-layer-mask",
  "Create a mask on a layer, or reshape and restyle an existing one when maskIndex is given. Either maskPath or maskRect is required; maskMode, maskFeather, maskOpacity, maskExpansion and maskName are applied to the same mask.",
  {
    compName: COMPOSITION,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME,
    maskIndex: z.number().int().positive().optional().describe("Existing mask to modify; omit to add a mask"),
    maskPath: z.array(z.array(z.number()).length(2)).optional().describe("Mask outline as [[x, y], ...] points"),
    maskRect: z.object({
      top: z.number(),
      left: z.number(),
      width: z.number(),
      height: z.number()
    }).optional().describe("Rectangular mask instead of maskPath"),
    maskMode: z.enum(["add", "subtract", "intersect", "none", "lighten", "darken", "difference"]).optional().describe("Mask mode (default 'add')"),
    maskFeather: z.array(z.number()).length(2).optional().describe("[x, y] feather in pixels"),
    maskOpacity: z.number().min(0).max(100).optional().describe("Mask opacity as a percentage"),
    maskExpansion: z.number().optional().describe("Mask expansion in pixels"),
    maskName: z.string().optional().describe("Rename the mask")
  },
  async (args) => runBridgeTool("setLayerMask", args)
);

// --- Animation ---

server.tool(
  "set-layer-keyframe",
  "Set a keyframe on a layer property at a given time, creating or replacing the key at that time. A property with no keyframes first gets one at the current time, so its current value is kept at the front. The property is matched by display name in Transform, then Effects, then Text (no slash paths).",
  {
    compIndex: z.number().int().positive().describe("Project item index of the composition, from list-compositions."),
    layerIndex: z.number().int().positive().describe("1-based layer index, from get-layer-info."),
    propertyName: z.string().describe("Property to keyframe, e.g. 'Position', 'Scale', 'Rotation', 'Opacity'."),
    timeInSeconds: z.number().describe("Time of the keyframe in seconds."),
    value: z.union([z.number(), z.array(z.number()), z.string(), z.boolean()]).describe("Keyframe value: [x, y] for Position, [w, h] for Scale, a number for Rotation or Opacity.")
  },
  async (args) => runBridgeTool("setLayerKeyframe", args)
);

server.tool(
  "delete-keyframe",
  "Remove the keyframe nearest a given time, or every keyframe on the property with all:true. Reports the time actually removed.",
  {
    compName: COMPOSITION,
    compIndex: COMPOSITION_INDEX,
    layerIndex: LAYER_INDEX,
    layerName: LAYER_NAME,
    propertyName: z.string().describe("Property holding the keyframes, e.g. 'Position' or 'Transform/Opacity'."),
    timeInSeconds: z.number().optional().describe("Target time; the nearest keyframe is removed. Omit when using all:true."),
    all: z.boolean().optional().describe("Remove every keyframe on the property")
  },
  async (args) => runBridgeTool("deleteKeyframe", args)
);

server.tool(
  "set-layer-expression",
  "Set or remove an expression on a layer property. Pass an empty string to remove the expression.",
  {
    compIndex: z.number().int().positive().describe("Project item index of the composition, from list-compositions."),
    layerIndex: z.number().int().positive().describe("1-based layer index, from get-layer-info."),
    propertyName: z.string().describe("Property to animate, e.g. 'Position' or 'Opacity'."),
    expressionString: z.string().describe("ExtendScript expression, or \"\" to remove it.")
  },
  async (args) => runBridgeTool("setLayerExpression", args)
);

// --- Effects ---

server.tool(
  "apply-effect",
  "Apply one effect to a layer. Effect match names are more reliable than display names (e.g. 'ADBE Gaussian Blur 2', 'ADBE Glow', 'ADBE Drop Shadow', 'ADBE HUE SATURATION', 'ADBE Fractal Noise').",
  {
    compIndex: z.number().int().positive().describe("Project item index of the composition, from list-compositions."),
    layerIndex: z.number().int().positive().describe("1-based layer index, from get-layer-info."),
    effectName: z.string().optional().describe("Display name, e.g. 'Gaussian Blur'."),
    effectMatchName: z.string().optional().describe("Internal match name, e.g. 'ADBE Gaussian Blur 2'. Takes precedence over effectName."),
    presetPath: z.string().optional().describe("Absolute path to an .ffx preset to apply instead."),
    effectSettings: z.record(z.string(), z.unknown()).optional().describe("Effect parameters keyed by property name, e.g. { 'Blurriness': 25 }.")
  },
  async (args) => runBridgeTool("applyEffect", args)
);

server.tool(
  "apply-effect-template",
  "Apply a named effect template (a preset group of effects and settings) to a layer.",
  {
    compIndex: z.number().int().positive().describe("Project item index of the composition, from list-compositions."),
    layerIndex: z.number().int().positive().describe("1-based layer index, from get-layer-info."),
    templateName: z.enum([
      "gaussian-blur",
      "directional-blur",
      "color-balance",
      "brightness-contrast",
      "curves",
      "glow",
      "drop-shadow",
      "cinematic-look",
      "text-pop"
    ]).describe("Template to apply."),
    customSettings: z.record(z.string(), z.unknown()).optional().describe("Overrides keyed by the template's own setting names, e.g. { blurriness } for gaussian-blur, { hue, lightness, saturation } for color-balance, { color, opacity, direction, distance, softness } for drop-shadow, { threshold, radius, intensity } for glow.")
  },
  async (args) => runBridgeTool("applyEffectTemplate", args)
);

// --- Output ---

server.tool(
  "render-composition",
  "Render a composition through the render queue, or write one PNG frame when frameAtTime is given. Reports the file that was actually written: the output module template decides the extension, so a requested .mov can land as .mp4.",
  {
    compName: COMPOSITION,
    compIndex: COMPOSITION_INDEX,
    outputPath: z.string().optional().describe("Output file path. Required for a still frame, where it must end in .png; for a render it is handed to the output module, which may adjust the name."),
    outputModuleTemplate: z.string().optional().describe("Installed output module template name, e.g. 'Lossless' or 'H.264'. Defaults to the project's default template, which the new render queue item starts with."),
    frameAtTime: z.number().optional().describe("Render just this time as a PNG instead of the whole composition.")
  },
  async (args) => runBridgeTool("renderComposition", args, RENDER_RESULT_TIMEOUT_MS)
);

// Escape hatch, deliberately separate: this runs code the caller wrote, so the
// bridge can grant or deny it on its own instead of hiding it in a whitelist.
server.tool(
  "run-script-file",
  "Escape hatch: run a .jsx/.jsxbin file from disk with full ExtendScript access and return its result. Prefer the typed tools above; use this only for something they cannot express.",
  {
    path: z.string().describe("Absolute path to a .jsx or .jsxbin file on the machine running After Effects")
  },
  async ({ path: scriptPath }) => {
    const filePath = path.resolve(scriptPath);
    if (!/\.jsx(bin)?$/i.test(filePath)) {
      return textResult(`Error: "${filePath}" is not a .jsx or .jsxbin file.`, true);
    }
    if (!fs.existsSync(filePath)) {
      return textResult(`Error: script not found at ${filePath}`, true);
    }
    return runBridgeTool("runScriptFile", { path: filePath });
  }
);

// Start the MCP server
async function main() {
  console.error("After Effects MCP Server starting...");
  console.error(`Scripts directory: ${SCRIPTS_DIR}`);
  console.error(`Bridge directory: ${getAETempDir()}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("After Effects MCP Server running...");
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
