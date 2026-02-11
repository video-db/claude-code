const { EventEmitter } = require("events");

class RecordingState extends EventEmitter {
  constructor() {
    super();
    this._state = {
      active: false,
      starting: false,
      stopping: false,
      stopped: false,
      exported: null,
      sessionId: null,
      startTime: null,
      channels: null,
      rtstreams: null,
      failed: null,
      visualLatency: null,
    };
  }

  get active() { return this._state.active; }
  get starting() { return this._state.starting; }
  get stopping() { return this._state.stopping; }
  get stopped() { return this._state.stopped; }
  get exported() { return this._state.exported; }
  get visualLatency() { return this._state.visualLatency; }
  get sessionId() { return this._state.sessionId; }
  get startTime() { return this._state.startTime; }
  get channels() { return this._state.channels; }
  get rtstreams() { return this._state.rtstreams; }
  get failed() { return this._state.failed; }

  get duration() {
    if (!this._state.active || !this._state.startTime) return 0;
    return Math.round((Date.now() - this._state.startTime) / 1000);
  }

  get formattedDuration() {
    if (!this._state.active || !this._state.startTime) return null;
    const seconds = this.duration;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  markStarting() {
    this._update({ starting: true, stopping: false, stopped: false, exported: null, failed: null });
  }

  markActive(sessionId, channels, rtstreams) {
    this._update({
      active: true,
      starting: false,
      stopping: false,
      stopped: false,
      failed: null,
      sessionId,
      channels,
      rtstreams: rtstreams !== undefined ? rtstreams : this._state.rtstreams,
      startTime: this._state.startTime || Date.now(),
    });
  }

  markStopping() {
    this._update({ stopping: true });
  }

  markStopped() {
    this._update({
      active: false,
      starting: false,
      stopping: false,
      stopped: true,
      sessionId: null,
      startTime: null,
      channels: null,
      failed: null,
      visualLatency: null,
    });
  }

  markExported(videoId, playerUrl) {
    this._update({ exported: { videoId: videoId || null, playerUrl: playerUrl || null } });
  }

  markFailed(code, message) {
    this._update({
      active: false,
      starting: false,
      stopping: false,
      stopped: false,
      sessionId: null,
      channels: null,
      failed: { code, message },
    });
  }

  setVisualLatency(latencyMs) {
    this._state.visualLatency = latencyMs;
    this.emit("stateChanged");
  }

  setRtstreams(rtstreams) {
    this._state.rtstreams = rtstreams;
    this.emit("stateChanged");
  }

  setChannels(channels) {
    this._state.channels = channels;
  }

  toOverlayPayload() {
    return {
      recording: this._state.active,
      starting: this._state.starting,
      stopping: this._state.stopping,
      stopped: this._state.stopped,
      exported: this._state.exported,
      failed: this._state.failed,
      duration: this.duration,
      channels: this._state.channels || [],
      visualLatency: this._state.visualLatency,
    };
  }

  toApiPayload() {
    return {
      recording: this._state.active,
      sessionId: this._state.sessionId,
      duration: this.duration,
      rtstreams: this._state.rtstreams || [],
    };
  }

  _update(changes) {
    Object.assign(this._state, changes);
    this.emit("stateChanged");
  }
}

module.exports = RecordingState;
