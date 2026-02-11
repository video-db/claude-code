const fs = require("fs");

class ContextBufferManager {
  constructor(recState, { filePath, bufferSizes }) {
    this._recordingState = recState;
    this._filePath = filePath;
    this._maxLen = bufferSizes;
    this._buffers = { screen: [], mic: [], system_audio: [] };
    this._lastNonFinal = { mic: null, system_audio: null };
  }

  add(type, record) {
    if (!this._buffers[type]) return;
    const item = { ...record, timestamp: new Date().toISOString() };
    if (type === "mic" || type === "system_audio") {
      const isFinal = record.isFinal === true || record.isFinal === "true";
      if (!isFinal) {
        this._lastNonFinal[type] = item;
        this._writeToFile();
        return;
      }
    }
    this._fifoPush(type, item);
    this._writeToFile();
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
    try {
      if (fs.existsSync(this._filePath)) fs.unlinkSync(this._filePath);
    } catch (_) {}
  }

  _fifoPush(type, item) {
    const q = this._buffers[type];
    q.push(item);
    if (q.length > this._maxLen[type]) q.shift();
  }

  _writeToFile() {
    try {
      const mic = this._buffers.mic;
      const systemAudio = this._buffers.system_audio;
      const micForFile = this._lastNonFinal.mic ? [...mic, this._lastNonFinal.mic] : mic;
      const systemAudioForFile = this._lastNonFinal.system_audio
        ? [...systemAudio, this._lastNonFinal.system_audio]
        : systemAudio;
      fs.writeFileSync(
        this._filePath,
        JSON.stringify(
          {
            screen: this._buffers.screen,
            system_audio: systemAudioForFile,
            mic: micForFile,
            recording: {
              active: this._recordingState.active,
              sessionId: this._recordingState.sessionId,
              startTime: this._recordingState.startTime,
            },
            lastUpdated: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (e) {}
  }
}

module.exports = ContextBufferManager;
