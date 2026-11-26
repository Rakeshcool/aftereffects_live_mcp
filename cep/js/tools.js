/**
 * tools.js — the tool catalog the CEP panel announces to the bridge.
 *
 * Mirrors src/index.ts one to one: the same 22 kebab-case names, argument names and required fields, so a
 * model reading the bridge catalog sends what the commands actually read. The MCP server validates
 * strictly; this schema is informational, so it stays permissive about extra keys.
 */
(function (global) {
  function object(properties, required) {
    return {
      type: "object",
      properties: properties || {},
      ...(required && required.length ? { required } : {}),
      additionalProperties: true,
    };
  }

  var NUMBER = { type: "number" };
  var STRING = { type: "string" };
  var BOOLEAN = { type: "boolean" };
  var ARRAY = { type: "array" };
  var OBJECT = { type: "object", additionalProperties: true };

  global.MCP_AE_TOOLS = [
    // --- Read ---
    {
      name: "get-project-info",
      description: "Report the open project: name, path, item counts, active composition and the first 50 items.",
      inputSchema: object({}),
    },
    {
      name: "list-compositions",
      description:
        "List every composition with its project item index, dimensions, duration, frame rate and layer count.",
      inputSchema: object({}),
    },
    {
      name: "get-layer-info",
      description:
        "List the layers of a composition, or describe one layer when layerIndex or layerName is given.",
      inputSchema: object({ compName: STRING, compIndex: NUMBER, layerIndex: NUMBER, layerName: STRING }),
    },
    {
      name: "get-property-value",
      description:
        "Read a property's value at a time, its expression and its first 100 keyframes; accepts a slash path such as 'Transform/Position'.",
      inputSchema: object(
        {
          compName: STRING,
          compIndex: NUMBER,
          layerIndex: NUMBER,
          layerName: STRING,
          propertyName: STRING,
          timeInSeconds: NUMBER,
        },
        ["propertyName"],
      ),
    },

    // --- Compositions ---
    {
      name: "create-composition",
      description: "Create a composition and return its settings.",
      inputSchema: object(
        {
          name: STRING,
          width: NUMBER,
          height: NUMBER,
          pixelAspect: NUMBER,
          duration: NUMBER,
          frameRate: NUMBER,
          backgroundColor: OBJECT,
        },
        ["name"],
      ),
    },
    {
      name: "set-composition-properties",
      description: "Change a composition's duration, frame rate, or width and height together.",
      inputSchema: object({ compName: STRING, duration: NUMBER, frameRate: NUMBER, width: NUMBER, height: NUMBER }),
    },

    // --- Layers ---
    {
      name: "create-text-layer",
      description: "Add a text layer to a composition.",
      inputSchema: object({
        compName: STRING,
        text: STRING,
        position: ARRAY,
        fontSize: NUMBER,
        color: ARRAY,
        fontFamily: STRING,
        alignment: STRING,
        startTime: NUMBER,
        duration: NUMBER,
      }),
    },
    {
      name: "create-shape-layer",
      description: "Add a shape layer (rectangle, ellipse, polygon or star) to a composition.",
      inputSchema: object(
        {
          compName: STRING,
          shapeType: STRING,
          position: ARRAY,
          size: ARRAY,
          fillColor: ARRAY,
          strokeColor: ARRAY,
          strokeWidth: NUMBER,
          points: NUMBER,
          name: STRING,
          startTime: NUMBER,
          duration: NUMBER,
        },
        ["shapeType"],
      ),
    },
    {
      name: "create-solid-layer",
      description: "Add a solid layer to a composition, or an adjustment layer with isAdjustment.",
      inputSchema: object({
        compName: STRING,
        name: STRING,
        color: ARRAY,
        size: ARRAY,
        position: ARRAY,
        isAdjustment: BOOLEAN,
        startTime: NUMBER,
        duration: NUMBER,
      }),
    },
    {
      name: "create-camera",
      description: "Add a camera layer; oneNode only turns auto-orientation off.",
      inputSchema: object({
        compName: STRING,
        name: STRING,
        zoom: NUMBER,
        position: ARRAY,
        pointOfInterest: ARRAY,
        oneNode: BOOLEAN,
      }),
    },
    {
      name: "duplicate-layer",
      description: "Duplicate a layer, optionally renaming the copy.",
      inputSchema: object({ compName: STRING, layerIndex: NUMBER, layerName: STRING, newName: STRING }),
    },
    {
      name: "delete-layer",
      description: "Delete a layer from a composition.",
      inputSchema: object({ compName: STRING, layerIndex: NUMBER, layerName: STRING }),
    },
    {
      name: "set-layer-properties",
      description: "Set transform, text, timing or blending properties on one layer.",
      inputSchema: object({
        compName: STRING,
        layerIndex: NUMBER,
        layerName: STRING,
        position: ARRAY,
        scale: ARRAY,
        rotation: NUMBER,
        opacity: NUMBER,
        threeDLayer: BOOLEAN,
        trackMatteType: STRING,
        blendMode: STRING,
        enabled: BOOLEAN,
        startTime: NUMBER,
        duration: NUMBER,
        text: STRING,
        fontFamily: STRING,
        fontSize: NUMBER,
        fillColor: ARRAY,
      }),
    },
    {
      name: "batch-set-layer-properties",
      description:
        "Apply position, scale, rotation, opacity, 3D, blend mode and timing changes to several layers in one call.",
      inputSchema: object({ compName: STRING, operations: ARRAY }, ["operations"]),
    },
    {
      name: "set-layer-mask",
      description:
        "Create a mask, or reshape and restyle an existing one when maskIndex is given; maskPath or maskRect is required either way.",
      inputSchema: object({
        compName: STRING,
        layerIndex: NUMBER,
        layerName: STRING,
        maskIndex: NUMBER,
        maskPath: ARRAY,
        maskRect: OBJECT,
        maskMode: STRING,
        maskFeather: ARRAY,
        maskOpacity: NUMBER,
        maskExpansion: NUMBER,
        maskName: STRING,
      }),
    },

    // --- Animation ---
    {
      name: "set-layer-keyframe",
      description:
        "Set a keyframe on a Transform, Effects or Text property at a given time; a property with no keyframes first gets one at the current time.",
      inputSchema: object(
        {
          compIndex: NUMBER,
          layerIndex: NUMBER,
          propertyName: STRING,
          timeInSeconds: NUMBER,
          value: {},
        },
        ["compIndex", "layerIndex", "propertyName", "timeInSeconds", "value"],
      ),
    },
    {
      name: "delete-keyframe",
      description:
        "Remove the keyframe nearest a given time, or every keyframe on the property with all:true; reports the time removed.",
      inputSchema: object(
        {
          compName: STRING,
          compIndex: NUMBER,
          layerIndex: NUMBER,
          layerName: STRING,
          propertyName: STRING,
          timeInSeconds: NUMBER,
          all: BOOLEAN,
        },
        ["propertyName"],
      ),
    },
    {
      name: "set-layer-expression",
      description: "Set or remove an expression on a layer property; an empty string removes it.",
      inputSchema: object(
        { compIndex: NUMBER, layerIndex: NUMBER, propertyName: STRING, expressionString: STRING },
        ["compIndex", "layerIndex", "propertyName", "expressionString"],
      ),
    },

    // --- Effects ---
    {
      name: "apply-effect",
      description:
        "Apply one effect by display name, match name or preset path, with optional effectSettings keyed by property name.",
      inputSchema: object(
        {
          compIndex: NUMBER,
          layerIndex: NUMBER,
          effectName: STRING,
          effectMatchName: STRING,
          presetPath: STRING,
          effectSettings: OBJECT,
        },
        ["compIndex", "layerIndex"],
      ),
    },
    {
      name: "apply-effect-template",
      description: "Apply a named effect template (a preset group of effects and settings) to a layer.",
      inputSchema: object(
        { compIndex: NUMBER, layerIndex: NUMBER, templateName: STRING, customSettings: OBJECT },
        ["compIndex", "layerIndex", "templateName"],
      ),
    },

    // --- Output ---
    {
      name: "render-composition",
      description:
        "Render through the render queue, or write one PNG frame when frameAtTime is given; reports the file actually written.",
      inputSchema: object({
        compName: STRING,
        compIndex: NUMBER,
        outputPath: STRING,
        outputModuleTemplate: STRING,
        frameAtTime: NUMBER,
      }),
    },

    // --- Properties, cache and project ---
    {
      name: "set-property-value",
      description:
        "Write one property by slash path ('Transform/Position', 'Effects/Glow/Glow Radius', a shape group's 'Contents/…'), optionally as a keyframe at timeInSeconds. Covers what the typed setters cannot reach.",
      inputSchema: object(
        {
          compName: STRING,
          compIndex: NUMBER,
          layerIndex: NUMBER,
          layerName: STRING,
          propertyName: STRING,
          value: {}, 
          timeInSeconds: NUMBER,
          expression: STRING,
        },
        ["propertyName", "value"],
      ),
    },
    {
      name: "get-layer-property-tree",
      description:
        "Walk a layer's property tree with match names, current values and expressions, so an exact property path can be found without probing.",
      inputSchema: object({
        compName: STRING,
        compIndex: NUMBER,
        layerIndex: NUMBER,
        layerName: STRING,
        maxDepth: NUMBER,
        maxNodes: NUMBER,
        timeInSeconds: NUMBER,
      }),
    },
    {
      name: "purge-cache",
      description: "Purge After Effects caches (all, image, undo or snapshot) so a stale viewer frame is re-evaluated.",
      inputSchema: object({ kind: STRING }),
    },
    {
      name: "save-project",
      description: "Save the project to its current file, or to a path when it has never been saved. Nothing saves on its own.",
      inputSchema: object({ path: STRING }),
    },

    // Escape hatches, kept separate so the bridge can deny them on its own.
    {
      name: "run-script",
      description:
        "Run ExtendScript given as a string inside After Effects; wrap it in (function () { ... })() to return a value. Needs no file on disk.",
      inputSchema: object({ source: STRING }, ["source"]),
    },
    {
      name: "run-script-file",
      description: "Run an ExtendScript (.jsx or .jsxbin) file from disk inside After Effects and return its result.",
      inputSchema: object({ path: STRING }, ["path"]),
    },
  ];
})(typeof window !== "undefined" ? window : this);
