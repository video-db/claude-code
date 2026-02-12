#!/usr/bin/env node
// Zero-dependency MCP server for the VideoDB Recorder API.
// Implements JSON-RPC 2.0 over stdio with Content-Length framing (MCP 2024-11-05).
// Exposes recorder HTTP endpoints as native MCP tools.

const http = require("http");
const fs = require("fs");
const path = require("path");

function log(msg) {
  process.stderr.write(`[recorder-mcp] ${msg}\n`);
}

log(`starting — pid=${process.pid} cwd=${process.cwd()} script=${__filename}`);

// ---------------------------------------------------------------------------
// Config — lazy-loaded on first tool call
// ---------------------------------------------------------------------------
let _port = null;

function getPort() {
  if (_port) return _port;
  try {
    const configPath = path.join(
      process.env.HOME || process.env.USERPROFILE,
      ".config",
      "videodb",
      "config.json"
    );
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    _port = config.recorder_port || 8899;
  } catch {
    _port = 8899;
  }
  return _port;
}

// ---------------------------------------------------------------------------
// HTTP helper — makes requests to the recorder localhost API
// ---------------------------------------------------------------------------
function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const port = getPort();
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "127.0.0.1",
      port,
      path: apiPath,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (payload) opts.headers["Content-Length"] = Buffer.byteLength(payload);

    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on("error", (err) => reject(new Error(`Recorder not reachable: ${err.message}`)));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Recorder request timed out (30s)"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tool definitions — JSON Schema for each tool's parameters
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "get_status",
    description:
      "Get recorder status: recording state, session ID, duration, rtstream IDs, buffer counts, and Claude session ID.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "record_start",
    description:
      "Start recording screen and audio. Opens a picker for the user to select which screen to capture. Optionally pass indexing_config to customize how the recorder analyzes content.",
    inputSchema: {
      type: "object",
      properties: {
        indexing_config: {
          type: "object",
          description:
            'Optional indexing config, e.g. {"visual":{"prompt":"Focus on code"}}',
        },
      },
    },
  },
  {
    name: "record_stop",
    description: "Stop the current recording and return session duration.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_context",
    description:
      "Fetch recent context items from the recorder buffer. Types: screen (visual descriptions), mic (user speech transcript), system_audio (system sound transcript), all (everything).",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["screen", "mic", "system_audio", "all"],
          description: "Which context type to fetch",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "show_overlay",
    description:
      "Show content on the pair-programmer overlay window. Send text for the final answer, or loading:true for a spinner.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Markdown text to display on the overlay",
        },
        loading: {
          type: "boolean",
          description: "Show a loading spinner instead of text",
        },
      },
    },
  },
  {
    name: "hide_overlay",
    description: "Hide the pair-programmer overlay window.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_rtstream",
    description:
      "Semantic search within an RTStream for specific content. Use rtstream IDs from get_status.",
    inputSchema: {
      type: "object",
      properties: {
        rtstream_id: {
          type: "string",
          description: "RTStream ID to search within",
        },
        query: {
          type: "string",
          description: "Search query (keywords or natural language)",
        },
      },
      required: ["rtstream_id", "query"],
    },
  },
  {
    name: "update_prompt",
    description:
      "Update the indexing prompt for an RTStream's scene index. Changes how the recorder analyzes incoming content.",
    inputSchema: {
      type: "object",
      properties: {
        rtstream_id: {
          type: "string",
          description: "RTStream ID to update",
        },
        scene_index_id: {
          type: "string",
          description: "Scene index ID (from get_status rtstreams array)",
        },
        prompt: {
          type: "string",
          description: "New indexing prompt",
        },
      },
      required: ["rtstream_id", "scene_index_id", "prompt"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers — dispatch tool calls to the recorder API
// ---------------------------------------------------------------------------
async function handleToolCall(name, args) {
  switch (name) {
    case "get_status":
      return await apiRequest("GET", "/api/status");

    case "record_start": {
      const body = {};
      if (args.indexing_config) body.indexing_config = args.indexing_config;
      return await apiRequest("POST", "/api/record/start", body);
    }

    case "record_stop":
      return await apiRequest("POST", "/api/record/stop", {});

    case "get_context":
      return await apiRequest("GET", `/api/context/${args.type || "all"}`);

    case "show_overlay": {
      const body = {};
      if (args.text != null) body.text = args.text;
      if (args.loading != null) body.loading = args.loading;
      return await apiRequest("POST", "/api/overlay/show", body);
    }

    case "hide_overlay":
      return await apiRequest("POST", "/api/overlay/hide", {});

    case "search_rtstream":
      return await apiRequest("POST", "/api/rtstream/search", {
        rtstream_id: args.rtstream_id,
        query: args.query,
      });

    case "update_prompt":
      return await apiRequest("POST", "/api/rtstream/update-prompt", {
        rtstream_id: args.rtstream_id,
        scene_index_id: args.scene_index_id,
        prompt: args.prompt,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 message handler
// ---------------------------------------------------------------------------
function handleMessage(msg) {
  // Notifications (no id) — just acknowledge silently
  if (msg.id == null) return null;

  switch (msg.method) {
    case "initialize": {
      const clientVersion = (msg.params && msg.params.protocolVersion) || "2024-11-05";
      log(`initialize handshake (client: ${clientVersion})`);
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: clientVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "recorder", version: "1.0.0" },
        },
      };
    }

    case "ping":
      return { jsonrpc: "2.0", id: msg.id, result: {} };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { tools: TOOLS },
      };

    case "tools/call":
      return "async";

    default:
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      };
  }
}

async function handleToolCallMessage(msg) {
  const { name, arguments: args } = msg.params;
  log(`tools/call ${name}`);
  try {
    const result = await handleToolCall(name, args || {});
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      },
    };
  } catch (err) {
    log(`tools/call ${name} error: ${err.message}`);
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Stdio transport — newline-delimited JSON-RPC (NDJSON)
// ---------------------------------------------------------------------------
let inputBuffer = "";
let pendingCalls = 0;
let stdinEnded = false;

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  log(`stdout: id=${msg.id} (${json.length}b)`);
  process.stdout.write(json + "\n");
}

function maybeExit() {
  if (stdinEnded && pendingCalls === 0) process.exit(0);
}

function processBuffer() {
  let newlineIdx;
  while ((newlineIdx = inputBuffer.indexOf("\n")) !== -1) {
    const line = inputBuffer.slice(0, newlineIdx).trim();
    inputBuffer = inputBuffer.slice(newlineIdx + 1);
    if (!line) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log(`parse error on: ${line.slice(0, 100)}`);
      continue;
    }

    const response = handleMessage(msg);
    if (response === "async") {
      pendingCalls++;
      handleToolCallMessage(msg)
        .then(sendMessage)
        .catch((err) => {
          log(`unhandled error: ${err.message}`);
          sendMessage({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32603, message: err.message },
          });
        })
        .finally(() => {
          pendingCalls--;
          maybeExit();
        });
    } else if (response) {
      sendMessage(response);
    }
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  log(`stdin: ${chunk.length} bytes`);
  inputBuffer += chunk;
  processBuffer();
});
process.stdin.on("end", () => {
  log("stdin ended");
  stdinEnded = true;
  maybeExit();
});
process.stdin.on("error", (err) => {
  log(`stdin error: ${err.message}`);
});
log("ready, waiting for input");

// Suppress unhandled rejection crasheimage.pngs
process.on("unhandledRejection", (err) => {
  process.stderr.write(`[recorder-mcp] ${err}\n`);
});
