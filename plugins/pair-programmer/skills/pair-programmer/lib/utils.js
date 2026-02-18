function channelIdToDisplayName(channelId) {
  if (!channelId) return "unknown";
  if (channelId.startsWith("mic")) return "mic";
  if (channelId.startsWith("system_audio")) return "system_audio";
  if (channelId.startsWith("display")) return "screen";
  return channelId;
}

function matchDisplayToChannel(displayLabel, videoChannels) {
  if (!displayLabel || !Array.isArray(videoChannels) || videoChannels.length === 0)
    return null;
  const normalized = (s) => String(s || "").trim().toLowerCase();
  const label = normalized(displayLabel);
  const found = videoChannels.find(
    (c) => normalized(c.name) === label || normalized(c.extras?.name) === label
  );
  return found ? found.id : null;
}

function rtstreamNameToDisplayName(nameOrChannelId) {
  const s = (nameOrChannelId || "").toLowerCase();
  if (s === "mic" || s.startsWith("mic")) return "mic";
  if (s === "system_audio" || s.includes("system_audio")) return "system_audio";
  if (s === "display" || s === "screen" || s.startsWith("display")) return "screen";
  return s || "unknown";
}

function buildChannelsFromPicker(pickerResult) {
  const channels = [];
  if (pickerResult.mic) {
    channels.push({ channelId: "mic:default", type: "audio", record: true, store: true });
  }
  if (pickerResult.systemAudio) {
    channels.push({ channelId: "system_audio:default", type: "audio", record: true, store: true });
  }
  channels.push({ channelId: pickerResult.displayChannelId, type: "video", record: true, store: true });
  return channels;
}

function getIndexingConfig(defaults, runtimeOverrides) {
  const runtime = runtimeOverrides || {};
  return {
    visual: { ...defaults.visual, ...runtime.visual },
    system_audio: { ...defaults.system_audio, ...runtime.system_audio },
    mic: { ...defaults.mic, ...runtime.mic },
  };
}

module.exports = {
  channelIdToDisplayName,
  matchDisplayToChannel,
  rtstreamNameToDisplayName,
  buildChannelsFromPicker,
  getIndexingConfig,
};
