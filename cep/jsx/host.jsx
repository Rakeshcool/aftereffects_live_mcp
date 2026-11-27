// host.jsx — the ExtendScript half of the CEP panel.
//
// CEP loads this file automatically (ScriptPath in CSXS/manifest.xml). It only forwards calls into
// ae-commands.jsx, the command library generated from the ScriptUI panel, so the AE logic exists once.

var MCP_CEP_LOADED = false;

/**
 * Loads the command library that ships inside this extension folder.
 * @param {string} extensionPath absolute path of the extension, from csInterface.getSystemPath("extension")
 */
function mcpCepLoad(extensionPath) {
  try {
    $.evalFile(extensionPath + "/jsx/ae-commands.jsx");
    MCP_CEP_LOADED = typeof mcpRunCommand === "function";
    return JSON.stringify(MCP_CEP_LOADED ? { ok: true } : { ok: false, error: "ae-commands.jsx did not define mcpRunCommand" });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error) });
  }
}

/** Host and project facts the panel announces when it registers. */
function mcpCepInfo() {
  var info = {
    app: app.name,
    version: app.version,
    build: app.buildName ? String(app.buildName) : "",
    project: app.project && app.project.file ? app.project.file.fsName : null,
  };
  return JSON.stringify(info);
}

/**
 * Runs one command and returns `{ ok, result }` as JSON.
 * @param {string} name tool name, e.g. "create-composition"
 * @param {string} argsJson JSON object of arguments
 */
function mcpCepCall(name, argsJson) {
  if (!MCP_CEP_LOADED) {
    return JSON.stringify({ ok: false, error: "The AE command library is not loaded. Reopen the AFbridge MCP panel." });
  }
  var args;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (error) {
    return JSON.stringify({ ok: false, error: "Argument JSON was invalid: " + String(error) });
  }
  app.beginUndoGroup("MCP: " + name);
  try {
    var result = mcpRunCommand(name, args);
    app.endUndoGroup();
    return JSON.stringify({ ok: true, result: result });
  } catch (error) {
    try {
      app.endUndoGroup();
    } catch (ignored) {
      // nothing to close
    }
    var message = error && error.toString ? error.toString() : String(error);
    if (error && error.line) message += " (line " + error.line + ")";
    return JSON.stringify({ ok: false, error: message });
  }
}
