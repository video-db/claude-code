#!/usr/bin/env electron
const path = require("path");
const fs = require("fs");

const {
  app,
  Notification,
  globalShortcut,
  ipcMain,
} = require("electron");
const http = require("http");
const net = require("net");
const { spawn, execSync } = require("child_process");
const { connect } = require("videodb");
const { CaptureClient } = require("videodb/capture");

const RecordingState = require("./lib/recording-state");
const ContextBufferManager = require("./lib/context-buffer");
const OverlayManager = require("./lib/overlay-manager");
const TrayManager = require("./lib/tray-manager");
const TunnelManager = require("./lib/tunnel-manager");
const PickerManager = require("./lib/picker-manager");
const {
  channelIdToDisplayName,
  rtstreamNameToDisplayName,
  buildChannelsFromPicker,
  getIndexingConfig,
} = require("./lib/utils");

// =============================================================================
// Configuration
// =============================================================================

// Config lives in ~/.config/videodb/ so it persists across plugin updates
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".config", "videodb");
const CONFIG_FILE_PATH = process.env.CONFIG_PATH || path.join(CONFIG_DIR, "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf8"));
  } catch (e) {
    console.warn("No config.json found at", CONFIG_FILE_PATH, "- using defaults");
    return {};
  }
}

const config = loadConfig();
const API_KEY = config.videodb_api_key || process.env.VIDEO_DB_API_KEY;
const BASE_URL = config.videodb_backend_url || "https://api.videodb.io";
const CONFIGURED_WEBHOOK_URL = config.webhook_url || "";
const API_PORT = config.recorder_port || process.env.RECORDER_PORT || 8899;
const HOOK_SOCKET_PATH = "/tmp/videodb-hook.sock";

// Indexing configuration from config file
// model_name per channel: valid options are mini, basic, pro, ultra
const INDEXING_CONFIG = {
  visual: config.visual_index || {},
  system_audio: config.system_audio_index || {},
  mic: config.mic_index || {},
};

// Claude CLI configuration: plugin defaults ← user overrides (config.claude section)
function loadClaudeConfig() {
  var defaults;
  try {
    defaults = JSON.parse(fs.readFileSync(path.join(__dirname, "claude.config.json"), "utf8"));
  } catch (e) {
    defaults = {};
  }
  var user = config.claude || {};
  return {
    agent: user.agent || defaults.agent || "pair-programmer:cortex",
    maxTurns: user.max_turns || defaults.max_turns || 50,
    allowedTools: user.allowed_tools || defaults.allowed_tools || ["Read", "Write", "Task"],
    dangerouslySkipPermissions: user.dangerously_skip_permissions !== undefined
      ? user.dangerously_skip_permissions
      : defaults.dangerously_skip_permissions !== undefined
        ? defaults.dangerously_skip_permissions
        : true,
    defaultModel: user.default_model || defaults.default_model || "sonnet",
  };
}
const CLAUDE_CONFIG = loadClaudeConfig();

// Project root from env (set by hook scripts), fallback to cwd
const PROJECT_ROOT = process.env.PROJECT_DIR || process.cwd();
const UI_DIR = path.join(__dirname, "ui");
const BIN_DIR = path.join(__dirname, "bin");


// =============================================================================
// Module State
// =============================================================================

const recordingState = new RecordingState();

const defaultBufferSize = config.context_buffer_size || 50;
const contextBuffer = new ContextBufferManager(recordingState, {
  bufferSizes: {
    screen: config.context_buffer_size_screen ?? defaultBufferSize,
    mic: config.context_buffer_size_mic ?? defaultBufferSize,
    system_audio: config.context_buffer_size_system_audio ?? defaultBufferSize,
  },
});

const tunnelManager = new TunnelManager(BIN_DIR);

let webhookUrl = null;
let apiHttpServer = null;
let overlayManager = null;
let trayManager = null;
let pickerManager = null;

// VideoDB SDK instances
let conn = null;
let captureSession = null;
let captureClient = null;
let wsConnection = null;

// Runtime indexing config (overrides defaults from INDEXING_CONFIG)
let runtimeIndexingConfig = null;

// Active claude child process (cortex agent) — tracked so we can kill on cancel/shutdown
let claudeProcess = null;
let claudeSessionId = null;
let hookSocketServer = null;

// Saved recording config — used to restart recording after a claude session retry
let lastRecordingChannels = null;
let lastRecordingIndexingConfig = null;

// Runtime model selection — mutable via overlay dropdown
let runtimeModel = CLAUDE_CONFIG.defaultModel;


// =============================================================================
// VideoDB SDK Integration
// =============================================================================

async function initializeVideoDB() {
  if (!API_KEY) {
    console.error("No API key configured. Run /pair-programmer:record-config to set up.");
    return false;
  }

  try {
    conn = connect({ apiKey: API_KEY, baseUrl: BASE_URL });
    console.log("✓ Connected to VideoDB");
    return true;
  } catch (e) {
    console.error("Failed to connect to VideoDB:", e.message);
    return false;
  }
}

async function createSession() {
  if (!conn) {
    throw new Error("Not connected to VideoDB");
  }

  // Build session config
  const sessionConfig = {
    endUserId: "electron_user",
    metadata: { app: "vdb-recorder-demo" },
  };

  if (webhookUrl) {
    sessionConfig.callbackUrl = webhookUrl;
  }

  captureSession = await conn.createCaptureSession(sessionConfig);

  // Generate client token
  const token = await conn.generateClientToken(3600); // 1 hour

  // Create capture client with token and base URL
  captureClient = new CaptureClient({ sessionToken: token, apiUrl: BASE_URL });


  console.log(`✓ Session created: ${captureSession.id}`);
  return { sessionId: captureSession.id, token };
}

