const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

class TunnelManager {
  constructor(binDir) {
    this._binDir = binDir;
    this._process = null;
    this._cloudflaredPath = null;
  }

  getCloudflaredPath() {
    if (this._cloudflaredPath && fs.existsSync(this._cloudflaredPath)) {
      return this._cloudflaredPath;
    }

    // Check if cloudflared is in PATH
    try {
      const result = execSync("which cloudflared", { encoding: "utf8" }).trim();
      if (result) {
        this._cloudflaredPath = result;
        return this._cloudflaredPath;
      }
    } catch (e) {}

    // Download cloudflared
    if (!fs.existsSync(this._binDir)) fs.mkdirSync(this._binDir, { recursive: true });

    const system = process.platform;
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const binaryPath = path.join(this._binDir, "cloudflared");

    if (!fs.existsSync(binaryPath)) {
      console.log("Downloading cloudflared...");

      let url;
      if (system === "darwin") {
        url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`;
      } else {
        url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
      }

      try {
        if (system === "darwin") {
          execSync(
            `curl -L "${url}" -o "${this._binDir}/cloudflared.tgz" && tar -xzf "${this._binDir}/cloudflared.tgz" -C "${this._binDir}" && rm "${this._binDir}/cloudflared.tgz"`,
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

    this._cloudflaredPath = binaryPath;
    return this._cloudflaredPath;
  }

  async start(port) {
    await this.stop();

    const cloudflared = this.getCloudflaredPath();
    if (!cloudflared) return null;

    return new Promise((resolve) => {
      this._process = spawn(
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

      this._process.stdout.on("data", handleData);
      this._process.stderr.on("data", handleData);

      this._process.on("error", (e) => {
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
  }

  async stop() {
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
  }
}

module.exports = TunnelManager;
