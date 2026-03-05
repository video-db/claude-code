#!/usr/bin/env electron
/**
 * VideoDB Pair Programmer - Simplified Recorder
 * 
 * Single sequential script that:
 * 1. Connects to VideoDB, starts WebSocket
 * 2. Shows picker UI for channel selection
 * 3. Starts capture recording
 * 4. Logs all events to /tmp/videodb_pp_events.jsonl
 * 5. Shows tray icon with Stop/Quit buttons
 */

const path = require("path");
const fs = require("fs");
const { app, Notification, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require("electron");

// Reduce Electron memory footprint
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=64");

const dotenv = require("dotenv");
const { connect } = require("videodb");
const { CaptureClient } = require("videodb/capture");

// Load .env and pp.config.json from user's project directory if --cwd flag is provided
const cwdArg = process.argv.find(a => a.startsWith("--cwd="));
const userCwd = cwdArg ? cwdArg.split("=")[1] : null;
if (userCwd) {
  dotenv.config({ path: path.join(userCwd, ".env") });
}

function loadProjectConfig() {
  const configPath = userCwd ? path.join(userCwd, "pp.config.json") : null;
  if (!configPath) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (_) {
    return {};
  }
}

const PROJECT_CONFIG = loadProjectConfig();

// =============================================================================
// Configuration
// =============================================================================

const API_KEY = process.env.VIDEO_DB_API_KEY;
const BASE_URL = PROJECT_CONFIG.videodb_backend_url || process.env.VIDEO_DB_BASE_URL || "https://api.videodb.io";

const PID_FILE = "/tmp/videodb_pp_pid";
const EVENTS_FILE = "/tmp/videodb_pp_events.jsonl";
const INFO_FILE = "/tmp/videodb_pp_info.json";

const UI_DIR = path.join(__dirname, "ui");

const DEFAULT_INDEXING_CONFIG = {
  visual: {
    enabled: true,
    prompt: "Describe what is visible on the screen, focusing on the main application, content being viewed, and any notable UI elements.",
    batch_time: 2,
    frame_count: 3,
    model_name: "mini",
  },
  system_audio: {
    enabled: true,
    prompt: "Summarize what is being said in the audio.",
    batch_type: "sentence",
    batch_value: 3,
    model_name: "mini",
  },
  mic: {
    enabled: true,
    prompt: "Transcribe the user's speech.",
    batch_type: "sentence",
    batch_value: 3,
    model_name: "mini",
  },
};

function mergeIndexingConfig(defaults, overrides) {
  if (!overrides) return defaults;
  const result = {};
  for (const key of Object.keys(defaults)) {
    const configKey = key === "visual" ? "visual_index" : key === "system_audio" ? "system_audio_index" : "mic_index";
    result[key] = overrides[configKey]
      ? { ...defaults[key], ...overrides[configKey] }
      : defaults[key];
  }
  return result;
}

const INDEXING_CONFIG = mergeIndexingConfig(DEFAULT_INDEXING_CONFIG, PROJECT_CONFIG);

// =============================================================================
// State
// =============================================================================

let conn = null;
let wsConnection = null;
let captureSession = null;
let captureClient = null;
let tray = null;
let pickerWindow = null;
let widgetWindow = null;
let lastPickerConfig = null;

// =============================================================================
// File Helpers
// =============================================================================

function writePidFile() {
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`✓ PID file written: ${PID_FILE}`);
}

function removePidFile() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {}
}

function appendEvent(event) {
  const ts = new Date().toISOString();
  const unix_ts = Date.now() / 1000;
  const line = JSON.stringify({ ts, unix_ts, ...event }) + "\n";
  fs.appendFileSync(EVENTS_FILE, line);
}

function writeSessionInfo(info) {
  fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2));
  console.log(`✓ Session info written: ${INFO_FILE}`);
}

function clearEventsFile() {
  try {
    fs.writeFileSync(EVENTS_FILE, "");
  } catch (_) {}
}

