const path = require("path");
const { BrowserWindow, screen, ipcMain } = require("electron");

class WidgetManager {
  constructor(recState, { uiDir, onToggleRecording, ctxBuffer }) {
    this._window = null;
    this._recordingState = recState;
    this._uiDir = uiDir;
    this._onToggleRecording = onToggleRecording;
    this._ctxBuffer = ctxBuffer || null;
    this._durationInterval = null;

    this._mutedChannels = { screen: false, mic: false, system_audio: false };
    this._dataReceivedTime = null;

    recState.on("stateChanged", () => this._pushState());

    ipcMain.on("widget-click", () => {
      if (this._onToggleRecording) this._onToggleRecording();
    });

    ipcMain.on("widget-resize", (_, { width, height }) => {
      if (this._window && !this._window.isDestroyed()) {
        this._window.setSize(Math.round(width), Math.round(height));
      }
    });

    ipcMain.on("widget-channel-toggle", (_, channelName) => {
      if (channelName in this._mutedChannels) {
        this._mutedChannels[channelName] = !this._mutedChannels[channelName];
        this._pushState();
      }
    });

    ipcMain.on("widget-close", () => {
      const { app } = require("electron");
      app.quit();
    });
  }

  show() {
    if (this._window && !this._window.isDestroyed()) {
      this._window.show();
      return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    this._window = new BrowserWindow({
      width: 160,
      height: 150,
      x: screenWidth - 180,
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
        enableWebSQL: false,
        spellcheck: false,
        images: false,
      },
    });

    // Disable caching to prevent disk bloat
    this._window.webContents.session.clearCache();
    this._window.loadFile(path.join(this._uiDir, "widget.html"));
    this._window.setIgnoreMouseEvents(false);

    this._window.on("closed", () => {
      this._window = null;
      this._stopDurationInterval();
    });

    // Push initial state once loaded
    this._window.webContents.once("did-finish-load", () => {
      this._pushState();
    });
  }

  hide() {
    if (this._window && !this._window.isDestroyed()) {
      this._window.hide();
    }
  }

  destroy() {
    this._stopDurationInterval();
    ipcMain.removeAllListeners("widget-click");
    ipcMain.removeAllListeners("widget-resize");
    ipcMain.removeAllListeners("widget-channel-toggle");
    ipcMain.removeAllListeners("widget-close");
    if (this._window && !this._window.isDestroyed()) {
      this._window.close();
    }
    this._window = null;
  }

  _getChannelStates() {
    const channels = { screen: "disabled", mic: "disabled", system_audio: "disabled" };

    if (!this._recordingState.active) return channels;

    // Determine which channels are recording from the channel list
    const recChannels = this._recordingState.channels || [];
    const hasChannel = (type) => recChannels.some(c => {
      const id = typeof c === "string" ? c : (c.channelId || c.id || "");
      if (type === "screen") return id.startsWith("display") || id.startsWith("screen");
      if (type === "mic") return id.startsWith("mic");
      if (type === "system_audio") return id.startsWith("system_audio");
      return false;
    });

    const counts = this._ctxBuffer ? this._ctxBuffer.getCounts() : { screen: 0, mic: 0, system_audio: 0 };
    const anyData = counts.screen > 0 || counts.mic > 0 || counts.system_audio > 0;

    // Track when first data arrives
    if (anyData && !this._dataReceivedTime) {
      this._dataReceivedTime = Date.now();
    }

    for (const ch of ["screen", "mic", "system_audio"]) {
      if (this._mutedChannels[ch]) {
        channels[ch] = "muted";
      } else if (hasChannel(ch) || (recChannels.length === 0)) {
        channels[ch] = "active";
      }
    }

    return channels;
  }

  _pushState() {
    if (!this._window || this._window.isDestroyed()) return;

    const rs = this._recordingState;
    const channels = this._getChannelStates();

    // Timer starts from when first data arrives, not session creation
    let duration = 0;
    if (this._dataReceivedTime) {
      duration = Math.round((Date.now() - this._dataReceivedTime) / 1000);
    }

    const payload = {
      recording: rs.active,
      starting: rs.starting,
      stopping: rs.stopping,
      duration,
      dataReceived: !!this._dataReceivedTime,
      channels,
    };

    this._window.webContents.send("widget-state", payload);

    // Manage duration interval
    if (rs.active && !this._durationInterval) {
      this._durationInterval = setInterval(() => this._pushState(), 1000);
    } else if (!rs.active && this._durationInterval) {
      this._stopDurationInterval();
      // Reset muted states and data timer when recording stops
      this._mutedChannels = { screen: false, mic: false, system_audio: false };
      this._dataReceivedTime = null;
    }
  }

  _stopDurationInterval() {
    if (this._durationInterval) {
      clearInterval(this._durationInterval);
      this._durationInterval = null;
    }
  }
}

module.exports = WidgetManager;
