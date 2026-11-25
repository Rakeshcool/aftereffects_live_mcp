# 🎬 After Effects MCP Server

![Node.js](https://img.shields.io/badge/node-%3E=14.x-brightgreen.svg)
![Build](https://img.shields.io/badge/build-passing-success)
![License](https://img.shields.io/github/license/Rakeshcool/aftereffects_live_mcp)
![Platform](https://img.shields.io/badge/platform-after%20effects-blue)

✨ A Model Context Protocol (MCP) server for Adobe After Effects that enables AI assistants and other applications to control After Effects through a standardized protocol.

![MCP Bridge demo](assets/demo.gif)

## Table of Contents
- [Features](#features)
  - [Core Composition Features](#core-composition-features)
  - [Layer Management](#layer-management)
  - [Animation Capabilities](#animation-capabilities)
- [Setup Instructions](#setup-instructions)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Update MCP Config](#Update-MCP-Config)
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
- Node.js (v14 or later)
- npm or yarn package manager

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

### 🔧 Update MCP Config

#### Option 1: Using .mcp.json (Recommended for Claude Code)
The repository includes a `.mcp.json` file for easy configuration. Copy or reference it in your MCP settings:

```json
{
  "mcpServers": {
    "AfterEffectsMCP": {
      "command": "node",
      "args": ["PATH/TO/after-effects-mcp/build/index.js"]
    }
  }
}
```

#### Option 2: Manual Configuration
Go to your client (e.g., Claude or Cursor) and update your config file:

```json
{
  "mcpServers": {
    "AfterEffectsMCP": {
      "command": "node",
      "args": ["C:\\Users\\rakes\\aftereffects_live_mcp\\build\\index.js"]
    }
  }
}
```

### ▶️ Running the Server

1. **Start the MCP server**
   ```bash
   npm start
   # or
   yarn start
   ```

2. **Open After Effects**

3. **Open the MCP Bridge Auto panel**
   - In After Effects, go to Window > mcp-bridge-auto.jsx
   - The panel will automatically check for commands every few seconds
   - Make sure the "Auto-run commands" checkbox is enabled

## 🚀 Usage Guide

Once you have the server running and the MCP Bridge panel open in After Effects, you can control After Effects through the MCP protocol. This allows AI assistants or custom applications to send commands to After Effects.

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

Restart After Effects, then open **Window → Extensions → MCP Bridge**. The panel connects to
`ws://127.0.0.1:7800/ws/connector` (editable, with an optional token) and registers as
**After Effects (panel)** — id `after-effects-panel`. Approve it once in the bridge panel's *Applications*
view; its 22 tools then appear in `/api/tools`, `/mcp` and model requests. The id is deliberately distinct
from the `after-effects` stdio server: the bridge refuses two servers with the same id, so both transports
can be installed while the folder bridge is retired.

### How it is put together

| File | Role |
| --- | --- |
| `cep/CSXS/manifest.xml` | CEP manifest, AE host range, panel entry point |
| `cep/index.html`, `css/panel.css`, `js/main.js` | panel UI, WebSocket client, registration, call dispatch |
| `cep/js/tools.js` | the tool catalog announced to the bridge (the same 22 tools as `src/index.ts`) |
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
| `render-composition` | Render through the render queue, or write one PNG frame; reports the file actually written |
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

**Note:** This project uses esbuild for fast builds, replacing the previous TypeScript compiler approach that could run out of memory on larger codebases.

### 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Rakeshcool/aftereffects_live_mcp&type=date&legend=top-left)](https://www.star-history.com/#Rakeshcool/aftereffects_live_mcp&type=date&legend=top-left)

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.