// =============================================================================
// Utility Functions (inlined from utils.js)
// =============================================================================

function matchDisplayToChannel(displayLabel, videoChannels) {
  if (!displayLabel || !Array.isArray(videoChannels) || videoChannels.length === 0)
    return null;
  const normalized = (s) => String(s || "").trim().toLowerCase();
  const label = normalized(displayLabel);
  const found = videoChannels.find(
    (c) => normalized(c.name) === label || normalized(c.extras?.name) === label
  );
  return found ? found.id : null;
}

function buildChannelsFromPicker(pickerResult) {
  const channels = [];
  if (pickerResult.mic) {
    channels.push({ channelId: "mic:default", type: "audio", record: true, store: true });
  }
  if (pickerResult.systemAudio) {
    channels.push({ channelId: "system_audio:default", type: "audio", record: true, store: true });
  }
  channels.push({ channelId: pickerResult.displayChannelId, type: "video", record: true, store: true });
  return channels;
}

// =============================================================================
// Tray (simple - just Stop/Quit while recording)
// =============================================================================

function createTray() {
  const emptyIcon = nativeImage.createEmpty();
  tray = new Tray(emptyIcon);
  tray.setTitle(" 🔴 PP");
  tray.setToolTip("VideoDB Pair Programmer - Recording");
  updateTrayMenu();
  tray.on("click", () => tray.popUpContextMenu());
}

function updateTrayMenu() {
  if (!tray) return;
  
  const isOverlayVisible = widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible();
  
  const menu = Menu.buildFromTemplate([
    { label: "🔴 Recording", enabled: false },
    { type: "separator" },
    { 
      label: isOverlayVisible ? "Hide Overlay" : "Show Overlay", 
      click: () => toggleOverlay() 
    },
    { type: "separator" },
    { label: "Stop Recording", click: () => stopAndExit() },
    { type: "separator" },
    { label: "Quit", click: () => exitGracefully("Quit from tray") },
  ]);
  
  tray.setContextMenu(menu);
}

function toggleOverlay() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (widgetWindow.isVisible()) {
      widgetWindow.hide();
    } else {
      widgetWindow.show();
    }
  } else if (lastPickerConfig) {
    createWidget(lastPickerConfig);
  }
  updateTrayMenu();
}

// =============================================================================
// Picker UI
// =============================================================================

function showPicker(videoChannels = []) {
  return new Promise((resolve) => {
    if (pickerWindow) {
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

    pickerWindow = new BrowserWindow({
      width: 420,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: false,
      backgroundColor: "#1c1c1e",
      show: false,
      skipTaskbar: false,
      focusable: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    pickerWindow.loadFile(path.join(UI_DIR, "picker.html"));

    pickerWindow.webContents.on("did-finish-load", () => {
      pickerWindow.webContents.send("displays", displays);
      pickerWindow.show();
      pickerWindow.focus();
      if (process.platform === "darwin") {
        app.focus({ steal: true });
      }
    });

    ipcMain.once("picker-result", (event, result) => {
      if (pickerWindow) {
        pickerWindow.close();
        pickerWindow = null;
      }
      resolve(result);
    });

    pickerWindow.on("closed", () => {
      pickerWindow = null;
      resolve(null);
    });
  });
}

// =============================================================================
// Widget (floating overlay showing recording status)
// =============================================================================

function createWidget(pickerConfig = null) {
  if (widgetWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  widgetWindow = new BrowserWindow({
    width: 160,
    height: 150,
    x: screenW - 180,
    y: screenH - 200,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: false,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.loadFile(path.join(UI_DIR, "widget.html"));

  widgetWindow.webContents.on("did-finish-load", () => {
    if (pickerConfig) {
      widgetWindow.webContents.send("widget-config", pickerConfig);
    }
  });

  ipcMain.on("widget-stop", () => {
    stopAndExit();
  });

  ipcMain.on("widget-close", () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.hide();
      updateTrayMenu();
    }
  });

  ipcMain.on("widget-resize", (_, size) => {
    if (widgetWindow && size.width && size.height) {
      widgetWindow.setSize(size.width, size.height);
    }
  });

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });

  console.log("✓ Widget created");
}

function updateWidgetState(state) {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send("widget-state", state);
  }
}

function updateWidgetConfig(config) {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send("widget-config", config);
  }
}