async function startIndexingForRTStreams(rtstreams) {
  try {
    if (!rtstreams || rtstreams.length === 0) {
      console.error("[Indexing] No RTStreams provided!");
      return;
    }

    // Connect WebSocket for receiving indexing results
    wsConnection = await conn.connectWebsocket();
    await wsConnection.connect();
    console.log(`✓ WebSocket connected: ${wsConnection.connectionId}`);

    // Get collection to fetch RTStream objects (await is required!)
    const coll = await conn.getCollection();

    // Get effective indexing config (defaults + runtime overrides)
    const indexingConfig = getIndexingConfig(INDEXING_CONFIG, runtimeIndexingConfig);

    for (const stream of rtstreams) {
      const rtstream_id = stream.rtstream_id || stream.id;
      const name = stream.name || stream.channel_id || "";
      const mediaTypes = stream.media_types || [];

      if (!rtstream_id) {
        console.log("[Indexing] Skipping stream with no ID:", stream);
        continue;
      }

      // Find matching entry in recordingState.rtstreams to enrich with index ID
      const rtstreamEntry = (recordingState.rtstreams || []).find(
        (r) => r.rtstream_id === rtstream_id
      );

      try {
        // Get RTStream object from collection
        const rtstream = await coll.getRTStream(rtstream_id);

        if (mediaTypes.includes("video")) {
          // Visual indexing for video/display streams
          if (!indexingConfig.visual.enabled) {
            console.log(`[Indexing] Visual indexing disabled, skipping ${name}`);
            continue;
          }
          
          const visualOpts = {
            prompt: indexingConfig.visual.prompt,
            batchConfig: { 
              type: "time", 
              value: indexingConfig.visual.batch_time, 
              frameCount: indexingConfig.visual.frame_count 
            },
            modelName: indexingConfig.visual.model_name || "mini",
            socketId: wsConnection.connectionId,
          };
          console.log("This is visualOpts", visualOpts)
          const sceneIndex = await rtstream.indexVisuals(visualOpts);
          if (sceneIndex && rtstreamEntry) {
            rtstreamEntry.scene_index_id = sceneIndex.rtstreamIndexId;
            rtstreamEntry.index_type = "screen";
          }
          if (sceneIndex) {
            console.log(`✓ Visual index created for ${name} (index: ${sceneIndex.rtstreamIndexId})`);
          }
        } else if (mediaTypes.includes("audio")) {
          // Determine if this is mic or system_audio based on stream name
          const isMic = name.toLowerCase().includes("mic");
          const streamConfig = isMic ? indexingConfig.mic : indexingConfig.system_audio;
          const indexType = isMic ? "mic" : "system_audio";
          
          if (!streamConfig.enabled) {
            console.log(`[Indexing] ${indexType} indexing disabled, skipping ${name}`);
            continue;
          }
          
          const audioOpts = {
            prompt: streamConfig.prompt,
            batchConfig: { 
              type: streamConfig.batch_type, 
              value: streamConfig.batch_value 
            },
            modelName: streamConfig.model_name || "mini",
            socketId: wsConnection.connectionId,
          };
          const audioIndex = await rtstream.indexAudio(audioOpts);
          if (audioIndex && rtstreamEntry) {
            rtstreamEntry.scene_index_id = audioIndex.rtstreamIndexId;
            rtstreamEntry.index_type = indexType;
          }
          if (audioIndex) {
            console.log(`✓ ${indexType} index created for ${name} (index: ${audioIndex.rtstreamIndexId})`);
          }
        } else {
          console.log(`[Indexing] Unknown media types for ${name}:`, mediaTypes);
        }
      } catch (e) {
        console.error(`[Indexing] Failed to start indexing for ${rtstream_id}:`, e.message);
      }
    }

    // Listen to WebSocket events for indexing results
    listenToWebSocketEvents();
    
  } catch (e) {
    console.error("[Indexing] Failed to start indexing:", e.message, e.stack);
  }
}

async function listenToWebSocketEvents() {
  if (!wsConnection) return;

  try {
    for await (const ev of wsConnection.receive()) {
      const channel = ev.channel || ev.type;

      if (channel === "transcript") {
        const text = ev.data?.text;
        const transcriptType = (ev.rtstream_name || "").includes("system")
          ? "system_audio"
          : "mic";
        const rawFinal = ev.data?.is_final;
        const isFinal = rawFinal === true || rawFinal === "true";
        contextBuffer.add(transcriptType, {
          text: text,
          isFinal,
        });
      } else if (channel === "visual_index") {
        const text = ev.data?.text;
        contextBuffer.add("screen", {
          text: text,
          start: ev.data?.start,
        });
        const startTs = ev.data?.start;
        if (startTs) {
          const startMs = startTs > 1e12 ? startTs : startTs * 1000;
          recordingState.setVisualLatency(Math.max(0, Date.now() - startMs));
        }
      } else if (channel === "audio_index") {
        const text = ev.data?.text;
        const type = (ev.rtstream_name || "").includes("system")
          ? "system_audio"
          : "mic";
        contextBuffer.add(type, { text: text, start: ev.data?.start });
      }
    }
  } catch (_) {}
}

