const path = require("path");
const { BrowserWindow, screen, ipcMain } = require("electron");

const READY_MESSAGE = `## Hi there!

I'm your AI pair programmer. I can see your screen and hear your audio when you're recording.

To get started, use \`/pair-programmer:record\` to begin recording.

Once recording, I'll be able to:
- Answer questions about your code
- Debug errors you encounter
- Suggest improvements
- Help you build features

Speak your question, then hit **{{shortcut}}** — I'll take it from there.`;

function formatShortcut(accelerator) {
  return accelerator
    .replace("CommandOrControl", process.platform === "darwin" ? "Cmd" : "Ctrl")
    .replace(/\+/g, " + ");
}

class OverlayManager {
  constructor(recState, { assistantShortcut, uiDir } = {}) {
    this._window = null;
    this._recordingState = recState;
    this._shortcut = assistantShortcut;
    this._uiDir = uiDir;
    this._loading = false;

    this._permissionResolve = null;

    recState.on("stateChanged", () => this._pushStatus());
    ipcMain.on("overlay-close", () => this.setVisible(false));
    ipcMain.on("overlay-resize", (_, { width, height }) => {
      if (this._window && !this._window.isDestroyed()) {
        this._window.setSize(Math.round(width), Math.round(height));
      }
    });
    ipcMain.on("permission-response", (_, decision) => {
      if (this._permissionResolve) {
        this._permissionResolve(decision);
        this._permissionResolve = null;
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
    if (!this._shortcut) {
      this.show("Set `assistant_shortcut` in config to use the assistant.");
      return;
    }
    this.show(READY_MESSAGE.replace("{{shortcut}}", formatShortcut(this._shortcut)));
  }

  pushHookEvent(data) {
    if (!this._window || this._window.isDestroyed()) return;
    this._window.webContents.send("hook-event", data);
  }

  pushModelConfig(current) {
    if (!this._window || this._window.isDestroyed()) return;
    this._window.webContents.send("model-config", {
      current,
      available: ["haiku", "sonnet", "opus"],
    });
  }

  showClaudeError(errorText) {
    console.log(`[Overlay] Claude session error`);
    const win = this._ensureWindow();
    win.show();

    const payload = { error: errorText };
    const send = () => win.webContents.send("claude-error", payload);
    win.webContents.once("did-finish-load", send);
    if (!win.webContents.isLoading()) send();

    return new Promise((resolve) => {
      const handler = () => {
        ipcMain.removeListener("claude-error-retry", handler);
        resolve();
      };
      ipcMain.on("claude-error-retry", handler);
    });
  }

  showPermissionPrompt({ toolName, toolInput }) {
    console.log(`[Overlay] Permission prompt: ${toolName}`);
    const win = this._ensureWindow();
    win.show();

    const payload = { toolName, toolInput };
    const send = () => win.webContents.send("permission-prompt", payload);
    win.webContents.once("did-finish-load", send);
    if (!win.webContents.isLoading()) send();

    return new Promise((resolve) => {
      // Auto-deny after 30s if no response
      const timeout = setTimeout(() => {
        if (this._permissionResolve === resolve) {
          this._permissionResolve = null;
          resolve("deny");
        }
      }, 30000);

      this._permissionResolve = (decision) => {
        clearTimeout(timeout);
        resolve(decision);
      };
    });
  }

  destroy() {
    ipcMain.removeAllListeners("overlay-close");
    ipcMain.removeAllListeners("overlay-resize");
    ipcMain.removeAllListeners("permission-response");
    ipcMain.removeAllListeners("claude-error-retry");
    ipcMain.removeAllListeners("model-change");
    if (this._permissionResolve) {
      this._permissionResolve("deny");
      this._permissionResolve = null;
    }
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