// =============================================================================
// VideoDB Integration
// =============================================================================

async function initializeVideoDB() {
  if (!API_KEY) {
    throw new Error("VIDEO_DB_API_KEY environment variable not set");
  }

  conn = connect({ apiKey: API_KEY, baseUrl: BASE_URL });
  console.log("✓ Connected to VideoDB");
  return true;
}

async function setupWebSocket() {
  wsConnection = await conn.connectWebsocket();
  await wsConnection.connect();
  console.log(`✓ WebSocket connected: ${wsConnection.connectionId}`);
  
  // Start listening for events in background
  listenToWebSocketEvents();
}

async function createSession() {
  const sessionConfig = {
    endUserId: "pair_programmer_user",
    metadata: { app: "pair-programmer" },
    wsConnectionId: wsConnection.connectionId,
  };

  captureSession = await conn.createCaptureSession(sessionConfig);
  const token = await conn.generateClientToken(3600);
  captureClient = new CaptureClient({ sessionToken: token, apiUrl: BASE_URL });

  console.log(`✓ Session created: ${captureSession.id}`);
  return { sessionId: captureSession.id, token };
}

async function requestPermissions() {
  if (!captureClient) return;
  
  try {
    const { systemPreferences } = require("electron");
    const hasScreen = systemPreferences.getMediaAccessStatus("screen") === "granted";
    const hasMic = systemPreferences.getMediaAccessStatus("microphone") === "granted";

    if (hasScreen && hasMic) {
      console.log("✓ Permissions already granted");
      return;
    }

    if (!hasScreen) await captureClient.requestPermission("screen-capture");
    if (!hasMic) await captureClient.requestPermission("microphone");
    console.log("✓ Permissions requested");
  } catch (e) {
    console.warn("Permission request failed:", e.message);
  }
}

async function startRecording(channels) {
  const capturePayload = {
    sessionId: captureSession.id,
    channels,
  };
  console.log("Starting capture with channels:", channels.map(c => c.channelId).join(", "));
  
  await captureClient.startSession(capturePayload);
}

async function startIndexingForRTStreams(rtstreams) {
  if (!rtstreams || rtstreams.length === 0) {
    console.error("[Indexing] No RTStreams provided!");
    return;
  }

  const coll = await conn.getCollection();

  for (const stream of rtstreams) {
    const rtstream_id = stream.rtstream_id || stream.id;
    const name = stream.name || stream.channel_id || "";
    const mediaTypes = stream.media_types || [];

    if (!rtstream_id) continue;

    try {
      const rtstream = await coll.getRTStream(rtstream_id);

      if (mediaTypes.includes("video")) {
        if (!INDEXING_CONFIG.visual.enabled) continue;
        
        const visualOpts = {
          prompt: INDEXING_CONFIG.visual.prompt,
          batchConfig: { 
            type: "time", 
            value: INDEXING_CONFIG.visual.batch_time, 
            frameCount: INDEXING_CONFIG.visual.frame_count 
          },
          modelName: INDEXING_CONFIG.visual.model_name,
          socketId: wsConnection.connectionId,
        };
        const sceneIndex = await rtstream.indexVisuals(visualOpts);
        if (sceneIndex) {
          console.log(`✓ Visual index created for ${name}`);
        }
      } else if (mediaTypes.includes("audio")) {
        const isMic = name.toLowerCase().includes("mic");
        const config = isMic ? INDEXING_CONFIG.mic : INDEXING_CONFIG.system_audio;
        
        if (!config.enabled) continue;
        
        const audioOpts = {
          prompt: config.prompt,
          batchConfig: { type: config.batch_type, value: config.batch_value },
          modelName: config.model_name,
          socketId: wsConnection.connectionId,
        };
        const audioIndex = await rtstream.indexAudio(audioOpts);
        if (audioIndex) {
          console.log(`✓ Audio index created for ${name}`);
        }
      }
    } catch (e) {
      console.error(`[Indexing] Failed for ${rtstream_id}:`, e.message);
    }
  }
}