// =============================================================================
// Permissions
// =============================================================================

async function checkAndRequestPermissions() {
  if (!captureClient) {
    console.log("CaptureClient not available, skipping permission requests");
    return;
  }
  try {
    await captureClient.requestPermission("screen-capture");
    await captureClient.requestPermission("microphone");
    console.log("✓ Permissions requested via CaptureClient");
  } catch (e) {
    console.warn("Permission request failed:", e.message);
  }
}

// =============================================================================
// Recording Control
// =============================================================================

async function startRecording(selectedChannels, indexingConfigOverride = null) {
  if (recordingState.active) {
    return { status: "error", error: "Already recording" };
  }

  // Store runtime indexing config override
  runtimeIndexingConfig = indexingConfigOverride;
  if (runtimeIndexingConfig) {
    console.log("[Recording] Using runtime indexing config:", JSON.stringify(runtimeIndexingConfig, null, 2));
  }

  try {
    // Create session if not exists
    if (!captureSession || !captureClient) {
      await createSession();
    }

    const availableChannels = await captureClient.listChannels();

    // Use selected or default channels
    let channels = selectedChannels;
    if (!channels) {
      const mic = availableChannels.mics.default;
      const systemAudio = availableChannels.systemAudio.default;
      const display = availableChannels.displays.default;

      channels = [mic, systemAudio, display].filter(Boolean).map((c) => ({
        channelId: c.id,
        type: c.type,
        record: true,
        store: true,
      }));
    }

    // Save config for potential restart after claude session retry
    lastRecordingChannels = channels;
    lastRecordingIndexingConfig = indexingConfigOverride;

    recordingState.setChannels(channels.map((c) => channelIdToDisplayName(c.channelId)));

    const capturePayload = {
      sessionId: captureSession.id,
      channels,
    };
    console.log("Starting capture with payload:", JSON.stringify(capturePayload, null, 2));

    await captureClient.startSession(capturePayload);

    return { status: "ok", sessionId: captureSession.id };
  } catch (e) {
    console.error("Start recording error:", e);
    return { status: "error", error: e.message };
  }
}

async function stopRecording() {
  if (!recordingState.active || !captureClient) {
    return { status: "error", error: "Not recording" };
  }

  try {
    await captureClient.stopSession();

    const duration = recordingState.duration;

    // Clear runtime indexing config
    runtimeIndexingConfig = null;

    return { status: "ok", duration };
  } catch (e) {
    console.error("Stop recording error:", e);
    return { status: "error", error: e.message };
  }
}


// =============================================================================
// HTTP API Route Handlers
// =============================================================================

function handleGetStatus() {
  return {
    status: "ok",
    ...recordingState.toApiPayload(),
    claudeSessionId,
    claudeProcessPid: claudeProcess ? claudeProcess.pid : null,
    bufferCounts: contextBuffer.getCounts(),
  };
}

async function handleStartRecord(body) {
  if (!body.channels) {
    if (!captureSession || !captureClient) await createSession();
    let videoChannels = [];
    try {
      const available = await captureClient.listChannels();
      videoChannels = Array.from(available.displays || []);
    } catch (e) {
      console.warn("[API] listChannels failed, picker will use fallback:", e.message);
    }
    const pickerResult = await pickerManager.show(videoChannels);
    if (!pickerResult) {
      return { status: "cancelled", error: "User cancelled picker" };
    }
    return startRecording(buildChannelsFromPicker(pickerResult), body.indexing_config);
  }
  return startRecording(body.channels, body.indexing_config);
}

async function handleStopRecord() {
  return stopRecording();
}

async function handleRTStreamSearch(body) {
  const rtstreamId = body.rtstream_id || body.rtstreamId;
  const query = body.query;
  if (!rtstreamId || !query || typeof query !== "string") {
    return { status: "error", error: "rtstream_id and query (string) required" };
  }
  if (!conn) {
    return { status: "error", error: "Not connected to VideoDB" };
  }
  const coll = await conn.getCollection();
  const rtstream = await coll.getRTStream(rtstreamId);
  const searchResult = await rtstream.search({ query });
  const serialized = searchResult?.shots != null
    ? { shots: searchResult.shots }
    : (searchResult && typeof searchResult === "object" ? { ...searchResult } : { data: searchResult });
  return { status: "ok", ...serialized };
}

async function handleUpdatePrompt(body) {
  const rtstreamId = body.rtstream_id || body.rtstreamId;
  const sceneIndexId = body.scene_index_id || body.sceneIndexId;
  const prompt = body.prompt;
  if (!rtstreamId || !sceneIndexId || !prompt || typeof prompt !== "string") {
    return { status: "error", error: "rtstream_id, scene_index_id, and prompt (string) required" };
  }
  if (!conn) {
    return { status: "error", error: "Not connected to VideoDB" };
  }
  const coll = await conn.getCollection();
  const rtstream = await coll.getRTStream(rtstreamId);
  const sceneIndex = await rtstream.getSceneIndex(sceneIndexId);
  await sceneIndex.updateSceneIndex(prompt);

  const rtstreamEntry = (recordingState.rtstreams || []).find(
    (r) => r.rtstream_id === rtstreamId && r.scene_index_id === sceneIndexId
  );
  const indexType = rtstreamEntry?.index_type;
  const configKeyMap = { screen: "visual_index", mic: "mic_index", system_audio: "system_audio_index" };
  const configKey = configKeyMap[indexType];
  if (configKey) {
    try {
      const currentConfig = loadConfig();
      if (!currentConfig[configKey]) currentConfig[configKey] = {};
      currentConfig[configKey].prompt = prompt;
      writeConfig(currentConfig);
    } catch (e) {
      console.error("[Update Prompt] Failed to update config:", e.message);
    }
  }
  return { status: "ok", message: "Scene index prompt updated", index_type: indexType || "unknown" };
}

