#!/usr/bin/env node
/**
 * VideoDB Pair Programmer - Electron app with HTTP API for screen/audio recording.
 * Run: node recorder-app.js  or  npm start  (electron .)
 */

const path = require("path");
const fs = require("fs");

// =============================================================================
// ELECTRON MODE - App + HTTP API
// =============================================================================

const {
  app,
  Notification,
  Tray,
  Menu,
  screen,
  BrowserWindow,
  ipcMain,
  globalShortcut,
} = require("electron");
const http = require("http");
const { spawn, execSync } = require("child_process");
const { connect } = require("videodb");
const { CaptureClient } = require("videodb/capture");

// TODO: Uncomment to redirect [Recorder Binary] logs to separate file
// const originalConsoleLog = console.log;
// const originalConsoleError = console.error;
// const BINARY_LOG_FILE = "/tmp/recorder-binary.log";
//
// function logToBinaryFile(prefix, ...args) {
//   const timestamp = new Date().toISOString();
//   const message = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
//   fs.appendFileSync(BINARY_LOG_FILE, `[${timestamp}] ${prefix} ${message}\n`);
// }
//
// console.log = (...args) => {
//   if (args[0] && typeof args[0] === "string" && args[0].includes("[Recorder Binary")) {
//     logToBinaryFile("[LOG]", ...args);
//     return;
//   }
//   originalConsoleLog.apply(console, args);
// };
//
// console.error = (...args) => {
//   if (args[0] && typeof args[0] === "string" && args[0].includes("[Recorder Binary")) {
//     logToBinaryFile("[ERR]", ...args);
//     return;
//   }
//   originalConsoleError.apply(console, args);
// };

// =============================================================================
// Cloudflare Tunnel Manager (inline)
// =============================================================================

