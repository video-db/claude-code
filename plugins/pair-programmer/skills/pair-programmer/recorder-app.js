#!/usr/bin/env electron
const path = require("path");
const fs = require("fs");

const {
  app,
  Notification,
  ipcMain,
} = require("electron");

// Reduce Electron/Chromium memory footprint — we only render a tiny widget
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=64");
const http = require("http");
const net = require("net");
const { execSync } = require("child_process");
const { connect } = require("videodb");
const { CaptureClient } = require("videodb/capture");

const RecordingState = require("./lib/recording-state");
const ContextBufferManager = require("./lib/context-buffer");
const OverlayManager = require("./lib/overlay-manager");
const TrayManager = require("./lib/tray-manager");
const WidgetManager = require("./lib/widget-manager");
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
const API_PORT = config.recorder_port || process.env.RECORDER_PORT || 8899;
const HOOK_SOCKET_PATH = "/tmp/videodb-hook.sock";

// Indexing configuration from config file
// model_name per channel: valid options are mini, basic, pro, ultra
const INDEXING_CONFIG = {
  visual: config.visual_index || {},
  system_audio: config.system_audio_index || {},
  mic: config.mic_index || {},
};

const UI_DIR = path.join(__dirname, "ui");


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

let apiHttpServer = null;
let overlayManager = null;
let trayManager = null;
let widgetManager = null;
let pickerManager = null;
let lastPickerChannels = null;

// VideoDB SDK instances
let conn = null;
let captureSession = null;
let captureClient = null;
let wsConnection = null;

// Runtime indexing config (overrides defaults from INDEXING_CONFIG)
let runtimeIndexingConfig = null;

let hookSocketServer = null;



// =============================================================================
// VideoDB SDK Integration
// =============================================================================

