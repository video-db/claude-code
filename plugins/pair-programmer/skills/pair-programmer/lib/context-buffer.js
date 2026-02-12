const fs = require("fs");
const path = require("path");

const CTX_DIR = "/tmp/videodb-ctx";

class ContextBufferManager {
  constructor(recState, { bufferSizes }) {
    this._recordingState = recState;
    this._maxLen = bufferSizes;
    this._buffers = { screen: [], mic: [], system_audio: [] };
    this._lastNonFinal = { mic: null, system_audio: null };
    try { fs.mkdirSync(CTX_DIR, { recursive: true }); } catch (_) {}
    for (const type of Object.keys(this._buffers)) {
      this._flush(type);
    }
  }

  add(type, record) {
    if (!this._buffers[type]) return;
    const item = { text: record.text || "", timestamp: new Date().toISOString() };
    if (type === "mic" || type === "system_audio") {
      const isFinal = record.isFinal === true || record.isFinal === "true";
      if (!isFinal) {
        this._lastNonFinal[type] = item;
        this._flush(type);
        return;
      }
    }
    this._fifoPush(type, item);
    this._flush(type);
  }

  getRecent(type, limit = 10) {
    return (this._buffers[type] || []).slice(-limit);
  }

  getAll() {
    return {
      screen: this._buffers.screen,
      system_audio: this._buffers.system_audio,
      mic: this._buffers.mic,
    };
  }

  getCounts() {
    return {
      screen: this._buffers.screen.length,
      mic: this._buffers.mic.length,
      system_audio: this._buffers.system_audio.length,
    };
  }

  cleanup() {
    for (const f of ["screen.txt", "mic.txt", "system_audio.txt", "status.json"]) {
      try { fs.unlinkSync(path.join(CTX_DIR, f)); } catch (_) {}
    }
  }

  _fifoPush(type, item) {
    const q = this._buffers[type];
    q.push(item);
    if (q.length > this._maxLen[type]) q.shift();
  }

  _flush(type) {
    try {
      let data = this._buffers[type];
      if ((type === "mic" || type === "system_audio") && this._lastNonFinal[type]) {
        data = [...data, this._lastNonFinal[type]];
      }
      const lines = data.map(d => `${d.timestamp}\t${d.text.replace(/\n/g, " ")}`);
      fs.writeFileSync(path.join(CTX_DIR, `${type}.txt`), lines.join("\n") + "\n");
    } catch (_) {}
    this._writeStatus();
  }

  _writeStatus() {
    try {
      const status = {
        recording: this._recordingState.isRecording(),
        ...this._recordingState.toApiPayload(),
        bufferCounts: this.getCounts(),
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(CTX_DIR, "status.json"), JSON.stringify(status, null, 2));
    } catch (_) {}
  }
}

module.exports = ContextBufferManager;