async function handlePermissionPrompt(body) {
  const toolName = body.tool_name || "Unknown";
  const toolInput = body.tool_input || {};
  console.log(`[API] Permission prompt for tool: ${toolName}`);
  const decision = await overlayManager.showPermissionPrompt({ toolName, toolInput });
  console.log(`[API] Permission decision: ${decision}`);
  return { status: "ok", decision };
}

function killClaudeProcess(reason) {
  if (!claudeProcess) return false;
  const pid = claudeProcess.pid;
  console.log(`[Assistant] Killing claude process PID ${pid} (${reason})`);
  try {
    process.kill(pid, "SIGTERM");
    // Give it 2s to exit gracefully, then force-kill
    setTimeout(() => {
      try { process.kill(pid, "SIGKILL"); } catch (_) {}
    }, 2000);
  } catch (_) {}
  claudeProcess = null;
  return true;
}

function handleShutdown() {
  console.log("[API] Shutdown requested via /api/shutdown");
  // Respond immediately, then trigger graceful shutdown async
  setImmediate(() => exitGracefully("API /api/shutdown"));
  return { status: "ok", message: "Shutdown initiated" };
}

// =============================================================================
// HTTP API Server
// =============================================================================

function killProcessOnPort(port) {
  if (process.platform === "win32") return;
  try {
    const out = execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: "utf8" });
    const pids = out.trim().split(/\n/).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), "SIGKILL");
      } catch (_) {}
    }
    if (pids.length) console.log(`Killed previous process(es) on port ${port}: ${pids.join(", ")}`);
  } catch (_) {}
}

function cleanupStaleBinary() {
  const stalePath = path.join(__dirname, "videodb-recorder");
  try {
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
      console.log("✓ Removed stale videodb-recorder binary");
    }
  } catch (_) {}
}

function startAPIServer() {
  killProcessOnPort(API_PORT);
  cleanupStaleBinary();
  contextBuffer.cleanup();
  const server = http.createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    
    // Log all incoming requests
    console.log(`[API] ${req.method} ${url}`);
    
    res.setHeader("Content-Type", "application/json");

    // Parse body for POST requests
    let body = "";
    if (req.method === "POST") {
      for await (const chunk of req) body += chunk;
      try {
        body = JSON.parse(body || "{}");
      } catch {
        body = {};
      }
    }

    const routes = {
      "GET /api/status": () => handleGetStatus(),
      "POST /api/record/start": () => handleStartRecord(body),
      "POST /api/record/stop": () => handleStopRecord(),
      "POST /api/rtstream/search": () => handleRTStreamSearch(body),
      "POST /api/rtstream/update-prompt": () => handleUpdatePrompt(body),
      "POST /api/overlay/show": () => overlayManager.show(body.text, { loading: body.loading }),
      "POST /api/overlay/hide": () => overlayManager.hide(),
      "GET /api/claude-session": () => ({ status: "ok", claudeSessionId }),
      "POST /api/permission-prompt": () => handlePermissionPrompt(body),
      "POST /api/shutdown": () => handleShutdown(),
      "POST /webhook": async () => {
        handleWebhookEvent(body).catch(e => {
          console.error("[Webhook] Error processing event:", e.message);
        });
        return { status: "ok" };
      },
    };

    const routeKey = `${req.method} ${url}`;
    const handler = routes[routeKey];

    let result;
    try {
      if (handler) {
        result = await handler();
      } else if (url.startsWith("/api/context/")) {
        const type = url.split("/").pop();
        result = type === "all"
          ? { status: "ok", ...contextBuffer.getAll() }
          : { status: "ok", [type]: contextBuffer.getRecent(type, 20) };
      } else {
        result = { status: "error", error: "Unknown endpoint" };
      }
    } catch (e) {
      result = { status: "error", error: e.message };
    }

    res.end(JSON.stringify(result));
  });

  server.listen(API_PORT, "127.0.0.1", () => {
    console.log(`✓ API server running on http://localhost:${API_PORT}`);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.warn(`Port ${API_PORT} in use, API server disabled`);
    }
  });

  apiHttpServer = server;
}

// =============================================================================
// Unix Socket Server (fast IPC for hooks)
// =============================================================================

