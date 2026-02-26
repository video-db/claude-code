const { Tray, Menu, app, nativeImage } = require("electron");

const EMPTY_ICON = nativeImage.createEmpty();

class TrayManager {
  constructor(recState, { widget, ctxBuffer, onStartRecording, onStopRecording }) {
    this._tray = null;
    this._recordingState = recState;
    this._widgetManager = widget;
    this._contextBuffer = ctxBuffer;
    this._onStartRecording = onStartRecording;
    this._onStopRecording = onStopRecording;
    this._startupComplete = false;
    this._updateInterval = null;
    recState.on("stateChanged", () => {
      if (recState.active) this._startRecordingBlink();
      else this._stopRecordingBlink();
      this.update();
    });
  }

  create() {
    try {
      this._tray = new Tray(EMPTY_ICON);
      this._tray.setTitle(" 🧞 PP");
      this._tray.setToolTip("VideoDB Recorder — Starting...");
      this._tray.setContextMenu(this._buildMenu());
      this._tray.on("click", () => this._tray.popUpContextMenu());

      this._updateInterval = setInterval(() => {
        if (this._recordingState.active) this.update();
      }, 1000);
    } catch (e) {
      console.error("[TrayManager] create() FAILED:", e.message, e.stack);
    }
  }

  markStartupComplete() {
    this._startupComplete = true;
    this.update();
  }

  update() {
    if (!this._tray) return;
    const rs = this._recordingState;
    if (!rs.active) this._tray.setTitle(" 🧞 PP");
    this._tray.setToolTip(
      !this._startupComplete ? "Starting..." : rs.active ? `Recording ${rs.formattedDuration || ""}` : "Ready"
    );
    this._tray.setContextMenu(this._buildMenu());
  }

  destroy() {
    this._stopRecordingBlink();
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
    if (this._tray) {
      this._tray.destroy();
      this._tray = null;
    }
  }

  _startRecordingBlink() {
    if (this._blinkInterval) return;
    this._blinkOn = true;
    this._blinkInterval = setInterval(() => {
      if (!this._tray || !this._recordingState.active) return;
      this._blinkOn = !this._blinkOn;
      this._tray.setTitle(this._blinkOn ? " 🔴 PP" : " 🧞 PP");
    }, 1000);
  }

  _stopRecordingBlink() {
    if (this._blinkInterval) {
      clearInterval(this._blinkInterval);
      this._blinkInterval = null;
    }
  }

  _buildMenu() {
    const rs = this._recordingState;
    const menu = [];

    if (!this._startupComplete) {
      menu.push({ label: "Starting...", enabled: false });
      menu.push({ type: "separator" });
      menu.push({ label: "Start Recording", enabled: false });
      menu.push({ type: "separator" });
      menu.push({ label: "Show Widget", click: () => this._widgetManager.show() });
      menu.push({ label: "Hide Widget", click: () => this._widgetManager.hide() });
      menu.push({ type: "separator" });
      menu.push({ label: "Quit", click: () => app.quit() });
      return Menu.buildFromTemplate(menu);
    }

    if (rs.active) {
      menu.push({ label: `🔴 Recording ${rs.formattedDuration || ""}`, enabled: false });
      menu.push({ type: "separator" });
      menu.push({
        label: "Stop Recording",
        click: async () => {
          await this._onStopRecording();
        },
      });
    } else {
      const hintLabel = rs.failed
        ? "Recording failed — run /record in Claude to try again"
        : "Ready to Record";
      menu.push({ label: hintLabel, enabled: false });
      menu.push({ type: "separator" });
      menu.push({
        label: "Start Recording",
        click: async () => {
          await this._onStartRecording();
        },
      });
    }

    menu.push({ type: "separator" });
    menu.push({ label: "Show Widget", click: () => this._widgetManager.show() });
    menu.push({ label: "Hide Widget", click: () => this._widgetManager.hide() });
    menu.push({ type: "separator" });
    menu.push({ label: "Quit", click: () => app.quit() });

    return Menu.buildFromTemplate(menu);
  }
}

module.exports = TrayManager;
