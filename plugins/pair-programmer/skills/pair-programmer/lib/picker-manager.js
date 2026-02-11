const path = require("path");
const { BrowserWindow, screen, ipcMain, app } = require("electron");
const { matchDisplayToChannel } = require("./utils");

class PickerManager {
  constructor({ uiDir }) {
    this._uiDir = uiDir;
    this._window = null;
  }

  show(videoChannels = []) {
    return new Promise((resolve) => {
      if (this._window) {
        this._window.focus();
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

      this._window = new BrowserWindow({
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
        skipTaskbar: false,
        focusable: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });

      this._window.loadFile(path.join(this._uiDir, "picker.html"));

      this._window.webContents.on("did-finish-load", () => {
        this._window.webContents.send("displays", displays);
        this._window.show();
        this._window.focus();
        if (process.platform === "darwin") {
          app.focus({ steal: true });
        }
      });

      this._window.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
        console.error("[Picker] Failed to load:", errorCode, errorDescription);
      });

      ipcMain.once("picker-result", (event, result) => {
        if (this._window) {
          this._window.close();
          this._window = null;
        }
        resolve(result);
      });

      this._window.on("closed", () => {
        this._window = null;
        resolve(null);
      });
    });
  }
}

module.exports = PickerManager;
