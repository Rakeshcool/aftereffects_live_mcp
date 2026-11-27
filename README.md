# 🎬 AFbridge MCP — After Effects MCP Server

![Node.js](https://img.shields.io/badge/node-%3E=14.x-brightgreen.svg)
![Build](https://img.shields.io/badge/build-passing-success)
![License](https://img.shields.io/github/license/Rakeshcool/aftereffects_live_mcp)
![Platform](https://img.shields.io/badge/platform-after%20effects-blue)

✨ **AFbridge MCP** is a Model Context Protocol (MCP) server for Adobe After Effects that enables AI assistants and other applications to control After Effects through a standardized protocol.

The name appears everywhere you touch it: the AE panel and its **Window → Extensions → AFbridge MCP** menu entry, the panel header, the name it registers with the bridge, and `serverInfo.name` on the stdio server. The extension id `com.mcpbridge.ae` and the connector id `after-effects-panel` are unchanged on purpose — renaming either would make CEP treat the panel as a new extension and lose the bridge's approval and tool settings. The repo, npm package and script file names (`after-effects-mcp`, `mcp-bridge-auto.jsx`) also stay as they were.

![AFbridge MCP demo](assets/demo.gif)

## Table of Contents
- [Features](#features)
  - [Core Composition Features](#core-composition-features)
  - [Layer Management](#layer-management)
  - [Animation Capabilities](#animation-capabilities)
- [Setup Instructions](#setup-instructions)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Update MCP Config](#update-mcp-config)
  - [Running the Server](#running-the-server)
- [Usage Guide](#usage-guide)
  - [Creating Compositions](#creating-compositions)
  - [Working with Layers](#working-with-layers)
  - [Animation](#animation)
- [Available MCP Tools](#available-mcp-tools)
- [For Developers](#for-developers)
  - [Project Structure](#project-structure)
  - [Building the Project](#building-the-project)
  - [Contributing](#contributing)
- [License](#license)

## 📦 Features

### 🎥 Core Composition Features
- **Create compositions** with custom settings (size, frame rate, duration, background color)
- **List all compositions** in a project
- **Get project information** such as frame rate, dimensions, and duration

### 🧱 Layer Management
- **Create text layers** with customizable properties (font, size, color, position)
- **Create shape layers** (rectangle, ellipse, polygon, star) with colors and strokes
- **Create solid/adjustment layers** for backgrounds and effects
- **Create camera layers** with configurable zoom and position
- **Create null objects** for animation control
- **Modify layer properties** like position, scale, rotation, opacity, timing
- **Toggle 2D/3D mode** for layers
- **Set blend modes** (normal, multiply, screen, etc.)
- **Track matte** support (alpha, luma, inverted)
- **Duplicate layers** with optional rename
- **Delete layers** from composition
- **Create/modify masks** with feather, expansion, and opacity

### 🌀 Animation Capabilities
- **Set keyframes** for layer properties (Position, Scale, Rotation, Opacity, etc.)
- **Apply expressions** to layer properties for dynamic animations
- **Batch set properties** across multiple layers at once

## ⚙️ Setup Instructions

### 🛠 Prerequisites
- Adobe After Effects (2022 or later)
- Node.js (v18 or later; 20 or 22 recommended — the MCP SDK declares `node >= 18`, so 14 and 16 fail at startup)
- npm or yarn package manager
- For the CEP panel, the AFbridge MCP bridge from [`mcp-bridge`](../mcp-bridge): the panel connects to it, so it has to be installed and running
- In After Effects, enable **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network** (macOS: After Effects → Settings → Scripting & Expressions). Both panels execute ExtendScript from disk — the CEP panel loads its command library with `$.evalFile` — and tool calls fail until this is on.

### 📥 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Rakeshcool/aftereffects_live_mcp.git
   cd aftereffects_live_mcp
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Build the project**
   ```bash
   npm run build
   # or
   yarn build
   ```

4. **Install the After Effects panel**
   ```bash
   npm run install-bridge
   # or
   yarn install-bridge
   ```
   This will copy the necessary scripts to your After Effects installation.

5. **Install the CEP panel (recommended)**
   ```bash
   npm run install-cep
   ```
   The panel from step 4 is driven by the stdio server in this folder. The CEP panel is driven by the
   bridge instead — it dials the bridge over a WebSocket and answers tool calls directly, which is why the
   [CEP panel](#cep-panel-websocket-connector) section below also covers installing, starting and approving
   the bridge.

### 🔧 Update MCP Config

#### Option 1: Using .mcp.json (Recommended for Claude Code)
The repository includes a `.mcp.json` file for easy configuration. It points at `./build/index.js`, relative to the folder the client runs from, so copying it into this repo (or into the folder your client uses) is enough — no path editing:

```json
{
  "mcpServers": {
    "AFbridge MCP": {
      "command": "node",
      "args": ["./build/index.js"]
    }
  }
}
```

If your client does not resolve relative paths, replace the argument with the absolute path to `build/index.js`, as in Option 2.

#### Option 2: Manual Configuration
Go to your client (e.g., Claude or Cursor) and update your config file:

```json
{
  "mcpServers": {
    "AFbridge MCP": {
      "command": "node",
      "args": ["C:\\Users\\rakes\\aftereffects_live_mcp\\build\\index.js"]
    }
  }
}
```

The key under `mcpServers` is just the label your client shows, so `AFbridge MCP` there makes the
server list read consistently with the panel.

### ▶️ Running the Server

1. **Start the MCP server**
   ```bash
   npm start
   # or
   yarn start
   ```

2. **Open After Effects**

3. **Open the AFbridge MCP panel**
   - In After Effects, go to Window > mcp-bridge-auto.jsx (ScriptUI variant) or Window → Extensions → AFbridge MCP (CEP panel)
   - The panel will automatically check for commands every few seconds
   - Make sure the "Auto-run commands" checkbox is enabled

## 🚀 Usage Guide

Once you have the server running and the AFbridge MCP panel open in After Effects, you can control After Effects through the MCP protocol. This allows AI assistants or custom applications to send commands to After Effects.

### 📘 Creating Compositions

You can create new compositions with custom settings:
- Name
- Width and height (in pixels)
- Frame rate
- Duration
- Background color

Example MCP tool usage (for developers):
```javascript
callTool("create-composition", {
  name: "My Composition", 
  width: 1920, 
  height: 1080, 
  frameRate: 30,
  duration: 10
});
```

### ✍️ Working with Layers

You can create and modify different types of layers:

**Text layers:**
- Set text content, font, size, and color
- Position text anywhere in the composition
- Adjust timing and opacity

**Shape layers:**
- Create rectangles, ellipses, polygons, and stars
- Set fill and stroke colors
- Customize size and position

**Solid layers:**
- Create background colors
- Make adjustment layers for effects

### 🕹 Animation

You can animate layers with:

**Keyframes:**
- Set property values at specific times
- Create motion, scaling, rotation, and opacity changes
- Control the timing of animations

**Expressions:**
- Apply JavaScript expressions to properties
- Create dynamic, procedural animations
- Connect property values to each other

## 🧩 CEP panel (WebSocket connector)

A second, panel-native way to expose After Effects: instead of the MCP server polling a folder that a
ScriptUI panel reads, a CEP panel talks to the bridge over a WebSocket and answers tool calls directly.

### Why CEP and not UXP

Adobe's UXP plugins reached **public beta for After Effects only in the 27.x Beta build** (UXP 9.4, build
27.1.045, from November 2026); the shipping AE 26.x release this machine runs still hosts CEP panels, and
UXP for AE is scheduled to reach GA in Q2 2027. CEP is therefore the client for AE 2026; when AE 27 ships,
the panel's `index.html`/`main.js` move to a UXP plugin and the protocol stays the same.

### Install

```bash
npm run install-cep        # builds the command library, installs into %APPDATA%\Adobe\CEP\extensions\com.mcpbridge.ae
```

**The bridge has to be installed and running first** — the panel is an inert window without it:

```bash
cd ../mcp-bridge
bun install                # once: bridge dependencies
bun run build              # once: the bridge's own web panel
node scripts/mcp.mjs up    # start the bridge on http://127.0.0.1:7800
```

Restart After Effects, then open **Window → Extensions → AFbridge MCP**. The panel connects to
`ws://127.0.0.1:7800/ws/connector` (editable, with an optional token) and registers as
**AFbridge MCP** — id `after-effects-panel`. Approve it once: open **http://127.0.0.1:7800/** →
**Applications**, where a newly registered application sits as *pending_approval*. Until it is approved it
cannot connect and exposes no tools — `POST /api/servers/after-effects-panel/connect` answers
`MCP_APPROVAL_REQUIRED`. After approval its 27 tools appear in `/api/tools`, `/mcp` and model requests, and
the approval survives restarts and panel reconnects. The id is deliberately distinct
from the `after-effects` stdio server: the bridge refuses two servers with the same id, so both transports
can be installed while the folder bridge is retired.

### How it is put together

| File | Role |
| --- | --- |
| `cep/CSXS/manifest.xml` | CEP manifest, AE host range, panel entry point |
| `cep/index.html`, `css/panel.css`, `js/main.js` | panel UI, WebSocket client, registration, call dispatch |
| `cep/js/tools.js` | the tool catalog announced to the bridge (the same 27 tools as `src/index.ts`) |
| `cep/jsx/host.jsx` | ExtendScript bridge: loads the command library, wraps calls in an undo group |
| `src/scripts/ae-commands.jsx` | **generated** — the command implementations, shared with the ScriptUI panel |
| `scripts/build-commands.mjs` | extracts those functions from `mcp-bridge-auto.jsx` |

The AE logic exists once. `mcp-bridge-auto.jsx` interleaves a ScriptUI window with the command functions,
so `build-commands.mjs` extracts the top-level functions by brace depth (skipping the UI ones) into a
UI-free IIFE that exposes `mcpRunCommand(name, args)`. The ScriptUI panel keeps working exactly as before;
the CEP panel loads the generated library with `$.evalFile` and calls that entry point. `npm run build:commands`
regenerates it and fails loudly if a command disappears or ScriptUI construction leaks in.

### Differences from the stdio server

- Tools are named after the commands the panel implements (`create-composition`, `set-layer-keyframe`, …),
  the same kebab-case names the stdio server exposes. Every tool queues its command and returns that
  command's own result, so there is no `get-results` step and no way to read a previous call's output.
- A call runs inside `app.beginUndoGroup("MCP: …")`, so one tool call is one undo step.
- The panel must be open in AE: when it closes, the server reports `disconnected` and its tools leave the
  catalog; reopening the panel re-registers and reconnects without another approval.

## ⚡ Native binary (no Node)

The same 27 tools also ship as a prebuilt Windows binary attached to each
[release](https://github.com/Rakeshcool/aftereffects_live_mcp/releases). It is an MCP stdio server like
`build/index.js`, but it needs no Node install and starts in milliseconds.

| | Node server | Native binary |
| --- | --- | --- |
| Run with | `node build/index.js` | `afbridge-ae.exe` |
| Needs | Node 18+ | nothing |
| Reaches AE through | the ScriptUI panel's command folder | the bridge's connector socket (CEP panel) |
| Tools | the 27 below | the same 27, schemas embedded |

Download `afbridge-ae.exe` and keep it wherever you like — this repo's `bin/` is a convenient
place and is gitignored, so a local copy never ends up in a commit. Point your MCP client at it:

```json
{
  "mcpServers": {
    "AFbridge MCP": { "command": "C:\\path\\to\\afbridge-ae.exe" }
  }
}
```

It talks to the [AFbridge MCP bridge](../mcp-bridge) on `http://127.0.0.1:7800`, so the bridge must be
running and the CEP panel open and approved: the After Effects logic is still ExtendScript running
inside AE, and the binary is the transport, not a second implementation. Start the bridge with
`node scripts/mcp.mjs up` in `mcp-bridge`.

```bash
afbridge-ae.exe --version        # afbridge-ae 0.1.0
afbridge-ae.exe --list-tools     # the 27 tools, one per line
afbridge-ae.exe --port 7800      # bridge port (or --base http://127.0.0.1:7800)
```

If you would rather not run the bridge, the Node server above is unchanged and still works on its
own: it writes commands to a folder that the ScriptUI panel polls.

## 🛠 Available MCP Tools

| Tool | Description |
| --- | --- |
| `get-project-info` | Project name, path, item counts, active composition and the first 50 items |
| `list-compositions` | Index, name, size, duration, frame rate and layer count of every comp |
| `get-layer-info` | Layers of a composition, or one layer with its timing, parent and effect count |
| `get-property-value` | Property value, expression and keyframes; slash paths such as `Transform/Position` |
| `create-composition` | Create a composition |
| `set-composition-properties` | Change duration, frame rate or size |
| `create-text-layer` | Add a text layer |
| `create-shape-layer` | Add a shape layer (rectangle, ellipse, polygon, star) |
| `create-solid-layer` | Add a solid or adjustment layer |
| `create-camera` | Add a camera layer; `oneNode` only turns auto-orientation off |
| `duplicate-layer` | Duplicate a layer |
| `delete-layer` | Delete a layer |
| `set-layer-properties` | Transform, text, blending and timing properties |
| `batch-set-layer-properties` | Position, scale, rotation, opacity, blend and timing across several layers |
| `set-layer-mask` | Create or restyle a mask from a path or a rectangle |
| `set-layer-keyframe` | Set a keyframe on a Transform, Effects or Text property |
| `delete-keyframe` | Remove the keyframe nearest a time, or all of them |
| `set-layer-expression` | Set or remove an expression |
| `apply-effect` | Apply one effect |
| `apply-effect-template` | Apply a named effect template |
| `render-composition` | Render through the render queue, or write one PNG frame; waits for the PNG to finish and reports its byte size |
| `set-property-value` | Write any property by slash path, as a constant or a keyframe; reaches effect parameters and shape contents |
| `get-layer-property-tree` | Property tree with match names, values, keyframes and expressions, so an exact path can be found without probing |
| `purge-cache` | Drop After Effects caches (all, image, undo, snapshot) |
| `save-project` | Save to the current file, or to a path for a project never saved |
| `run-script` | Escape hatch: run ExtendScript from a string |
| `run-script-file` | Escape hatch: run a .jsx file |

## 👨‍💻 For Developers

### 🧩 Project Structure

- `src/index.ts`: MCP server implementation
- `src/scripts/mcp-bridge-auto.jsx`: Main After Effects panel script
- `install-bridge.js`: Script to install the panel in After Effects

### 📦 Building the Project

```bash
npm run build
# or
yarn build
```

**Note:** the bundle is built with esbuild; `tsc` is used only for the typecheck that runs first (see below), never to emit.

### 🔍 Type Checking

```bash
npm run typecheck   # zod guard + tsc --noEmit over src/**/*
```

`npm run build` runs this first, and `postinstall`/`prepublishOnly` run the build, so an
install or publish with a bad zod fails in milliseconds instead of turning into a heap
crash later. `npm run check:zod` runs just the guard.

This needs **zod 3.25 or newer**. The MCP SDK declares `zod: ^3.25 || ^4.0`, and against an
older zod its `tool()` overloads never resolve: each call reports `TS2589: Type instantiation
is excessively deep and possibly infinite` (a single call costs 8–30 s), and a file with a
handful of tools exhausts the heap — `FATAL ERROR: Ineffective mark-compacts near heap limit`,
exit 134. That failure looks like a broken Node install but is purely the dependency mismatch,
which is why `zod` is pinned to `^3.25.76`.

**Two copies are just as fatal as an old one.** With zod 3.25.76 at the top level and a
second copy nested under the SDK, `tsc` still burns 4 GB and aborts after ~57 s, because
`src/` and the SDK's declarations resolve different type graphs. `"overrides": { "zod": "$zod" }`
forces npm to a single version; `scripts/check-zod.mjs` fails the build if a nested copy
ever sneaks back in, so run `npm dedupe` if it complains.

### 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Rakeshcool/aftereffects_live_mcp&type=date&legend=top-left)](https://www.star-history.com/#Rakeshcool/aftereffects_live_mcp&type=date&legend=top-left)

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.
