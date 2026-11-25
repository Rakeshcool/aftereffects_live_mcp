/**
 * tools.js — the tool catalog the CEP panel announces to the bridge.
 *
 * Names match the After Effects command library (`mcpRunCommand` in jsx/ae-commands.jsx). Schemas are
 * permissive on purpose: After Effects validates the arguments itself and reports a useful error, and
 * a strict schema here would silently reject valid ExtendScript options.
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
  var OBJECT = { type: "object", additionalProperties: true };

  global.MCP_AE_TOOLS = [
    {
      name: "get-project-info",
      description: "Report the open project: name, path, item counts, active composition, and AE version.",
      inputSchema: object({}),
    },
    {
      name: "list-compositions",
      description: "List every composition in the project with its index, dimensions, duration and layer count.",
      inputSchema: object({}),
    },
    {
      name: "get-layer-info",
      description: "Describe the layers of a composition, or a single layer when layerIndex or layerName is given.",
      inputSchema: object({ compName: STRING, compIndex: NUMBER, layerIndex: NUMBER, layerName: STRING }),
    },
    {
      name: "create-composition",
      description: "Create a new composition.",
      inputSchema: object(
        { name: STRING, width: NUMBER, height: NUMBER, duration: NUMBER, frameRate: NUMBER },
        ["name"],
      ),
    },
    {
      name: "create-text-layer",
      description: "Add a text layer to a composition.",
      inputSchema: object(
        { compIndex: NUMBER, text: STRING, fontSize: NUMBER, color: { type: "array" }, position: { type: "array" }, alignment: STRING },
        ["text"],
      ),
    },
    {
      name: "create-shape-layer",
      description: "Add a shape layer (rectangle, ellipse, polygon) to a composition.",
      inputSchema: object(
        { compIndex: NUMBER, shapeType: STRING, size: { type: "array" }, color: { type: "array" }, position: { type: "array" }, name: STRING },
        ["shapeType"],
      ),
    },
    {
      name: "create-solid-layer",
      description: "Add a solid layer to a composition.",
      inputSchema: object(
        { compIndex: NUMBER, name: STRING, color: { type: "array" }, width: NUMBER, height: NUMBER },
        ["name"],
      ),
    },
    {
      name: "create-camera",
      description: "Add a camera layer to a composition.",
      inputSchema: object({ compIndex: NUMBER, name: STRING, zoom: NUMBER }),
    },
    {
      name: "duplicate",
      description: "Duplicate a layer, optionally renaming the copy.",
      inputSchema: object({ compIndex: NUMBER, layerIndex: NUMBER, newName: STRING }),
    },
    {
      name: "delete-layer",
      description: "Delete a layer from a composition.",
      inputSchema: object({ compIndex: NUMBER, layerIndex: NUMBER }),
    },
    {
      name: "set-layer-mask",
      description: "Create or modify a mask on a layer.",
      inputSchema: object({ compIndex: NUMBER, layerIndex: NUMBER, maskType: STRING, maskMode: STRING, points: { type: "array" }, feather: NUMBER, opacity: NUMBER }),
    },
    {
      name: "set-layer-properties",
      description: "Set transform, text, or effect properties on one layer (position, scale, opacity, rotation, source text, …).",
      inputSchema: object({ compIndex: NUMBER, layerIndex: NUMBER, properties: OBJECT }, ["properties"]),
    },
    {
      name: "batch-set-layer-properties",
      description: "Apply the same property changes to several layers in one call.",
      inputSchema: object({ compIndex: NUMBER, layerIndices: { type: "array" }, properties: OBJECT }, ["properties"]),
    },
    {
      name: "set-layer-keyframe",
      description: "Set a keyframe on a property at a given time.",
      inputSchema: object(
        { compIndex: NUMBER, layerIndex: NUMBER, propertyName: STRING, timeInSeconds: NUMBER, value: {} },
        ["propertyName", "timeInSeconds"],
      ),
    },
    {
      name: "set-layer-expression",
      description: "Attach an expression to a property.",
      inputSchema: object(
        { compIndex: NUMBER, layerIndex: NUMBER, propertyName: STRING, expressionString: STRING },
        ["propertyName", "expressionString"],
      ),
    },
    {
      name: "set-composition-properties",
      description: "Change a composition's dimensions, duration, frame rate or background colour.",
      inputSchema: object({ compIndex: NUMBER, width: NUMBER, height: NUMBER, duration: NUMBER, frameRate: NUMBER }),
    },
    {
      name: "apply-effect",
      description: "Apply an effect to a layer, optionally with settings.",
      inputSchema: object(
        { compIndex: NUMBER, layerIndex: NUMBER, effectName: STRING, effectCategory: STRING, settings: OBJECT },
        ["effectName"],
      ),
    },
    {
      name: "apply-effect-template",
      description: "Apply a named effect template (a preset group of effects and settings) to a layer.",
      inputSchema: object({ compIndex: NUMBER, layerIndex: NUMBER, template: STRING }, ["template"]),
    },
    {
      name: "run-script-file",
      description: "Run an ExtendScript (.jsx) file from disk inside After Effects and return its result.",
      inputSchema: object({ path: STRING }, ["path"]),
    },
    {
      name: "test-bridge-effects",
      description: "Apply a set of test effects to verify the connection between the panel and After Effects.",
      inputSchema: object({}),
    },
    {
      name: "get-property-value",
      description: "Read a property's value, expression and keyframes; accepts a slash path such as 'Transform/Position'.",
      inputSchema: object(
        { compName: STRING, compIndex: NUMBER, layerIndex: NUMBER, layerName: STRING, propertyName: STRING, timeInSeconds: NUMBER },
        ["propertyName"],
      ),
    },
    {
      name: "delete-keyframe",
      description: "Remove the keyframe nearest a given time, or every keyframe on the property with all:true.",
      inputSchema: object(
        { compName: STRING, compIndex: NUMBER, layerIndex: NUMBER, layerName: STRING, propertyName: STRING, timeInSeconds: NUMBER, all: { type: "boolean" } },
        ["propertyName"],
      ),
    },
    {
      name: "render-composition",
      description: "Render a composition to a file, or write a single PNG frame when frameAtTime is given.",
      inputSchema: object({ compName: STRING, compIndex: NUMBER, outputPath: STRING, outputModuleTemplate: STRING, frameAtTime: NUMBER }),
    },
  ];
})(typeof window !== "undefined" ? window : this);
