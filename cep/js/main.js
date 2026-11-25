/**
 * main.js — the CEP panel's half of the connector.
 *
 * The panel dials the bridge's WebSocket connector endpoint, announces itself and its tools, and then
 * answers `call` frames by running the matching command in After Effects through ExtendScript. The
 * bridge's discovery and approval layer decides whether those tools are exposed to a model or client;
 * this file never decides that on its own.
 */
(function () {
  var STORAGE_KEY = "mcp-bridge-ae";
  var DEFAULT_URL = "ws://127.0.0.1:7800/ws/connector";
  // Distinct from the stdio MCP server's id: the bridge refuses two servers with the same id, and
  // both may be installed while the file-bridge server is retired.
  var SERVER_ID = "after-effects-panel";
  var MAX_LOG = 200;

  var els = {
    url: document.getElementById("url"),
    token: document.getElementById("token"),
    connect: document.getElementById("connect"),
    auto: document.getElementById("auto"),
    dot: document.getElementById("dot"),
    approval: document.getElementById("approval"),
    toolCount: document.getElementById("tool-count"),
    tools: document.getElementById("tools"),
    log: document.getElementById("log"),
    clear: document.getElementById("clear"),
    hostVersion: document.getElementById("host-version"),
    bridgePanel: document.getElementById("bridge-panel"),
  };

  var socket = null;
  var registered = false;
  var approved = false;
  var fatal = false;
  var attempts = 0;
  var retryTimer = null;
  var libraryState = "not loaded";

  function hasCep() {
    return typeof window.__adobe_cep__ !== "undefined" && typeof window.__adobe_cep__.evalScript === "function";
  }

  function bridgePanelUrl() {
    try {
      var parsed = new URL(els.url.value.trim() || DEFAULT_URL);
      return "http://" + parsed.hostname + ":" + (parsed.port || "7800") + "/";
    } catch (error) {
      return "http://127.0.0.1:7800/";
    }
  }

  function log(message, kind) {
    var line = document.createElement("div");
    if (kind) line.className = kind;
    var stamp = new Date().toLocaleTimeString();
    line.textContent = stamp + "  " + message;
    els.log.prepend(line);
    while (els.log.childElementCount > MAX_LOG) els.log.lastElementChild.remove();
  }

  function setStatus(state, label) {
    els.dot.className = "dot" + (state ? " " + state : "");
    els.dot.title = label || "";
  }

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      els.url.value = saved.url || DEFAULT_URL;
      els.token.value = saved.token || "";
      els.auto.checked = saved.auto !== false;
    } catch (error) {
      els.url.value = DEFAULT_URL;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ url: els.url.value.trim(), token: els.token.value, auto: els.auto.checked }),
      );
    } catch (error) {
      // storage is a convenience, not a requirement
    }
  }

  /** Runs ExtendScript and resolves with its string result. */
  function evalScript(expression) {
    return new Promise(function (resolve, reject) {
      if (!hasCep()) {
        reject(new Error("Not running inside After Effects"));
        return;
      }
      window.__adobe_cep__.evalScript(expression, function (result) {
        if (result === "EvalScript error.") reject(new Error("ExtendScript failed: " + expression.slice(0, 80)));
        else resolve(result);
      });
    });
  }

  function send(frame) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  function renderTools(names) {
    els.toolCount.textContent = String(names.length);
    els.tools.innerHTML = "";
    names.forEach(function (name) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = name;
      els.tools.appendChild(chip);
    });
  }

  function render() {
    var connected = socket && socket.readyState === WebSocket.OPEN && registered;
    els.connect.textContent = socket && socket.readyState <= WebSocket.OPEN ? "Disconnect" : "Connect";
    if (!connected) {
      setStatus("", "not connected");
      els.approval.hidden = true;
      return;
    }
    if (!approved) {
      setStatus("warn", "waiting for approval");
      els.approval.hidden = false;
      els.bridgePanel.textContent = bridgePanelUrl();
      return;
    }
    setStatus("ok", "approved");
    els.approval.hidden = true;
  }

  async function register() {
    var info = { app: "Adobe After Effects", version: "" };
    if (hasCep()) {
      var extensionPath = window.__adobe_cep__.getSystemPath("extension");
      try {
        var loaded = JSON.parse(await evalScript("mcpCepLoad(" + JSON.stringify(extensionPath) + ")"));
        libraryState = loaded.ok ? "loaded" : "failed: " + loaded.error;
      } catch (error) {
        libraryState = "failed: " + error.message;
      }
      if (libraryState !== "loaded") log("Command library " + libraryState, "err");
      try {
        info = JSON.parse(await evalScript("mcpCepInfo()"));
      } catch (error) {
        log("Could not read the AE version: " + error.message, "err");
      }
    }
    els.hostVersion.textContent = info.version ? "AE " + info.version : "browser preview";
    send({
      type: "register",
      protocol: 1,
      server: { id: SERVER_ID, name: "After Effects (panel)", description: "Adobe After Effects via the CEP panel" },
      application: { name: info.app || "Adobe After Effects", version: info.version || "", extensionType: "CEP" },
      capabilities: ["compositions", "layers", "effects", "keyframes", "expressions", "scripting"],
      tools: window.MCP_AE_TOOLS || [],
    });
  }

  /** A model-issued tool call: run it in AE and answer over the socket. */
  function runCall(frame) {
    var args = frame.arguments || {};
    if (!hasCep()) {
      send({ type: "result", id: frame.id, ok: false, error: "The panel is not running inside After Effects." });
      return;
    }
    log("call " + frame.name);
    var expression =
      "mcpCepCall(" + JSON.stringify(frame.name) + ", " + JSON.stringify(JSON.stringify(args)) + ")";
    evalScript(expression)
      .then(function (raw) {
        var parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          parsed = { ok: false, error: "Unreadable result from After Effects: " + raw };
        }
        if (parsed.ok) {
          send({ type: "result", id: frame.id, ok: true, text: parsed.result });
          log("ok " + frame.name, "ok");
        } else {
          send({ type: "result", id: frame.id, ok: false, error: parsed.error });
          log("failed " + frame.name + ": " + parsed.error, "err");
        }
      })
      .catch(function (error) {
        send({ type: "result", id: frame.id, ok: false, error: error.message });
        log("failed " + frame.name + ": " + error.message, "err");
      });
  }

  function scheduleReconnect() {
    if (retryTimer || fatal || !els.auto.checked) return;
    attempts += 1;
    var delay = Math.min(15000, 1500 * Math.pow(2, Math.min(attempts, 4)));
    log("reconnecting in " + Math.round(delay / 1000) + "s");
    retryTimer = setTimeout(function () {
      retryTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close();
      return;
    }
    saveSettings();
    fatal = false;
    registered = false;
    approved = false;
    setStatus("warn", "connecting");
    var url = els.url.value.trim() || DEFAULT_URL;
    var token = els.token.value.trim();
    if (token) url += (url.indexOf("?") === -1 ? "?" : "&") + "token=" + encodeURIComponent(token);
    try {
      socket = new WebSocket(url);
    } catch (error) {
      log("Bad bridge URL: " + error.message, "err");
      setStatus("err", "bad url");
      return;
    }
    socket.onopen = function () {
      attempts = 0;
      log("socket open — registering");
      void register();
    };
    socket.onmessage = function (event) {
      var frame;
      try {
        frame = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (frame.type === "registered") {
        registered = true;
        approved = Boolean(frame.approved);
        renderTools((window.MCP_AE_TOOLS || []).map(function (tool) {
          return tool.name;
        }));
        log(
          approved
            ? "registered as " + frame.serverId + " — approved"
            : "registered as " + frame.serverId + " — waiting for approval",
          approved ? "ok" : undefined,
        );
        render();
        return;
      }
      if (frame.type === "call") {
        runCall(frame);
        return;
      }
      if (frame.type === "error") {
        fatal = true;
        log(frame.code + ": " + frame.message, "err");
        setStatus("err", frame.code);
      }
    };
    socket.onerror = function () {
      log("socket error", "err");
    };
    socket.onclose = function (event) {
      var wasRegistered = registered;
      registered = false;
      approved = false;
      render();
      if (event.code === 1000) {
        log("disconnected", wasRegistered ? undefined : "err");
        return;
      }
      log("socket closed (" + event.code + ")", "err");
      if (!fatal) scheduleReconnect();
    };
  }

  els.connect.addEventListener("click", connect);
  els.clear.addEventListener("click", function () {
    els.log.innerHTML = "";
  });
  els.url.addEventListener("change", render);
  els.auto.addEventListener("change", saveSettings);

  loadSettings();
  renderTools((window.MCP_AE_TOOLS || []).map(function (tool) {
    return tool.name;
  }));
  render();
  log("panel ready — connecting to " + els.url.value);
  connect();
})();
