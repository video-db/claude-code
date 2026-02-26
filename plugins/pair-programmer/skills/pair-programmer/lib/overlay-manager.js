const { dialog } = require("electron");

/**
 * No-op facade — all callers (HTTP API, MCP tools, hook socket, assistant shortcut)
 * continue working without changes. No BrowserWindow is created.
 */
class OverlayManager {
  constructor() {}

  show(text) {
    console.log("[Overlay] show (no-op):", text || "(empty)");
    return { status: "ok" };
  }

  hide() {
    console.log("[Overlay] hide (no-op)");
    return { status: "ok" };
  }

  setVisible(visible) {
    console.log(`[Overlay] setVisible(${visible}) (no-op)`);
  }

  showReady() {
    console.log("[Overlay] showReady (no-op)");
  }

  pushHookEvent() {}

  pushModelConfig() {}

  async showClaudeError(errorText) {
    console.log("[Overlay] Claude session error — showing native dialog");
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "Claude Session Error",
      message: "Failed to create Claude session",
      detail: errorText,
      buttons: ["Retry", "Quit"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 1) {
      const { app } = require("electron");
      app.quit();
    }
    // response === 0 means Retry — resolve and let the retry loop continue
  }

  async showPermissionPrompt({ toolName, toolInput }) {
    console.log(`[Overlay] Permission prompt (native dialog): ${toolName}`);
    const detail = typeof toolInput === "string"
      ? toolInput
      : JSON.stringify(toolInput, null, 2);
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Permission Request",
      message: `Allow tool: ${toolName}?`,
      detail: detail.substring(0, 500),
      buttons: ["Allow", "Deny"],
      defaultId: 1,
      cancelId: 1,
    });
    return response === 0 ? "allow" : "deny";
  }

  destroy() {
    console.log("[Overlay] destroy (no-op)");
  }
}

module.exports = OverlayManager;
