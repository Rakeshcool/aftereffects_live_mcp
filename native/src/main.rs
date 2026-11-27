// afbridge-ae — a native MCP stdio server for After Effects.
//
// Every After Effects tool lives in ExtendScript inside the AFbridge MCP panel, so this binary is a
// thin, fast transport: it speaks MCP on stdin/stdout, keeps the panel's 27 tool schemas embedded
// (src/tools.json, generated from the live panel), and forwards each tools/call to the AFbridge MCP
// bridge, which relays it to the panel over its connector WebSocket.
//
// stdout is the protocol channel: nothing but JSON-RPC frames may be written there.

use std::io::{self, BufRead, Read, Write};
use std::net::TcpStream;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};

const SERVER_ID: &str = "after-effects-panel";
const DEFAULT_BASE: &str = "http://127.0.0.1:7800";
const DEFAULT_PROTOCOL: &str = "2024-11-05";
const CATALOG: &str = include_str!("tools.json");

const HELP: &str = "\
afbridge-ae — MCP stdio server for After Effects (AFbridge MCP)

USAGE
  afbridge-ae [--port <n> | --base <url>]   run the server on stdin/stdout
  afbridge-ae --list-tools                  print the 27 tools and exit
  afbridge-ae --version

OPTIONS
  --port <n>     bridge port, default 7800 (env PORT is not used; set AFBRIDGE_BASE instead)
  --base <url>   full bridge base URL, default http://127.0.0.1:7800

ENVIRONMENT
  AFBRIDGE_BASE  full bridge base URL (overridden by --base / --port)

The bridge and the AE panel must be up: start the bridge with
  node scripts/mcp.mjs up        (in mcp-bridge)
then open Window > Extensions > AFbridge MCP in After Effects.";

fn main() {
    let mut base = std::env::var("AFBRIDGE_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string());
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--base" => match args.next() {
                Some(value) => base = value,
                None => fail("--base needs a URL"),
            },
            "--port" => match args.next() {
                Some(value) => base = format!("http://127.0.0.1:{value}"),
                None => fail("--port needs a number"),
            },
            "--list-tools" => {
                for tool in catalog() {
                    let name = tool["name"].as_str().unwrap_or("?");
                    let first = tool["description"]
                        .as_str()
                        .unwrap_or("")
                        .lines()
                        .next()
                        .unwrap_or("");
                    println!("{name}\t{first}");
                }
                return;
            }
            "--version" | "-V" => {
                println!("afbridge-ae {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            "--help" | "-h" => {
                println!("{HELP}");
                return;
            }
            other => fail(&format!("unknown argument {other} (try --help)")),
        }
    }
    serve(&base);
}

fn fail(message: &str) -> ! {
    eprintln!("afbridge-ae: {message}");
    std::process::exit(2);
}

/// Newline-delimited JSON-RPC on stdin, one response line per request on stdout.
fn serve(base: &str) {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(line) {
            Ok(message) => handle(base, &message),
            Err(error) => Some(json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": { "code": -32700, "message": format!("parse error: {error}") }
            })),
        };
        if let Some(reply) = reply {
            if writeln!(stdout, "{reply}").and_then(|_| stdout.flush()).is_err() {
                break;
            }
        }
    }
}

fn handle(base: &str, message: &Value) -> Option<Value> {
    let method = message["method"].as_str().unwrap_or_default();
    // Notifications carry no id and are never answered.
    let id = message.get("id")?.clone();
    match method {
        "initialize" => Some(ok(id, initialize(message))),
        "ping" => Some(ok(id, json!({}))),
        "tools/list" => Some(ok(id, json!({ "tools": catalog() }))),
        "tools/call" => Some(ok(id, tools_call(base, message))),
        "prompts/list" => Some(ok(id, json!({ "prompts": [] }))),
        "resources/list" => Some(ok(id, json!({ "resources": [] }))),
        "shutdown" => Some(ok(id, Value::Null)),
        other => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": format!("method not found: {other}") }
        })),
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn initialize(message: &Value) -> Value {
    let protocol = message["params"]["protocolVersion"]
        .as_str()
        .unwrap_or(DEFAULT_PROTOCOL);
    json!({
        "protocolVersion": protocol,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": {
            "name": "afbridge-ae",
            "title": "AFbridge AE (Rust)",
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": "After Effects tools. They run in the AE panel through the AFbridge MCP bridge, \
so the bridge must be running and the panel open and approved."
    })
}