const HOOK_LOG_PATH = "/tmp/videodb-hook.log";
function hookLog(msg) {
  try { fs.appendFileSync(HOOK_LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch (_) {}
}
function toolDetail(name, input) {
  try {
    const i = typeof input === "string" ? JSON.parse(input) : input;
    if (!i) return "";
    if (name === "Task") {
      const agent = (i.subagent_type || i.agent_type || "").split(":").pop();
      const desc = i.description || "";
      return agent ? ` → ${agent}${desc ? " (" + desc.substring(0, 40) + ")" : ""}` : "";
    }
    if (name === "Bash") {
      const cmd = (i.command || "").substring(0, 60).replace(/\n/g, " ");
      return cmd ? ` → ${cmd}` : "";
    }
    if (name === "Read" || name === "Write" || name === "Edit") return i.file_path ? ` → ${i.file_path}` : "";
    if (name === "Grep") return i.pattern ? ` → ${i.pattern}` : "";
    if (name === "Search") return i.query ? ` → "${i.query.substring(0, 40)}"` : "";
    if (name.startsWith("mcp__")) {
      const short = name.split("__").pop();
      if (short === "show_overlay") return i.loading ? " → loading" : ` → ${(i.text || "").substring(0, 40)}`;
      if (short === "get_status") return "";
      if (short === "search_rtstream") return i.query ? ` → "${i.query.substring(0, 40)}"` : "";
    }
  } catch (_) {}
  return "";
}
const KNOWN_AGENTS = new Set(["code-eye", "voice", "hearing", "narrator"]);
function extractAgentType(input) {
  try {
    const i = typeof input === "string" ? JSON.parse(input) : input;
    if (!i) return null;
    // Check explicit fields first
    for (const key of ["subagent_type", "agent_type"]) {
      if (i[key]) {
        const name = i[key].split(":").pop();
        if (KNOWN_AGENTS.has(name)) return name;
      }
    }
    // Scan description / prompt for known agent names
    const text = ((i.description || "") + " " + (i.prompt || "")).toLowerCase();
    for (const agent of KNOWN_AGENTS) {
      if (text.includes(agent)) return agent;
    }
    return null;
  } catch (_) { return null; }
}

function startHookSocket() {
  try { fs.unlinkSync(HOOK_SOCKET_PATH); } catch (_) {}
  try { fs.writeFileSync(HOOK_LOG_PATH, ""); } catch (_) {} // reset log on start

  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => { buf += chunk; });
    conn.on("end", () => {
      if (!buf.trim()) return;
      try {
        const data = JSON.parse(buf);
        const event = data.hook_event_name || data.event;
        if (!event) return;

        // Only show events from our cortex session
        const evtSession = data.session_id || data.sessionId;
        if (evtSession) {
          if (!claudeSessionId || evtSession !== claudeSessionId) {
            hookLog(`DROP ${event} session=${(evtSession || "").substring(0, 8)}…`);
            return;
          }
        } else if (claudeSessionId) {
          // No session_id on event but we have an active session — drop it
          hookLog(`DROP ${event} (no session_id, ignoring)`);
          return;
        }

        // Build the overlay payload from raw hook data
        const rawInput = data.tool_input || {};
        let payload;
        switch (event) {
          case "PreToolUse":
          case "PostToolUse":
          case "PostToolUseFailure": {
            let toolName = data.tool_name || "unknown";
            let toolInput = rawInput;
            const toolOutput = JSON.stringify(data.tool_output || "").substring(0, 500);

            // Detect sub-agent Task calls → emit SubagentStart/SubagentStop
            if (toolName === "Task") {
              const agentType = extractAgentType(rawInput);
              if (agentType) {
                const subEvent = event === "PreToolUse" ? "SubagentStart" : "SubagentStop";
                overlayManager.pushHookEvent({ event: subEvent, agent_type: agentType });
                hookLog(`${subEvent} ${agentType}`);
                break;
              }
            }

            // Detect search curl commands and rewrite as a clean search event
            if (toolName === "Bash" && typeof toolInput.command === "string" && toolInput.command.includes("rtstream/search")) {
              toolName = "Search";
              const qMatch = toolInput.command.match(/"query"\s*:\s*"([^"]+)"/);
              toolInput = qMatch ? { query: qMatch[1] } : {};
            }

            payload = { event, tool_name: toolName, tool_input: JSON.stringify(toolInput).substring(0, 300), tool_output: toolOutput };
            hookLog(`${event} ${toolName}${toolDetail(toolName, rawInput)}`);
            break;
          }
          case "Stop":
            payload = { event, stop_reason: data.stop_reason || "end_turn" };
            hookLog(`Stop (${payload.stop_reason})`);
            break;
          default:
            payload = { event };
            hookLog(event);
        }

        if (payload) overlayManager.pushHookEvent(payload);
      } catch (e) {
        hookLog(`ERROR ${e.message}`);
      }
    });
    conn.on("error", () => {});
  });

  server.listen(HOOK_SOCKET_PATH, () => {
    try { fs.chmodSync(HOOK_SOCKET_PATH, 0o666); } catch (_) {}
    console.log(`✓ Hook socket listening on ${HOOK_SOCKET_PATH}`);
  });

  server.on("error", (e) => {
    console.warn(`[HookSocket] Failed to start: ${e.message}`);
  });

  hookSocketServer = server;
}

// =============================================================================
// Webhook Handler
// =============================================================================