async function listenToWebSocketEvents() {
  if (!wsConnection) return;

  try {
    for await (const ev of wsConnection.receive()) {
      const channel = ev.channel;

      // Append all events to file
      appendEvent(ev);

      if (channel === "capture_session") {
        await handleCaptureSessionEvent(ev);
      } else if (channel === "transcript") {
        const text = ev.data?.text;
        if (text) {
          console.log(`[Transcript] ${text.substring(0, 80)}...`);
        }
      } else if (channel === "visual_index") {
        const text = ev.data?.text;
        if (text) {
          console.log(`[Visual] ${text.substring(0, 80)}...`);
        }
      } else if (channel === "audio_index") {
        const text = ev.data?.text;
        if (text) {
          console.log(`[Audio] ${text.substring(0, 80)}...`);
        }
      }
    }
  } catch (e) {
    console.warn("[WS] Listener error:", e.message);
  }

  console.log("[WS] Connection closed");
  wsConnection = null;
}

async function handleCaptureSessionEvent(ev) {
  const eventType = ev.event || ev.type;
  const sessionId = ev.capture_session_id || ev.session_id;

  console.log(`[WS] Capture event: ${eventType}`);

  if (eventType === "capture_session.starting") {
    updateWidgetState({ state: "starting" });
  } else if (eventType === "capture_session.created") {
    updateWidgetState({ state: "started" });
  } else if (eventType === "capture_session.active") {
    console.log("[WS] Session is ACTIVE!");

    // Update widget to active state with timer
    updateWidgetState({ state: "active", startTime: Date.now() });

    const data = ev.data || {};
    const rtstreams = data.rtstreams || data.streams || data.channels || [];
    
    // Write session info
    writeSessionInfo({
      session_id: sessionId,
      rtstreams: rtstreams.map(r => ({
        rtstream_id: r.rtstream_id,
        name: r.name,
        media_types: r.media_types,
      })),
      started_at: new Date().toISOString(),
    });

    // Start indexing
    await startIndexingForRTStreams(rtstreams);
    
  } else if (eventType === "capture_session.stopping") {
    updateWidgetState({ state: "stopping" });
  } else if (eventType === "capture_session.stopped") {
    updateWidgetState({ state: "stopped" });
  } else if (eventType === "capture_session.exported") {
    const exportedId = ev.data?.exported_video_id;
    const playerUrl = ev.data?.player_url;
    console.log("[WS] Session exported", exportedId ? `video_id: ${exportedId}` : "");
    
    new Notification({
      title: "VideoDB Recording Complete",
      body: playerUrl ? "Click to view recording" : "Recording saved",
    }).show();
    
  } else if (eventType === "capture_session.failed") {
    updateWidgetState({ state: "failed" });
    const err = ev.data?.error || ev.data || {};
    console.error("[WS] Session failed:", err);
    
    new Notification({
      title: "VideoDB Recording Failed",
      body: err.message || "Recording failed",
    }).show();
  }
}

// =============================================================================
// Lifecycle
// =============================================================================

async function stopAndExit() {
  console.log("[Stop] Stopping recording...");
  
  if (captureClient) {
    try {
      await captureClient.stopSession();
      console.log("[Stop] Capture session stopped");
    } catch (e) {
      console.error("[Stop] Error stopping session:", e.message);
    }
  }
  
  // Wait a bit for export event before exiting
  setTimeout(() => {
    exitGracefully("Recording stopped");
  }, 2000);
}