async function initializeVideoDB() {
  if (!API_KEY) {
    console.error("No API key configured. Run /pair-programmer:setup to set up.");
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

  // Establish WebSocket — reconnect if stale (API Gateway drops idle connections after ~10min)
  if (!wsConnection || !wsConnection.isConnected) {
    if (wsConnection) {
      try { await wsConnection.close(); } catch (_) {}
      wsConnection = null;
    }
    wsConnection = await conn.connectWebsocket();
    await wsConnection.connect();
    console.log(`✓ WebSocket connected: ${wsConnection.connectionId}`);
    listenToWebSocketEvents();
  }

  const sessionConfig = {
    endUserId: "electron_user",
    metadata: { app: "vdb-recorder-demo" },
    wsConnectionId: wsConnection.connectionId,
  };

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

    if (!wsConnection) {
      console.error("[Indexing] WebSocket not connected, cannot start indexing");
      return;
    }

    const coll = await conn.getCollection();
    const indexingConfig = getIndexingConfig(INDEXING_CONFIG, runtimeIndexingConfig);

    for (const stream of rtstreams) {
      const rtstream_id = stream.rtstream_id || stream.id;
      const name = stream.name || stream.channel_id || "";
      const mediaTypes = stream.media_types || [];

      if (!rtstream_id) {
        console.log("[Indexing] Skipping stream with no ID:", stream);
        continue;
      }

      const rtstreamEntry = (recordingState.rtstreams || []).find(
        (r) => r.rtstream_id === rtstream_id
      );

      try {
        const rtstream = await coll.getRTStream(rtstream_id);

        if (mediaTypes.includes("video")) {
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
          const sceneIndex = await rtstream.indexVisuals(visualOpts);
          if (sceneIndex && rtstreamEntry) {
            rtstreamEntry.scene_index_id = sceneIndex.rtstreamIndexId;
            rtstreamEntry.index_type = "screen";
          }
          if (sceneIndex) {
            console.log(`✓ Visual index created for ${name} (index: ${sceneIndex.rtstreamIndexId})`);
          }
        } else if (mediaTypes.includes("audio")) {
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
  } catch (e) {
    console.error("[Indexing] Failed to start indexing:", e.message, e.stack);
  }
}

async function listenToWebSocketEvents() {
  console.log("Started listening to websocket")
  if (!wsConnection) return;

  try {
    for await (const ev of wsConnection.receive()) {
      const channel = ev.channel;

      if (channel === "capture_session") {
        handleCaptureSessionEvent(ev).catch((e) => {
          console.error("[WS] Error processing capture_session event:", e.message);
        });
      } else if (channel === "transcript") {
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
  } catch (e) {
    console.warn("[WS] Listener error:", e.message);
  }

  // WS disconnected — clear reference so createSession() reconnects
  console.log("[WS] Connection closed, will reconnect on next session");
  wsConnection = null;
}

async function handleCaptureSessionEvent(ev) {
  const eventType = ev.event || ev.type;
  const sessionId = ev.capture_session_id || ev.session_id;

  console.log(`[WS] Capture event: ${eventType} for session: ${sessionId}`);

  if (eventType === "capture_session.active") {
    console.log("[WS] Session is ACTIVE!");

    const data = ev.data || {};
    const rtstreams = data.rtstreams || data.streams || data.channels || [];
    if (rtstreams.length === 0 && data && typeof data === "object") {
      console.log("[WS] No rtstreams in data. Keys received:", Object.keys(data));
    }
    console.log(`[WS] Found ${rtstreams.length} RTStreams in payload`);

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
      await startIndexingForRTStreams(rtstreams);
    } else {
      console.log(`[WS] Not our session (expected: ${captureSession?.id}, got: ${sessionId}), skipping`);
    }
  } else if (eventType === "capture_session.stopped") {
    console.log("[WS] Session stopped");
    recordingState.markStopped();
  } else if (eventType === "capture_session.created") {
    console.log("[WS] Session created");
  } else if (eventType === "capture_session.starting") {
    console.log("[WS] Session starting");
    recordingState.markStarting();
  } else if (eventType === "capture_session.stopping") {
    console.log("[WS] Session stopping");
    recordingState.markStopping();
  } else if (eventType === "capture_session.exported") {
    const exportedId = ev.data?.exported_video_id;
    const playerUrl = ev.data?.player_url;
    console.log("[WS] Session exported", exportedId ? `video_id: ${exportedId}` : "", playerUrl ? `player: ${playerUrl}` : "");
    recordingState.markExported(exportedId, playerUrl);
  } else if (eventType === "capture_session.failed") {
    const err = ev.data?.error || ev.data || {};
    console.error("[WS] Session failed:", err);
    const message = err.message || "Recording failed";
    recordingState.markFailed(err.code || "RECORDING_FAILED", message);
    new Notification({
      title: "VideoDB Recording Failed",
      body: `${message}. Run /record again in Claude to start a new recording.`,
    }).show();
  } else {
    console.log(`[WS] Unhandled capture event type: ${eventType}`);
  }
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
    const { systemPreferences } = require("electron");
    const hasScreen = systemPreferences.getMediaAccessStatus("screen") === "granted";
    const hasMic = systemPreferences.getMediaAccessStatus("microphone") === "granted";

    if (hasScreen && hasMic) {
      console.log("✓ Permissions already granted, skipping requests");
      return;
    }

    if (!hasScreen) await captureClient.requestPermission("screen-capture");
    if (!hasMic) await captureClient.requestPermission("microphone");
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
    // Create session if not exists, or recreate if WS dropped
    if (!captureSession || !captureClient || !wsConnection || !wsConnection.isConnected) {
      captureSession = null;
      captureClient = null;
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

    recordingState.setChannels(channels.map((c) => channelIdToDisplayName(c.channelId)));

    const capturePayload = {
      sessionId: captureSession.id,
      channels,
    };
    console.log("Starting capture with payload:", JSON.stringify(capturePayload, null, 2));

    await captureClient.startSession(capturePayload);

    return { status: "ok", sessionId: captureSession.id };
  } catch (e) {
    // Handle stale BUSY state — force stop and retry once
    const isBusy = e.message && e.message.includes("BUSY");
    if (isBusy && captureClient) {
      console.log("[Recording] Stale session detected, force-stopping and retrying...");
      try {
        await captureClient.stopSession();
      } catch (_) {}
      recordingState.markStopped();
      // Recreate session and retry
      captureSession = null;
      captureClient = null;
      try {
        await createSession();
        const availableChannels = await captureClient.listChannels();
        let retryChannels = selectedChannels;
        if (!retryChannels) {
          const mic = availableChannels.mics.default;
          const systemAudio = availableChannels.systemAudio.default;
          const display = availableChannels.displays.default;
          retryChannels = [mic, systemAudio, display].filter(Boolean).map((c) => ({
            channelId: c.id, type: c.type, record: true, store: true,
          }));
        }
        recordingState.setChannels(retryChannels.map((c) => channelIdToDisplayName(c.channelId)));
        await captureClient.startSession({ sessionId: captureSession.id, channels: retryChannels });
        return { status: "ok", sessionId: captureSession.id };
      } catch (retryErr) {
        console.error("Retry after BUSY also failed:", retryErr);
        return { status: "error", error: retryErr.message };
      }
    }
    console.error("Start recording error:", e);
    return { status: "error", error: e.message };
  }
}

async function stopRecording() {
  if (!recordingState.active || !captureClient) {
    return { status: "error", error: "Not recording" };
  }

  // Mark stopping immediately so widget updates instantly
  recordingState.markStopping();

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


async function toggleRecording() {
  if (recordingState.active) {
    const result = await stopRecording();
    if (result.status === "ok") {
      const mins = Math.floor((result.duration || 0) / 60);
      const secs = (result.duration || 0) % 60;
      const dur = `${mins}:${secs.toString().padStart(2, "0")}`;
      console.log(`Recording stopped: ${dur} captured.`);
    }
    return result;
  }

  // Reuse previous picker selection if available (same session)
  if (lastPickerChannels) {
    return startRecording(lastPickerChannels);
  }

  // Show picker UI for display/audio source selection (first time only)
  if (pickerManager) {
    const videoChannels = captureClient ? (captureClient.channels || []).filter(c => c.type === "video") : [];
    const pickerResult = await pickerManager.show(videoChannels);
    if (!pickerResult) {
      return { status: "cancelled" };
    }
    const channels = buildChannelsFromPicker(pickerResult);
    lastPickerChannels = channels;
    return startRecording(channels);
  }
  return startRecording(null);
}

// =============================================================================
// HTTP API Route Handlers
// =============================================================================

function handleGetStatus() {
  return {
    status: "ok",
    ...recordingState.toApiPayload(),
    bufferCounts: contextBuffer.getCounts(),
  };
}

async function handleStartRecord(body) {
  // Use provided channels or auto-select defaults (null triggers default selection)
  return startRecording(body.channels || null, body.indexing_config);
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
      "POST /api/shutdown": () => handleShutdown(),
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
// App Lifecycle
// =============================================================================

app.whenReady().then(async () => {
  try {
    // Hide dock icon (menu bar app)
    if (process.platform === "darwin") {
      app.dock.hide();
    }
    // Initialize managers
    overlayManager = new OverlayManager();
    pickerManager = new PickerManager({ uiDir: UI_DIR });
    widgetManager = new WidgetManager(recordingState, {
      uiDir: UI_DIR,
      onToggleRecording: () => toggleRecording(),
      ctxBuffer: contextBuffer,
    });
    trayManager = new TrayManager(recordingState, {
      widget: widgetManager,
      ctxBuffer: contextBuffer,
      onStartRecording: () => handleStartRecord({}),
      onStopRecording: () => handleStopRecord(),
    });
    trayManager.create();

    console.log("Starting VideoDB Recorder...");
    console.log("Config:", {
      apiKey: API_KEY ? `${API_KEY.substring(0, 10)}...` : "NOT SET",
      baseUrl: BASE_URL,
      apiPort: API_PORT,
    });

    // ── Phase 1: Local infrastructure (no external deps, fast) ──
    startAPIServer();
    startHookSocket();
    widgetManager.show();

    // ── Phase 2: VideoDB connection ──
    const connected = await initializeVideoDB();
    if (!connected) {
      new Notification({
        title: "VideoDB Recorder",
        body: "Failed to connect. Run /pair-programmer:setup to set up.",
      }).show();
    }

    // ── Phase 3: Capture session + WebSocket (needs VideoDB connection) ──
    if (connected) {
      try {
        await createSession();
        console.log("✓ Session pre-created with WebSocket for events");
      } catch (e) {
        console.warn("Pre-session creation failed:", e.message);
      }
    }

    // ── Phase 4: Permissions (needs captureClient from createSession) ──
    await checkAndRequestPermissions();

    trayManager.markStartupComplete();

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
  try { if (trayManager) trayManager.destroy(); } catch (_) {}
  try { if (widgetManager) widgetManager.destroy(); } catch (_) {}
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