async function handleWebhookEvent(body) {
  const eventType = body.event || body.type;
  const sessionId = body.capture_session_id || body.session_id;
  
  console.log(`[Webhook] Event: ${eventType} for session: ${sessionId}`);
  console.log(`[Webhook] Full payload:\n${JSON.stringify(body, null, 2)}`);

  if (eventType === "capture_session.active") {
    console.log("[Webhook] Session is ACTIVE!");
    
    const data = body.data || {};
    const rtstreams = data.rtstreams || data.streams || data.channels || [];
    if (rtstreams.length === 0 && data && typeof data === "object") {
      console.log("[Webhook] No rtstreams in data. Keys received:", Object.keys(data));
    }
    console.log(`[Webhook] Found ${rtstreams.length} RTStreams in payload`);
    
    // Check if this is our session (captureSession exists = we initiated recording)
    const isOurSession = captureSession && captureSession.id === sessionId;

    if (isOurSession) {
      const normalized = (rtstreams || []).map((r) => ({
        rtstream_id: r.rtstream_id,
        name: r.name,
      }));
      if (!recordingState.active) {
        const channelNames = rtstreams.map((r) =>
          rtstreamNameToDisplayName(r.name || r.channel_id)
        );
        recordingState.markActive(sessionId, [...new Set(channelNames)], normalized);
      } else {
        recordingState.setRtstreams(normalized);
      }
      if (!wsConnection) {
        await startIndexingForRTStreams(rtstreams);
      } else {
        console.log("[Webhook] Indexing already started, rtstreams stored for status.");
      }
    } else {
      console.log(`[Webhook] Not our session (expected: ${captureSession?.id}, got: ${sessionId}), skipping`);
    }
  } else if (eventType === "capture_session.stopped") {
    console.log("[Webhook] Session stopped");
    recordingState.markStopped();
    if (wsConnection) {
      await wsConnection.close();
      wsConnection = null;
    }
  } else if (eventType === "capture_session.created") {
    console.log("[Webhook] Session created");
  } else if (eventType === "capture_session.starting") {
    console.log("[Webhook] Session starting");
    recordingState.markStarting();
  } else if (eventType === "capture_session.stopping") {
    console.log("[Webhook] Session stopping");
    recordingState.markStopping();
  } else if (eventType === "capture_session.exported") {
    const exportedId = body.data?.exported_video_id;
    const playerUrl = body.data?.player_url;
    console.log("[Webhook] Session exported", exportedId ? `video_id: ${exportedId}` : "", playerUrl ? `player: ${playerUrl}` : "");
    recordingState.markExported(exportedId, playerUrl);
  } else if (eventType === "capture_session.failed") {
    const err = body.data?.error || body.data || {};
    console.error("[Webhook] Session failed:", err);
    const message = err.message || "Recording failed";
    recordingState.markFailed(err.code || "RECORDING_FAILED", message);
    new Notification({
      title: "VideoDB Recording Failed",
      body: `${message}. Run /record again in Claude to start a new recording.`,
    }).show();
    if (wsConnection) {
      await wsConnection.close();
      wsConnection = null;
    }
  } else {
    console.log(`[Webhook] Unhandled event type: ${eventType}`);
  }
}

// =============================================================================
// Assistant Shortcut
// =============================================================================

function registerAssistantShortcut() {
  const shortcut = config.assistant_shortcut;
  if (!shortcut) {
    console.log("No assistant_shortcut configured, skipping");
    return;
  }

  const registered = globalShortcut.register(shortcut, () => {
    console.log(`[Assistant] Shortcut ${shortcut} triggered`);

    if (!claudeSessionId) {
      console.error("[Assistant] No claude session available");
      overlayManager.show("**No Claude session available.**\n\nSession was not created during startup. Restart the recorder to try again.");
      return;
    }

    overlayManager.show("", { loading: true });

    const args = [];
    if (process.env.PLUGIN_PATH) {
      args.push("--plugin-dir", process.env.PLUGIN_PATH);
    }

    args.push("--agent", CLAUDE_CONFIG.agent);
    args.push("--model", runtimeModel);
    if (CLAUDE_CONFIG.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
    for (const tool of CLAUDE_CONFIG.allowedTools) args.push("--allowedTools", tool);
    args.push("--max-turns", String(CLAUDE_CONFIG.maxTurns));

    const triggerPrompt = `User triggered the assistant shortcut. recorder_port: ${API_PORT}`;
    args.push("-r", claudeSessionId, "-p", triggerPrompt, "--output-format", "json");
    console.log(`[Assistant] Resuming session: ${claudeSessionId}`);

    // Kill any existing claude process before spawning a new one
    killClaudeProcess("new shortcut activation");

    console.log(`[Assistant] claude ${args.join(" ")}`);
    let stdout = "";
    const child = spawn("claude", args, {
      cwd: PROJECT_ROOT,
      stdio: ["inherit", "pipe", "inherit"],
      shell: false,
    });

    claudeProcess = child;
    console.log(`[Assistant] PID: ${child.pid}`);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", (err) => {
      console.error("[Assistant] Failed to run claude:", err.message);
      claudeProcess = null;
      new Notification({
        title: "Assistant Error",
        body: "Failed to run claude command",
      }).show();
    });

    child.on("close", (code) => {
      claudeProcess = null;
      try {
        const result = JSON.parse(stdout);
        if (result.session_id && result.session_id !== claudeSessionId) {
          claudeSessionId = result.session_id;
          console.log(`[Assistant] session=${claudeSessionId} exit=${code}`);
        } else {
          console.log(`[Assistant] exit=${code}`);
        }
      } catch (_) {
        console.log(`[Assistant] exit=${code}`);
      }
    });
  });

  if (registered) {
    console.log(`✓ Assistant shortcut registered: ${shortcut}`);
  } else {
    console.error(`✗ Failed to register shortcut: ${shortcut}`);
  }
}

// =============================================================================
// Claude Session Init
// =============================================================================