const TunnelManager = {
  process: null,
  cloudflaredPath: null,

  getCloudflaredPath() {
    if (this.cloudflaredPath && fs.existsSync(this.cloudflaredPath)) {
      return this.cloudflaredPath;
    }

    // Check if cloudflared is in PATH
    try {
      const result = execSync("which cloudflared", { encoding: "utf8" }).trim();
      if (result) {
        this.cloudflaredPath = result;
        return this.cloudflaredPath;
      }
    } catch (e) {}

    // Download cloudflared
    const binDir = path.join(__dirname, "bin");
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    const system = process.platform;
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const binaryPath = path.join(binDir, "cloudflared");

    if (!fs.existsSync(binaryPath)) {
      console.log("Downloading cloudflared...");
      const https = require("https");

      let url;
      if (system === "darwin") {
        url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`;
      } else {
        url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
      }

      // Sync download for simplicity
      try {
        if (system === "darwin") {
          execSync(
            `curl -L "${url}" -o "${binDir}/cloudflared.tgz" && tar -xzf "${binDir}/cloudflared.tgz" -C "${binDir}" && rm "${binDir}/cloudflared.tgz"`,
            { stdio: "inherit" }
          );
        } else {
          execSync(`curl -L "${url}" -o "${binaryPath}"`, { stdio: "inherit" });
        }
        fs.chmodSync(binaryPath, 0o755);
        console.log("✓ cloudflared downloaded");
      } catch (e) {
        console.error("Failed to download cloudflared:", e.message);
        return null;
      }
    }

    this.cloudflaredPath = binaryPath;
    return this.cloudflaredPath;
  },

  async start(port) {
    await this.stop();

    const cloudflared = this.getCloudflaredPath();
    if (!cloudflared) return null;

    return new Promise((resolve) => {
      this.process = spawn(
        cloudflared,
        ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
      let resolved = false;

      const handleData = (data) => {
        const line = data.toString();
        const match = line.match(urlPattern);
        if (match && !resolved) {
          resolved = true;
          resolve(match[0]);
        }
      };

      this.process.stdout.on("data", handleData);
      this.process.stderr.on("data", handleData);

      this.process.on("error", (e) => {
        console.error("Tunnel error:", e.message);
        if (!resolved) resolve(null);
      });

      // Timeout after 30s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 30000);
    });
  },

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  },
};

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

// Indexing configuration with defaults
const INDEXING_CONFIG = {
  visual: {
    enabled: config.visual_index?.enabled !== false,
    prompt: config.visual_index?.prompt || "Describe what is visible on the screen. Focus on code, text, UI elements, and any relevant technical details.",
    batch_time: config.visual_index?.batch_time || 2,
    frame_count: config.visual_index?.frame_count || 3,
  },
  system_audio: {
    enabled: config.system_audio_index?.enabled !== false,
    prompt: config.system_audio_index?.prompt || "Summarize what is being said. Focus on technical discussions, instructions, and key points.",
    batch_type: config.system_audio_index?.batch_type || "sentence",
    batch_value: config.system_audio_index?.batch_value || 3,
  },
  mic: {
    enabled: config.mic_index?.enabled !== false,
    prompt: config.mic_index?.prompt || "Transcribe and summarize what the user is saying.",
    batch_type: config.mic_index?.batch_type || "sentence",
    batch_value: config.mic_index?.batch_value || 3,
  },
};

// =============================================================================
// State
// =============================================================================

let tray = null;
let pickerWindow = null;
let overlayWindow = null;
let webhookUrl = null; // Will be set from config or cloudflare tunnel
let apiHttpServer = null; // HTTP API server, closed on quit to release port

// VideoDB SDK instances
let conn = null; // Connection to VideoDB
let captureSession = null; // CaptureSession object
let captureClient = null; // CaptureClient for recording
let wsConnection = null; // WebSocket for real-time events

// App startup: tray is shown immediately; menu shows "Starting..." until this is true
let startupComplete = false;

// Recording state
let recording = {
  active: false,
  starting: false,
  sessionId: null,
  startTime: null,
  channels: null,
  rtstreams: null, // [{ rtstream_id, name, scene_index_id, index_type }] from webhook; enriched after indexing
  failed: null, // { code, message } when capture_session.failed
};

function channelIdToDisplayName(channelId) {
  if (!channelId) return "unknown";
  if (channelId.startsWith("mic")) return "mic";
  if (channelId.startsWith("system_audio")) return "system_audio";
  if (channelId.startsWith("display")) return "screen";
  return channelId;
}

function matchDisplayToChannel(displayLabel, videoChannels) {
  if (!displayLabel || !Array.isArray(videoChannels) || videoChannels.length === 0)
    return null;
  const normalized = (s) => String(s || "").trim().toLowerCase();
  const label = normalized(displayLabel);
  const found = videoChannels.find(
    (c) => normalized(c.name) === label || normalized(c.extras?.name) === label
  );
  return found ? found.channelId : null;
}

function rtstreamNameToDisplayName(nameOrChannelId) {
  const s = (nameOrChannelId || "").toLowerCase();
  if (s === "mic" || s.startsWith("mic")) return "mic";
  if (s === "system_audio" || s.includes("system_audio")) return "system_audio";
  if (s === "display" || s === "screen" || s.startsWith("display")) return "screen";
  return s || "unknown";
}

// Runtime indexing config (overrides defaults from INDEXING_CONFIG)
let runtimeIndexingConfig = null;

// Get effective indexing config (runtime overrides defaults)
function getIndexingConfig() {
  const defaults = INDEXING_CONFIG;
  const runtime = runtimeIndexingConfig || {};
  
  return {
    visual: { ...defaults.visual, ...runtime.visual },
    system_audio: { ...defaults.system_audio, ...runtime.system_audio },
    mic: { ...defaults.mic, ...runtime.mic },
  };
}

// Project root from env (set by hook scripts), fallback to cwd
const PROJECT_ROOT = process.env.PROJECT_DIR || process.cwd();
const CONTEXT_FILE = path.join(__dirname, ".context.json");

// Three FIFO queues; each has its own max length from config.
const defaultBufferSize = config.context_buffer_size || 50;
const maxLen = {
  screen: config.context_buffer_size_screen ?? defaultBufferSize,
  mic: config.context_buffer_size_mic ?? defaultBufferSize,
  system_audio: config.context_buffer_size_system_audio ?? defaultBufferSize,
};

function fifoPush(q, item, maxLenForQueue) {
  q.push(item);
  if (q.length > maxLenForQueue) q.shift();
}

const contextBuffer = {
  screen: [],
  system_audio: [],
  mic: [],
  maxLen,
  lastMicNonFinal: null,
  lastSystemAudioNonFinal: null,

  add(type, record) {
    if (!this[type]) return;
    const item = { ...record, timestamp: new Date().toISOString() };
    if (type === "mic" || type === "system_audio") {
      const isFinal = record.isFinal === true || record.isFinal === "true";
      if (!isFinal) {
        if (type === "mic") this.lastMicNonFinal = item;
        else this.lastSystemAudioNonFinal = item;
        this._writeToFile();
        return;
      }
    }
    fifoPush(this[type], item, this.maxLen[type]);
    this._writeToFile();
  },

  getRecent(type, limit = 10) {
    return (this[type] || []).slice(-limit);
  },

  getAll() {
    return { screen: this.screen, system_audio: this.system_audio, mic: this.mic };
  },

  _writeToFile() {
    try {
      const micForFile = this.lastMicNonFinal ? [...this.mic, this.lastMicNonFinal] : this.mic;
      const systemAudioForFile = this.lastSystemAudioNonFinal
        ? [...this.system_audio, this.lastSystemAudioNonFinal]
        : this.system_audio;
      fs.writeFileSync(
        CONTEXT_FILE,
        JSON.stringify(
          {
            screen: this.screen,
            system_audio: systemAudioForFile,
            mic: micForFile,
            recording: {
              active: recording.active,
              sessionId: recording.sessionId,
              startTime: recording.startTime,
            },
            lastUpdated: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (e) {}
  },
};

// Hide dock icon (menu bar app)
if (process.platform === "darwin") {
  app.dock.hide();
}

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

  // Add callbackUrl if webhook is configured
  console.log("this is webhookUrl", webhookUrl)
  if (webhookUrl) {
    sessionConfig.callbackUrl = webhookUrl;
  }

  console.log("Creating capture session with config:", JSON.stringify(sessionConfig, null, 2));

  // Create capture session
  captureSession = await conn.createCaptureSession(sessionConfig);

  console.log("Session response:", {
    id: captureSession.id,
    callbackUrl: captureSession.callbackUrl,
    status: captureSession.status,
  });

  // Generate client token
  const token = await conn.generateClientToken(3600); // 1 hour

  // Create capture client with token and base URL
  captureClient = new CaptureClient({ sessionToken: token, apiUrl: BASE_URL });

  // Setup event handlers
  setupCaptureClientEvents();

  console.log(`✓ Session created: ${captureSession.id}`);
  return { sessionId: captureSession.id, token };
}

function setupCaptureClientEvents() {
  captureClient.on("recording:started", async (data) => {
    console.log("Recording started:", data);
    recording.failed = null;
    recording.active = true;
    recording.sessionId = captureSession.id;
    recording.startTime = Date.now();
    updateTray();
    pushOverlayStatus();

    // NOTE: Don't start indexing here!
    // Wait for webhook `capture_session.active` event, then start indexing
    console.log("Waiting for session to become active via webhook...");
  });

  captureClient.on("recording:stopped", (data) => {
    console.log("Recording stopped:", data);
    recording.active = false;
    recording.starting = false;
    recording.startTime = null;
    recording.channels = null;
    recording.failed = null;
    updateTray();
    pushOverlayStatus();

    // Close WebSocket
    if (wsConnection) {
      wsConnection.close();
      wsConnection = null;
    }
  });

  captureClient.on("recording:error", (data) => {
    console.error("Recording error:", data);
    recording.active = false;
    recording.starting = false;
    recording.channels = null;
    updateTray();
    pushOverlayStatus();
  });

  captureClient.on("transcript", (data) => {
    console.log("Transcript:", data.text?.substring(0, 50));
    contextBuffer.add("mic", { text: data.text, isFinal: data.isFinal });
  });

  captureClient.on("error", (data) => {
    console.error("[Binary Error]", JSON.stringify(data, null, 2));
  });

  captureClient.on("shutdown", (data) => {
    console.error("[Binary Shutdown]", JSON.stringify(data, null, 2));
    if (data.code !== 0) {
      console.error("[Binary] Unexpected exit with code:", data.code);
    }
  });

  captureClient.on("upload:progress", (data) => {
    console.log("[Upload Progress]", data.percent || data);
  });

  captureClient.on("upload:complete", (data) => {
    console.log("[Upload Complete]", data);
  });
}

async function startIndexingForRTStreams(rtstreams) {
  try {
    console.log("[Indexing] Starting indexing for RTStreams:", JSON.stringify(rtstreams, null, 2));
    
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
    const indexingConfig = getIndexingConfig();
    console.log("[Indexing] Using config:", JSON.stringify(indexingConfig, null, 2));

    for (const stream of rtstreams) {
      const rtstream_id = stream.rtstream_id || stream.id;
      const name = stream.name || stream.channel_id || "";
      const mediaTypes = stream.media_types || [];

      if (!rtstream_id) {
        console.log("[Indexing] Skipping stream with no ID:", stream);
        continue;
      }

      // Find matching entry in recording.rtstreams to enrich with index ID
      const rtstreamEntry = (recording.rtstreams || []).find(
        (r) => r.rtstream_id === rtstream_id
      );

      console.log(`[Indexing] Processing RTStream: ${rtstream_id} (${name}) - media_types: ${mediaTypes}`);

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
            modelName: "mini",
            socketId: wsConnection.connectionId,
          };
          console.log(`[Indexing] Starting visual indexing for ${name}:`, JSON.stringify(visualOpts, null, 2));
          
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
            socketId: wsConnection.connectionId,
          };
          console.log(`[Indexing] Starting ${indexType} indexing for ${name}:`, JSON.stringify(audioOpts, null, 2));
          
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

    console.log("[Indexing] RTStreams with indexes:", JSON.stringify(recording.rtstreams, null, 2));

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
  console.log("Checking and Requsting permissions")
  if (!captureClient) {
    console.log("CaptureClient not available, skipping permission requests");
    return;
  }
  try {
    console.log("Checking Screen Capture permissions")
    response = await captureClient.requestPermission("screen-capture");
    console.log("Screen Permission Done", response)
    console.log("Checking Microphone Permission")
    response= await captureClient.requestPermission("microphone");
    console.log("Microphone Permission Done", response)
    console.log("✓ Permissions requested via CaptureClient");
  } catch (e) {
    console.warn("Permission request failed:", e.message);
  }
}

// =============================================================================
// Recording Control
// =============================================================================

async function startRecording(selectedChannels, indexingConfigOverride = null) {
  if (recording.active) {
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
    console.log("Available channels:", availableChannels);

    // Use selected or default channels
    let channels = selectedChannels;
    if (!channels) {
      const mic = availableChannels.find((c) => c.channelId === "mic:default");
      const systemAudio = availableChannels.find(
        (c) => c.channelId === "system_audio:default"
      );
      const display = availableChannels.find((c) => c.type === "video");

      channels = [mic, systemAudio, display].filter(Boolean).map((c) => ({
        channelId: c.channelId,
        type: c.type,
        record: true,
        store: true,
      }));
    }

    recording.channels = channels.map((c) => channelIdToDisplayName(c.channelId));

    const capturePayload = {
      sessionId: captureSession.id,
      channels,
    };
    console.log("Starting capture with payload:", JSON.stringify(capturePayload, null, 2));

    await captureClient.startCaptureSession(capturePayload);

    return { status: "ok", sessionId: captureSession.id };
  } catch (e) {
    console.error("Start recording error:", e);
    return { status: "error", error: e.message };
  }
}

async function stopRecording() {
  if (!recording.active || !captureClient) {
    return { status: "error", error: "Not recording" };
  }

  try {
    await captureClient.stopCaptureSession();

    const duration = recording.startTime
      ? Math.round((Date.now() - recording.startTime) / 1000)
      : 0;

    // Clear runtime indexing config
    runtimeIndexingConfig = null;

    return { status: "ok", duration };
  } catch (e) {
    console.error("Stop recording error:", e);
    return { status: "error", error: e.message };
  }
}

// =============================================================================
// Screen Picker
// =============================================================================

function showRecordingPicker(videoChannels = []) {
  console.log("[Picker] showRecordingPicker called");
  return new Promise((resolve) => {
    if (pickerWindow) {
      console.log("[Picker] Window already exists, focusing");
      pickerWindow.focus();
      return resolve(null);
    }

    const displays = screen.getAllDisplays().map((d) => {
      const label = d.label || `Display ${d.id}`;
      const channelId = matchDisplayToChannel(label, videoChannels);
      return {
        width: d.size.width,
        height: d.size.height,
        id: d.id,
        label,
        channelId: channelId || `display:${d.id}`,
      };
    });
    console.log("[Picker] Found displays (with channelId):", displays);

    const pickerPath = path.join(__dirname, "ui", "picker.html");
    console.log("[Picker] Loading picker from:", pickerPath);
    console.log("[Picker] File exists:", fs.existsSync(pickerPath));

    pickerWindow = new BrowserWindow({
      width: 420,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: false,
      backgroundColor: "#1a1a1a",
      show: false,
      skipTaskbar: false, // Show in taskbar/dock temporarily
      focusable: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    pickerWindow.loadFile(pickerPath);

    pickerWindow.webContents.on("did-finish-load", () => {
      console.log("[Picker] HTML loaded, sending displays data");
      pickerWindow.webContents.send("displays", displays);
      pickerWindow.show();
      pickerWindow.focus();
      // For menu bar apps, need to activate the app to bring window to front
      if (process.platform === "darwin") {
        app.focus({ steal: true });
      }
      console.log("[Picker] Window shown and focused");
    });

    pickerWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error("[Picker] Failed to load:", errorCode, errorDescription);
    });

    pickerWindow.on("ready-to-show", () => {
      console.log("[Picker] Window ready to show");
    });

    ipcMain.once("picker-result", (event, result) => {
      console.log("[Picker] Received result:", result);
      if (pickerWindow) {
        pickerWindow.close();
        pickerWindow = null;
      }
      resolve(result);
    });

    pickerWindow.on("closed", () => {
      console.log("[Picker] Window closed");
      pickerWindow = null;
      resolve(null);
    });
  });
}

// =============================================================================
// Overlay Window
// =============================================================================

function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.focus();
    return overlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 340,
    height: 400,
    x: screenWidth - 360,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, "ui", "overlay.html"));
  overlayWindow.setIgnoreMouseEvents(false);

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function pushOverlayStatus() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const duration = recording.startTime
    ? Math.round((Date.now() - recording.startTime) / 1000)
    : 0;
  overlayWindow.webContents.send("overlay-status", {
    recording: recording.active,
    starting: recording.starting,
    failed: recording.failed,
    duration,
    channels: recording.channels || [],
  });
}

function showOverlay(text, options = {}) {
  const loading = options.loading === true;
  const payload = { text: text != null ? String(text) : "", loading };
  console.log("[Overlay]", payload.text || "(loading)");
  const win = createOverlayWindow();

  const send = () => {
    win.webContents.send("overlay-content", payload);
    pushOverlayStatus();
  };
  win.webContents.once("did-finish-load", send);
  if (!win.webContents.isLoading()) send();

  return { status: "ok" };
}

function hideOverlay() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
  return { status: "ok" };
}

function showReadyScreen() {
  const shortcut = config.assistant_shortcut;
  const message = shortcut
    ? `Ask your question in the mic, then press ${shortcut} to let me answer it.`
    : "Set assistant_shortcut in config to use the assistant.";
  showOverlay(message);
}

ipcMain.on("overlay-close", () => hideOverlay());

// =============================================================================
// Tray
// =============================================================================

function createTrayIcon(isRecording) {
  const size = 22;
  const color = isRecording ? "#ff3b30" : "#8e8e93";
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="${color}"/></svg>`;
  return require("electron").nativeImage.createFromDataURL(
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
  );
}

function getRecordingDuration() {
  if (!recording.active || !recording.startTime) return null;
  const seconds = Math.round((Date.now() - recording.startTime) / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function buildTrayMenu() {
  const duration = getRecordingDuration();
  const menu = [];

  if (!startupComplete) {
    menu.push({ label: "Starting...", enabled: false });
    menu.push({ type: "separator" });
    menu.push({ label: "Start Recording", enabled: false });
    menu.push({ type: "separator" });
    menu.push({ label: "Show Overlay", click: () => showOverlay("VideoDB Recorder Starting...") });
    menu.push({ label: "Hide Overlay", click: () => hideOverlay() });
    menu.push({ type: "separator" });
    menu.push({ label: "Quit", click: () => app.quit() });
    return Menu.buildFromTemplate(menu);
  }

  if (recording.active) {
    menu.push({ label: `🔴 Recording ${duration || ""}`, enabled: false });
    menu.push({ type: "separator" });
    menu.push({
      label: "Stop Recording",
      click: async () => {
        await stopRecording();
        updateTray();
      },
    });
    menu.push({ type: "separator" });
    menu.push({
      label: "Show Context",
      click: () => {
        const ctx = contextBuffer.getAll();
        const text = [
          `Screen: ${ctx.screen.length} records`,
          `Mic: ${ctx.mic.length} records`,
          `System Audio: ${ctx.system_audio.length} records`,
          "",
          "Recent screen:",
          ...ctx.screen
            .slice(-3)
            .map((r) => `  • ${(r.text || "").substring(0, 50)}...`),
        ].join("\n");
        showOverlay(text);
      },
    });
  } else {
    const hintLabel = recording.failed
      ? "Recording failed — run /record in Claude to try again"
      : "Ready to Record";
    menu.push({ label: hintLabel, enabled: false });
    menu.push({ type: "separator" });
    menu.push({
      label: "Start Recording",
      click: async () => {
        console.log("[Tray] Start Recording clicked");
        if (!captureSession || !captureClient) await createSession();
        let videoChannels = [];
        try {
          const available = await captureClient.listChannels();
          videoChannels = (available || []).filter((c) => c.type === "video");
        } catch (e) {
          console.warn("[Tray] listChannels failed, picker will use fallback:", e.message);
        }
        const pickerResult = await showRecordingPicker(videoChannels);
        console.log("[Tray] Picker returned:", pickerResult);
        if (!pickerResult) {
          console.log("[Tray] No picker result, cancelled");
          return;
        }

        const channels = [];
        if (pickerResult.mic) {
          channels.push({
            channelId: "mic:default",
            type: "audio",
            record: true,
            store: true,
          });
        }
        if (pickerResult.systemAudio) {
          channels.push({
            channelId: "system_audio:default",
            type: "audio",
            record: true,
            store: true,
          });
        }
        channels.push({
          channelId: pickerResult.displayChannelId,
          type: "video",
          record: true,
          store: true,
        });

        await startRecording(channels);
        updateTray();
      },
    });
  }

  menu.push({ type: "separator" });
  menu.push({
    label: "Show Overlay",
    click: () => showOverlay("VideoDB Recorder Ready"),
  });
  menu.push({
    label: "Hide Overlay",
    click: () => hideOverlay(),
  });
  menu.push({ type: "separator" });
  menu.push({ label: "Quit", click: () => app.quit() });

  return Menu.buildFromTemplate(menu);
}

function updateTray() {
  if (!tray) return;
  tray.setImage(createTrayIcon(recording.active));
  tray.setToolTip(
    !startupComplete ? "Starting..." : recording.active ? `Recording ${getRecordingDuration() || ""}` : "Ready"
  );
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(createTrayIcon(false));

  tray.setToolTip("VideoDB Recorder");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => tray.popUpContextMenu());

  // Update tray every second when recording
  setInterval(() => {
    if (recording.active) updateTray();
  }, 1000);
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

function startAPIServer() {
  killProcessOnPort(API_PORT);
  try {
    if (fs.existsSync(CONTEXT_FILE)) fs.unlinkSync(CONTEXT_FILE);
  } catch (_) {}
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

    let result = { status: "error", error: "Unknown endpoint" };

    try {
      // Root endpoint - show available routes
      if ((url === "/" || url === "/api") && req.method === "GET") {
        const base = `http://localhost:${API_PORT}`;
        result = {
          status: "ok",
          name: "VideoDB Recorder API",
          recording: recording.active,
          endpoints: {
            "GET /api/status": "Get recording status",
            "POST /api/record/start": "Start recording",
            "POST /api/record/stop": "Stop recording",
            "POST /api/overlay/show": "Show overlay { text?: string, loading?: boolean }",
            "POST /api/overlay/hide": "Hide overlay",
            "GET /api/context/:type": "Get context (screen/mic/system_audio/all)",
            "POST /api/rtstream/search": "Search within RTStream (body: rtstream_id, query); rtstream_id from GET /api/status",
            "POST /api/rtstream/update-prompt": "Update scene index prompt (body: rtstream_id, scene_index_id, prompt)",
            "GET /api/permissions": "Check screen and microphone permission status",
            "POST /webhook": "VideoDB webhook endpoint",
          },
          usage: {
            status: `curl -s ${base}/api/status`,
            "record/start": `curl -s -X POST ${base}/api/record/start -H "Content-Type: application/json" -d '{}'`,
            "record/start_with_config": `curl -s -X POST ${base}/api/record/start -H "Content-Type: application/json" -d '{"indexing_config":{"visual":{"prompt":"Focus on code"}}}'`,
            "record/stop": `curl -s -X POST ${base}/api/record/stop -H "Content-Type: application/json"`,
            "overlay/show": `curl -s -X POST ${base}/api/overlay/show -H "Content-Type: application/json" -d '{"text":"Message"}' or -d '{"loading":true}'`,
            "overlay/hide": `curl -s -X POST ${base}/api/overlay/hide -H "Content-Type: application/json"`,
            "context": `curl -s ${base}/api/context/<type>  (type: screen, mic, system_audio, all)`,
            "rtstream/search": `curl -s -X POST ${base}/api/rtstream/search -H "Content-Type: application/json" -d '{"rtstream_id":"<id>","query":"keywords"}'`,
          },
        };
      } else if (url === "/api/status" && req.method === "GET") {
        result = {
          status: "ok",
          recording: recording.active,
          sessionId: recording.sessionId,
          duration: recording.startTime
            ? Math.round((Date.now() - recording.startTime) / 1000)
            : 0,
          bufferCounts: {
            screen: contextBuffer.screen.length,
            mic: contextBuffer.mic.length,
            system_audio: contextBuffer.system_audio.length,
          },
          rtstreams: recording.rtstreams || [],
        };
      } else if (url === "/api/permissions" && req.method === "GET") {
        result = { status: "ok", message: "Permissions requested at startup via CaptureClient" };
      } else if (url === "/api/rtstream/search" && req.method === "POST") {
        const rtstreamId = body.rtstream_id || body.rtstreamId;
        const query = body.query;
        if (!rtstreamId || !query || typeof query !== "string") {
          result = { status: "error", error: "rtstream_id and query (string) required" };
        } else {
          try {
            if (!conn) {
              result = { status: "error", error: "Not connected to VideoDB" };
            } else {
              const coll = await conn.getCollection();
              const rtstream = await coll.getRTStream(rtstreamId);
              const searchResult = await rtstream.search({query});
              const serialized = searchResult?.shots != null
                ? { shots: searchResult.shots }
                : (searchResult && typeof searchResult === "object" ? { ...searchResult } : { data: searchResult });
              result = { status: "ok", ...serialized };
            }
          } catch (e) {
            result = { status: "error", error: e.message };
          }
        }
      } else if (url === "/api/rtstream/update-prompt" && req.method === "POST") {
        const rtstreamId = body.rtstream_id || body.rtstreamId;
        const sceneIndexId = body.scene_index_id || body.sceneIndexId;
        const prompt = body.prompt;
        if (!rtstreamId || !sceneIndexId || !prompt || typeof prompt !== "string") {
          result = { status: "error", error: "rtstream_id, scene_index_id, and prompt (string) required" };
        } else {
          try {
            if (!conn) {
              result = { status: "error", error: "Not connected to VideoDB" };
            } else {
              const coll = await conn.getCollection();
              const rtstream = await coll.getRTStream(rtstreamId);
              const sceneIndex = await rtstream.getSceneIndex(sceneIndexId);
              await sceneIndex.updateSceneIndex(prompt);

              // Persist the updated prompt to config
              const rtstreamEntry = (recording.rtstreams || []).find(
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

              result = { status: "ok", message: "Scene index prompt updated", index_type: indexType || "unknown" };
            }
          } catch (e) {
            result = { status: "error", error: e.message };
          }
        }
      } else if (url === "/api/record/start" && req.method === "POST") {
        // If no channels specified, show picker to let user select
        if (!body.channels) {
          console.log("[API] No channels specified, showing picker");
          if (!captureSession || !captureClient) await createSession();
          let videoChannels = [];
          try {
            const available = await captureClient.listChannels();
            videoChannels = (available || []).filter((c) => c.type === "video");
          } catch (e) {
            console.warn("[API] listChannels failed, picker will use fallback:", e.message);
          }
          const pickerResult = await showRecordingPicker(videoChannels);
          console.log("[API] Picker returned:", pickerResult);
          if (!pickerResult) {
            result = { status: "cancelled", error: "User cancelled picker" };
          } else {
            const channels = [];
            if (pickerResult.mic) {
              channels.push({
                channelId: "mic:default",
                type: "audio",
                record: true,
                store: true,
              });
            }
            if (pickerResult.systemAudio) {
              channels.push({
                channelId: "system_audio:default",
                type: "audio",
                record: true,
                store: true,
              });
            }
            channels.push({
              channelId: pickerResult.displayChannelId,
              type: "video",
              record: true,
              store: true,
            });
            result = await startRecording(channels, body.indexing_config);
          }
        } else {
          console.log("[API] Channels provided, starting recording directly:", body.channels);
          result = await startRecording(body.channels, body.indexing_config);
        }
      } else if (url === "/api/record/stop" && req.method === "POST") {
        result = await stopRecording();
      } else if (url === "/api/overlay/show" && req.method === "POST") {
        result = showOverlay(body.text, { loading: body.loading });
      } else if (url === "/api/overlay/hide" && req.method === "POST") {
        result = hideOverlay();
      } else if (url.startsWith("/api/context/")) {
        const type = url.split("/").pop();
        if (type === "all") {
          result = { status: "ok", ...contextBuffer.getAll() };
        } else {
          result = { status: "ok", [type]: contextBuffer.getRecent(type, 20) };
        }
      } else if (url === "/webhook" && req.method === "POST") {
        // Handle webhook events from VideoDB
        // IMPORTANT: Respond immediately, process async (server has 5s timeout)
        console.log("[Webhook] Received event:", body.event);
        result = { status: "ok" };
        
        // Process webhook asynchronously (don't await)
        handleWebhookEvent(body).catch(e => {
          console.error("[Webhook] Error processing event:", e.message);
        });
      }
    } catch (e) {
      result = { status: "error", error: e.message };
    }

    res.end(JSON.stringify(result));
  });

  server.listen(API_PORT, "127.0.0.1", () => {
    console.log(`✓ API server running on http://localhost:${API_PORT}`);
    console.log(`✓ API base: http://localhost:${API_PORT}`);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.warn(`Port ${API_PORT} in use, API server disabled`);
    }
  });

  apiHttpServer = server;
}

// Handle incoming webhook events
async function handleWebhookEvent(body) {
  const eventType = body.event;
  const sessionId = body.capture_session_id;
  
  console.log(`[Webhook] Event: ${eventType} for session: ${sessionId}`);

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

    console.log("these are rtsreasj", rtstreams)
    
    if (isOurSession) {
      console.log("our session")
      const normalized = (rtstreams || []).map((r) => ({
        rtstream_id: r.rtstream_id,
        name: r.name,
      }));
      console.log("normailzed", normalized)
      recording.rtstreams = normalized;
      if (!recording.active) {
        recording.starting = false;
        recording.failed = null;
        recording.active = true;
        recording.sessionId = sessionId;
        recording.startTime = recording.startTime || Date.now();
        const channelNames = rtstreams.map((r) =>
          rtstreamNameToDisplayName(r.name || r.channel_id)
        );
        recording.channels = [...new Set(channelNames)];
        updateTray();
        pushOverlayStatus();
      }
      if (!wsConnection) {
        await startIndexingForRTStreams(rtstreams);
      } else {
        console.log("[Webhook] Indexing already started, rtstreams stored for status.");
      }
    } else {
      console.log(`[Webhook] Not our session (expected: ${captureSession?.id}, got: ${sessionId}), skipping`);
    }
  } else if (eventType === "capture_session.stopped" || eventType === "recorder.session.stopped") {
    console.log("[Webhook] Session stopped");
    recording.active = false;
    recording.starting = false;
    recording.sessionId = null;
    recording.channels = null;
    recording.failed = null;
    updateTray();
    pushOverlayStatus();
    if (wsConnection) {
      await wsConnection.close();
      wsConnection = null;
    }
  } else if (eventType === "capture_session.created") {
    console.log("[Webhook] Session created");
  } else if (eventType === "capture_session.starting") {
    console.log("[Webhook] Session starting");
    recording.starting = true;
    recording.failed = null;
    pushOverlayStatus();
  } else if (eventType === "capture_session.stopping") {
    console.log("[Webhook] Session stopping");
  } else if (eventType === "capture_session.exported") {
    const exportedId = body.data?.exported_video_id;
    console.log("[Webhook] Session exported", exportedId ? `video_id: ${exportedId}` : "");
  } else if (eventType === "capture_session.failed") {
    const err = body.data?.error || body.data || {};
    console.error("[Webhook] Session failed:", err);
    recording.active = false;
    recording.starting = false;
    recording.sessionId = null;
    recording.channels = null;
    const message = err.message || "Recording failed";
    recording.failed = { code: err.code || "RECORDING_FAILED", message };
    updateTray();
    pushOverlayStatus();
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
    showOverlay("", { loading: true });

    const args = ["-p", "-c", "/pair-programmer:trigger"];
    if (process.env.PLUGIN_PATH) {
      args.unshift("--plugin-dir", process.env.PLUGIN_PATH);
    }
    const child = spawn("claude", args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (err) => {
      console.error("[Assistant] Failed to run claude:", err.message);
      new Notification({
        title: "Assistant Error",
        body: "Failed to run claude command",
      }).show();
    });

    child.on("close", (code) => {
      console.log(`[Assistant] claude exited with code ${code}`);
    });
  });

  if (registered) {
    console.log(`✓ Assistant shortcut registered: ${shortcut}`);
  } else {
    console.error(`✗ Failed to register shortcut: ${shortcut}`);
  }
}

// =============================================================================
// App Lifecycle
// =============================================================================

app.whenReady().then(async () => {
  try {
    createTray();
    console.log("Starting VideoDB Recorder...");
    console.log("Config:", {
      apiKey: API_KEY ? `${API_KEY.substring(0, 10)}...` : "NOT SET",
      baseUrl: BASE_URL,
      configuredWebhookUrl: CONFIGURED_WEBHOOK_URL || "(not set, will use tunnel or websocket)",
      apiPort: API_PORT,
    });

    // Initialize VideoDB connection
    const connected = await initializeVideoDB();
    if (!connected) {
      new Notification({
        title: "VideoDB Recorder",
        body: "Failed to connect. Run /pair-programmer:record-config to set up.",
      }).show();
    }

    // Start HTTP API server (needed before tunnel so port is listening)
    startAPIServer();

    // Setup webhook URL (from config or cloudflare tunnel) — must happen before createSession
    if (CONFIGURED_WEBHOOK_URL) {
      const baseUrl = CONFIGURED_WEBHOOK_URL.replace(/\/+$/, "");
      webhookUrl = `${baseUrl}/webhook`;
      console.log(`✓ Using configured webhook URL: ${webhookUrl}`);
    } else {
      console.log("No webhook_url configured, starting Cloudflare tunnel...");
      webhookUrl = await TunnelManager.start(API_PORT);
      if (webhookUrl) {
        webhookUrl = `${webhookUrl}/webhook`;
        console.log(`✓ Cloudflare tunnel ready: ${webhookUrl}`);
      } else {
        console.log("⚠ Tunnel failed, will use WebSocket for events");
        webhookUrl = null;
      }
    }

    // Wait for tunnel/webhook to stabilize before verifying
    if (webhookUrl) {
      console.log("Waiting 10s for webhook URL to stabilize...");
      await new Promise((r) => setTimeout(r, 10000));

      const baseUrl = webhookUrl.replace(/\/webhook$/, "");
      try {
        const resp = await fetch(`${baseUrl}/api`);
        const data = await resp.json();
        console.log(`✓ Webhook URL verified: ${baseUrl}/api →`, JSON.stringify(data));
      } catch (e) {
        console.warn(`⚠ Webhook URL verification failed (${baseUrl}/api):`, e.message);
      }
    }

    // Create session (with callbackUrl now that webhook is ready) so captureClient exists for permissions
    if (connected) {
      try {
        await createSession();
        console.log("✓ Session pre-created for permission requests");
      } catch (e) {
        console.warn("Pre-session creation failed:", e.message);
      }
    }

    // Request permissions via captureClient (recorder binary) + check status
    await checkAndRequestPermissions();

    startupComplete = true;
    updateTray();

    // Register global shortcut for assistant
    registerAssistantShortcut();

    showReadyScreen();

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

let quitHandled = false;
app.on("before-quit", (e) => {
  if (quitHandled) return;
  quitHandled = true;
  e.preventDefault();
  (async () => {
    globalShortcut.unregisterAll();
    if (tray) {
      tray.destroy();
      tray = null;
    }
    if (apiHttpServer) {
      try {
        await Promise.race([
          new Promise((resolve) => apiHttpServer.close(() => resolve())),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
        apiHttpServer.unref();
        apiHttpServer = null;
      } catch (_) {}
    }
    if (captureClient) {
      try {
        await captureClient.stopCaptureSession();
        await captureClient.shutdown();
      } catch (_) {}
    }
    if (wsConnection) {
      await wsConnection.close();
    }
    await TunnelManager.stop();
    try {
      if (fs.existsSync(CONTEXT_FILE)) fs.unlinkSync(CONTEXT_FILE);
    } catch (_) {}
    app.exit(0);
  })().catch((err) => {
    console.error("[Quit] Cleanup error:", err);
    app.exit(1);
  });
});

// =============================================================================
// Export context buffer for external access
// =============================================================================

module.exports = {
  contextBuffer,
  startRecording,
  stopRecording,
  showOverlay,
  hideOverlay,
};
