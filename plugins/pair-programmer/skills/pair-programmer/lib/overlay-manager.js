const path = require("path");
const { BrowserWindow, screen, ipcMain } = require("electron");

class OverlayManager {
  constructor(recState, { assistantShortcut, uiDir } = {}) {
    this._window = null;
    this._recordingState = recState;
    this._shortcut = assistantShortcut;
    this._uiDir = uiDir;
    this._loading = false;

    recState.on("stateChanged", () => this._pushStatus());
    ipcMain.on("overlay-close", () => this.setVisible(false));
    ipcMain.on("overlay-resize", (_, { width, height }) => {
      if (this._window && !this._window.isDestroyed()) {
        this._window.setSize(Math.round(width), Math.round(height));
      }
    });
  }

  show(text, options = {}) {
    const loading = options.loading === true;
    this._loading = loading;
    const payload = { text: text != null ? String(text) : "", loading };
    console.log("[Overlay]", payload.text || "(loading)");
    const win = this._ensureWindow();
    win.show();

    const send = () => {
      win.webContents.send("overlay-content", payload);
      if (!loading) this._pushStatus();
    };
    win.webContents.once("did-finish-load", send);
    if (!win.webContents.isLoading()) send();

    return { status: "ok" };
  }

  hide() {
    if (this._window) {
      this._window.close();
      this._window = null;
    }
    return { status: "ok" };
  }

  setVisible(visible) {
    if (visible) {
      const win = this._ensureWindow();
      win.show();
    } else if (this._window) {
      this._window.hide();
    }
  }

  showReady() {
    const message = this._shortcut
      ? `Ask your question in the mic, then press ${this._shortcut} to let me answer it.`
      : "Set assistant_shortcut in config to use the assistant.";
    this.show(message);
  }

  destroy() {
    ipcMain.removeAllListeners("overlay-close");
    ipcMain.removeAllListeners("overlay-resize");
    this.hide();
  }

  _ensureWindow() {
    if (this._window) {
      this._window.focus();
      return this._window;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    this._window = new BrowserWindow({
      width: 340,
      height: 400,
      x: screenWidth - 360,
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    this._window.loadFile(path.join(this._uiDir, "overlay.html"));
    this._window.setIgnoreMouseEvents(false);

    this._window.on("closed", () => {
      this._window = null;
    });

    return this._window;
  }

  _pushStatus() {
    if (this._loading) return;
    if (!this._window || this._window.isDestroyed()) return;
    this._window.webContents.send("overlay-status", this._recordingState.toOverlayPayload());
  }
}

module.exports = OverlayManager;