// Lightweight haiku handshake — no agent, no MCP, just get a session_id
function initClaudeSession() {
  const args = ["-p", "hi", "--model", "haiku", "--max-turns", "1", "--output-format", "json"];

  console.log(`[ClaudeSession] Creating session (haiku handshake)...`);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("claude", args, {
      cwd: PROJECT_ROOT,
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
    });

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message, stdout, stderr });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ success: false, code, stdout, stderr });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.session_id) {
          claudeSessionId = result.session_id;
          console.log(`✓ Claude session created: ${claudeSessionId}`);
          resolve({ success: true });
        } else {
          resolve({ success: false, code, stdout, stderr, error: "No session_id in response" });
        }
      } catch (e) {
        resolve({ success: false, code, stdout, stderr, error: e.message });
      }
    });
  });
}

// Async warm-up: resume the bare session with full cortex agent + MCP (fire-and-forget)
function warmUpClaudeSession() {
  if (!claudeSessionId) return;

  const args = [];
  if (process.env.PLUGIN_PATH) {
    args.push("--plugin-dir", process.env.PLUGIN_PATH);
  }
  args.push("--agent", CLAUDE_CONFIG.agent);
  args.push("--model", runtimeModel);
  if (CLAUDE_CONFIG.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
  for (const tool of CLAUDE_CONFIG.allowedTools) args.push("--allowedTools", tool);
  args.push("--max-turns", String(CLAUDE_CONFIG.maxTurns));
  args.push("-r", claudeSessionId, "-p", `Session initialized. recorder_port: ${API_PORT}`, "--output-format", "json");

  console.log(`[ClaudeSession] Warming up with cortex agent (model=${runtimeModel}, async)...`);

  const child = spawn("claude", args, {
    cwd: PROJECT_ROOT,
    stdio: ["inherit", "pipe", "inherit"],
    shell: false,
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });

  child.on("close", (code) => {
    console.log(`[ClaudeSession] Warm-up complete (exit ${code})`);
  });

  child.on("error", (err) => {
    console.warn("[ClaudeSession] Warm-up failed:", err.message);
  });
}

async function initClaudeSessionWithRetry() {
  while (true) {
    const result = await initClaudeSession();

    if (result.success) {
      // If recording was previously stopped due to session failure, restart it
      if (lastRecordingChannels && !recordingState.active) {
        console.log("[ClaudeSession] Restarting recording after successful retry...");
        try {
          await startRecording(lastRecordingChannels, lastRecordingIndexingConfig);
        } catch (e) {
          console.error("[ClaudeSession] Failed to restart recording:", e.message);
        }
      }
      return;
    }

    // Build error details
    const errorOutput = result.stderr || result.stdout || result.error || "Unknown error";
    const exitCode = result.code != null ? result.code : "N/A";

    // Log full details to hook log
    hookLog(
      `[ClaudeSession] FAILED (exit ${exitCode}) ` +
      `stdout: ${result.stdout || "(empty)"} ` +
      `stderr: ${result.stderr || "(empty)"} ` +
      `error: ${result.error || "(none)"}`
    );

    // Stop recording if it was active
    if (recordingState.active) {
      console.log("[ClaudeSession] Stopping active recording due to session failure...");
      await stopRecording();
    }

    // Show error overlay and block until user clicks Retry
    await overlayManager.showClaudeError(
      `Exit code: ${exitCode}\n\n${errorOutput}`
    );

    console.log("[ClaudeSession] User requested retry...");
  }
}

// =============================================================================
// App Lifecycle
// =============================================================================

app.whenReady().then(async () => {
  try {
    // Hide dock icon (menu bar app)
    if (process.platform === "darwin") {
      app.dock.hide();
    }
    // Initialize managers
    pickerManager = new PickerManager({ uiDir: UI_DIR });
    overlayManager = new OverlayManager(recordingState, {
      assistantShortcut: config.assistant_shortcut,
      uiDir: UI_DIR,
    });
    trayManager = new TrayManager(recordingState, {
      overlay: overlayManager,
      ctxBuffer: contextBuffer,
      onStartRecording: () => handleStartRecord({}),
      onStopRecording: () => handleStopRecord(),
    });
    trayManager.create();

    // IPC: serve context data to overlay
    ipcMain.handle("get-context", (_, type) => {
      if (type === "all") return contextBuffer.getAll();
      return { [type]: contextBuffer.getRecent(type, 50) };
    });

    // IPC: model selection from overlay dropdown
    ipcMain.on("model-change", (_, model) => {
      if (["haiku", "sonnet", "opus"].includes(model)) {
        runtimeModel = model;
        console.log(`[Model] Switched to: ${runtimeModel}`);
        overlayManager.pushModelConfig(runtimeModel);
      }
    });

    console.log("Starting VideoDB Recorder...");
    console.log("Config:", {
      apiKey: API_KEY ? `${API_KEY.substring(0, 10)}...` : "NOT SET",
      baseUrl: BASE_URL,
      configuredWebhookUrl: CONFIGURED_WEBHOOK_URL || "(not set, will use tunnel or websocket)",
      apiPort: API_PORT,
    });

    // ── Phase 1: Local infrastructure (no external deps, fast) ──
    startAPIServer();
    startHookSocket();

    // ── Phase 2: Parallel — VideoDB connection + Claude session ──
    // Haiku handshake blocks (fast), then cortex warm-up runs async
    const connectedPromise = initializeVideoDB();
    await initClaudeSessionWithRetry();
    overlayManager.showReady(); // show shortcut hint immediately; cortex warm-up will overwrite
    overlayManager.pushModelConfig(runtimeModel); // send initial model to overlay dropdown
    warmUpClaudeSession();
    const connected = await connectedPromise;
    if (!connected) {
      new Notification({
        title: "VideoDB Recorder",
        body: "Failed to connect. Run /pair-programmer:record-config to set up.",
      }).show();
    }

    // ── Phase 3: Webhook / tunnel (needs API server running) ──
    if (CONFIGURED_WEBHOOK_URL) {
      const baseUrl = CONFIGURED_WEBHOOK_URL.replace(/\/+$/, "");
      webhookUrl = `${baseUrl}/webhook`;
      console.log(`✓ Using configured webhook URL: ${webhookUrl}`);
    } else {
      console.log("No webhook_url configured, starting Cloudflare tunnel...");
      webhookUrl = await tunnelManager.start(API_PORT);
      if (webhookUrl) {
        webhookUrl = `${webhookUrl}/webhook`;
        console.log(`✓ Cloudflare tunnel ready: ${webhookUrl}`);
      } else {
        console.log("⚠ Tunnel failed, will use WebSocket for events");
        webhookUrl = null;
      }
    }

    if (webhookUrl) {
      const baseUrl = webhookUrl.replace(/\/webhook$/, "");
      const verifyStart = Date.now();
      const MAX_VERIFY_MS = 10000;
      const RETRY_MS = 500;
      let verified = false;

      console.log("Verifying webhook URL...");
      while (Date.now() - verifyStart < MAX_VERIFY_MS) {
        try {
          const resp = await fetch(`${baseUrl}/api/status`);
          await resp.json();
          console.log(`✓ Webhook URL verified in ${Date.now() - verifyStart}ms`);
          verified = true;
          break;
        } catch (_) {
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }

      if (!verified) {
        console.warn(`⚠ Webhook URL verification failed after ${MAX_VERIFY_MS}ms`);
      }
    }

    // ── Phase 4: Capture session (needs VideoDB + webhook URL) ──
    if (connected) {
      try {
        await createSession();
        console.log("✓ Session pre-created for permission requests");
      } catch (e) {
        console.warn("Pre-session creation failed:", e.message);
      }
    }

    // ── Phase 5: Permissions (needs captureClient from createSession) ──
    await checkAndRequestPermissions();

    trayManager.markStartupComplete();
    registerAssistantShortcut();

    new Notification({
      title: "VideoDB Recorder",
      body: webhookUrl
        ? `Ready with webhook: ${webhookUrl.substring(0, 40)}...`
        : "Ready (using WebSocket for events)",
    }).show();
  } catch (error) {
    console.error("Startup error:", error);
    new Notification({
      title: "VideoDB Recorder Error",
      body: error.message,
    }).show();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let shutdownPromise = null;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function shutdownApp() {
  console.log("[Shutdown] Starting cleanup...");

  killClaudeProcess("app shutdown");
  try { globalShortcut.unregisterAll(); } catch (_) {}
  try { if (trayManager) trayManager.destroy(); } catch (_) {}
  try { if (overlayManager) overlayManager.destroy(); } catch (_) {}

  if (hookSocketServer) {
    try { hookSocketServer.close(); } catch (_) {}
    try { fs.unlinkSync(HOOK_SOCKET_PATH); } catch (_) {}
    hookSocketServer = null;
    console.log("[Shutdown] Hook socket closed");
  }

  if (apiHttpServer) {
    try {
      await withTimeout(
        new Promise((resolve) => apiHttpServer.close(() => resolve())),
        2000
      );
      apiHttpServer.unref();
      apiHttpServer = null;
      console.log("[Shutdown] API server closed");
    } catch (_) {}
  }

  if (captureClient) {
    try {
      await withTimeout(captureClient.stopSession(), 3000);
      console.log("[Shutdown] Capture session stopped");
    } catch (_) {}
    try {
      await withTimeout(captureClient.shutdown(), 3000);
      console.log("[Shutdown] CaptureClient shutdown complete");
    } catch (_) {}
    captureClient = null;
  }

  if (wsConnection) {
    try { await withTimeout(wsConnection.close(), 2000); } catch (_) {}
    wsConnection = null;
    console.log("[Shutdown] WebSocket closed");
  }

  try { await withTimeout(tunnelManager.stop(), 2000); } catch (_) {}
  contextBuffer.cleanup();
  console.log("[Shutdown] Cleanup complete");
}

function exitGracefully(source) {
  console.log(`[Shutdown] ${source}`);

  // All callers share the same shutdown promise — second caller waits for the
  // first cleanup to finish instead of resolving immediately and calling exit.
  if (!shutdownPromise) {
    const forceExit = setTimeout(() => {
      console.error("[Shutdown] Force exit (timeout)");
      process.exit(1);
    }, 10000);
    forceExit.unref();

    shutdownPromise = shutdownApp();
  }

  shutdownPromise
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

app.on("before-quit", (e) => {
  e.preventDefault();
  exitGracefully("before-quit");
});

process.on("SIGINT", () => exitGracefully("Received SIGINT"));
process.on("SIGTERM", () => exitGracefully("Received SIGTERM"));

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  contextBuffer,
  recordingState,
  startRecording,
  stopRecording,
  get overlayManager() { return overlayManager; },
};