async function shutdownApp() {
  console.log("[Shutdown] Starting cleanup...");
  
  if (widgetWindow) {
    try { widgetWindow.close(); } catch (_) {}
    widgetWindow = null;
  }
  
  if (tray) {
    try { tray.destroy(); } catch (_) {}
    tray = null;
  }

  if (captureClient) {
    try {
      await captureClient.shutdown();
      console.log("[Shutdown] CaptureClient shutdown");
    } catch (_) {}
    captureClient = null;
  }

  if (wsConnection) {
    try { await wsConnection.close(); } catch (_) {}
    wsConnection = null;
    console.log("[Shutdown] WebSocket closed");
  }

  removePidFile();
  console.log("[Shutdown] Cleanup complete");
}

let shutdownPromise = null;

function exitGracefully(source) {
  console.log(`[Shutdown] ${source}`);

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

// =============================================================================
// Main Entry Point
// =============================================================================

app.whenReady().then(async () => {
  try {
    // Hide dock icon (menu bar app)
    if (process.platform === "darwin") {
      app.dock.hide();
    }

    // Step 1: Write PID file
    writePidFile();
    
    // Step 2: Create tray and show widget in starting state
    createTray();
    createWidget();
    
    console.log("Starting VideoDB Pair Programmer...");
    console.log("Config:", {
      apiKey: API_KEY ? `${API_KEY.substring(0, 10)}...` : "NOT SET",
      baseUrl: BASE_URL,
    });

    if (!API_KEY) {
      new Notification({
        title: "VideoDB Pair Programmer",
        body: "VIDEO_DB_API_KEY environment variable not set. Run /pair-programmer setup first.",
      }).show();
      setTimeout(() => exitGracefully("No API key"), 3000);
      return;
    }

    // Step 3: Connect to VideoDB
    await initializeVideoDB();
    
    // Step 4: Setup WebSocket
    await setupWebSocket();
    
    // Step 5: Create capture session
    await createSession();
    
    // Step 6: Request permissions
    await requestPermissions();
    
    // Step 7: List channels and show picker
    const availableChannels = await captureClient.listChannels();
    console.log("Available channels:", JSON.stringify(availableChannels, null, 2));
    
    // Extract video channels - handle different API response structures
    let videoChannels = [];
    if (availableChannels.displays) {
      if (typeof availableChannels.displays.all === "function") {
        videoChannels = availableChannels.displays.all();
      } else if (Array.isArray(availableChannels.displays)) {
        videoChannels = availableChannels.displays;
      }
    } else if (availableChannels.video) {
      videoChannels = Array.isArray(availableChannels.video) ? availableChannels.video : [];
    }
    
    console.log("Showing picker UI...");
    const pickerResult = await showPicker(videoChannels);
    
    if (!pickerResult) {
      console.log("Picker cancelled");
      exitGracefully("Picker cancelled");
      return;
    }
    
    // Step 8: Build channels from picker result
    const channels = buildChannelsFromPicker(pickerResult);
    
    // Step 9: Clear events file and start recording
    clearEventsFile();
    await startRecording(channels);
    
    // Step 10: Update widget with channel status
    lastPickerConfig = pickerResult;
    updateWidgetConfig(pickerResult);
    updateTrayMenu();
    
    console.log("✓ Recording started! Events logged to:", EVENTS_FILE);
    
  } catch (error) {
    console.error("Startup error:", error);
    new Notification({
      title: "VideoDB Recorder Error",
      body: error.message,
    }).show();
    setTimeout(() => exitGracefully("Startup error"), 3000);
  }
});

app.on("window-all-closed", () => {
  // Don't quit - we're a tray app
});

app.on("before-quit", (e) => {
  e.preventDefault();
  exitGracefully("before-quit");
});

process.on("SIGINT", () => exitGracefully("Received SIGINT"));
process.on("SIGTERM", () => exitGracefully("Received SIGTERM"));