fn catalog() -> &'static Vec<Value> {
    static TOOLS: OnceLock<Vec<Value>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        serde_json::from_str(CATALOG).expect("src/tools.json is not a JSON array of tools")
    })
}

fn tools_call(base: &str, message: &Value) -> Value {
    let params = &message["params"];
    let name = params["name"].as_str().unwrap_or_default().to_string();
    let arguments = match params.get("arguments") {
        Some(value) if value.is_object() => value.clone(),
        _ => json!({}),
    };

    if !catalog().iter().any(|tool| tool["name"] == name.as_str()) {
        return tool_error(format!("unknown tool: {name}"));
    }

    let path = format!("/api/tools/{SERVER_ID}__{name}/call");
    match post_json(base, &path, &arguments.to_string()) {
        Ok(envelope) => {
            if envelope["ok"].as_bool() == Some(true) {
                let text = envelope
                    .get("result")
                    .map(text_of)
                    .unwrap_or_default();
                let is_error = envelope["isError"].as_bool().unwrap_or(false);
                json!({
                    "content": [{ "type": "text", "text": text }],
                    "isError": is_error
                })
            } else {
                let hint = envelope["error"]["details"]["hint"].as_str().unwrap_or("");
                let message = envelope["error"]["message"]
                    .as_str()
                    .unwrap_or("the tool call failed");
                let text = if hint.is_empty() {
                    message.to_string()
                } else {
                    format!("{message}\n{hint}")
                };
                tool_error(text)
            }
        }
        Err(error) => tool_error(error),
    }
}

fn tool_error(message: String) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

/// The bridge returns the panel's text, or a structured object; flatten both to one string.
fn text_of(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => {
            let parts: Vec<String> = blocks
                .iter()
                .filter_map(|block| {
                    block["text"]
                        .as_str()
                        .map(str::to_string)
                        .or_else(|| Some(block.to_string()))
                })
                .collect();
            parts.join("\n")
        }
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Minimal HTTP/1.1 POST over loopback — the bridge speaks plain HTTP and never TLS here.
fn post_json(base: &str, path: &str, body: &str) -> Result<Value, String> {
    let rest = base
        .strip_prefix("http://")
        .ok_or_else(|| format!("only http:// bridge URLs are supported, got {base}"))?
        .trim_end_matches('/');
    let (host, port) = match rest.rsplit_once(':') {
        Some((host, port)) => (
            host.to_string(),
            port.parse::<u16>()
                .map_err(|_| format!("bad port in {base}"))?,
        ),
        None => (rest.to_string(), 80),
    };

    let mut stream = TcpStream::connect((host.as_str(), port))
        .map_err(|error| {
            format!(
                "bridge not reachable at {base} ({error}). Start it with `node scripts/mcp.mjs up` in mcp-bridge."
            )
        })?;
    stream.set_write_timeout(Some(Duration::from_secs(30))).ok();
    stream.set_read_timeout(Some(Duration::from_secs(95))).ok();

    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("could not send the request: {error}"))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|error| format!("could not read the bridge response: {error}"))?;

    let split = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response from the bridge".to_string())?;
    let head = String::from_utf8_lossy(&raw[..split]).to_lowercase();
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    let payload = if head.contains("transfer-encoding: chunked") {
        dechunk(&raw[split + 4..])
    } else {
        raw[split + 4..].to_vec()
    };
    let text = String::from_utf8_lossy(&payload).trim().to_string();

    if status != 200 {
        let detail = if text.is_empty() {
            format!("bridge returned HTTP {status}")
        } else {
            format!("bridge returned HTTP {status}: {text}")
        };
        return Err(detail);
    }
    serde_json::from_str(&text)
        .map_err(|error| format!("bridge returned invalid JSON ({error}): {text}"))
}

fn dechunk(mut data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let Some(end) = data.windows(2).position(|window| window == b"\r\n") else {
            break;
        };
        let header = String::from_utf8_lossy(&data[..end]).to_string();
        let size_text = header.split(';').next().unwrap_or("0").trim().to_string();
        let size = usize::from_str_radix(&size_text, 16).unwrap_or(0);
        data = &data[end + 2..];
        if size == 0 || data.len() < size {
            out.extend_from_slice(data);
            break;
        }
        out.extend_from_slice(&data[..size]);
        data = &data[size..];
        if data.starts_with(b"\r\n") {
            data = &data[2..];
        }
    }
    out
}
