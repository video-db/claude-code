# Pair Programmer

AI pair programmer with real-time screen and audio context, powered by [VideoDB Capture SDK](https://docs.videodb.io).

Records your screen and audio, indexes everything in real-time, and gives Claude Code full context of what you're seeing and hearing.

## Installation

```bash
# Add the VideoDB marketplace (one-time)
/plugin marketplace add video-db/claude-code

# Install the plugin
/plugin install pair-programmer@videodb
```

## Setup

After installation, run:

```bash
/pair-programmer:record-config
```

This will:
1. Ask for your [VideoDB API key](https://console.videodb.io)
2. Configure recording preferences
3. Install dependencies (electron, videodb SDK)
4. Start the recorder

## Commands

| Command | Description |
|---------|-------------|
| `/pair-programmer:record` | Start or stop recording (toggle) |
| `/pair-programmer:record-config` | Configure API key and preferences |
| `/pair-programmer:record-status` | Check recorder and recording status |
| `/pair-programmer:refresh-context` | Get current screen/audio/transcript context |
| `/pair-programmer:what-happened` | Summarize recent activity |
| `/pair-programmer:cortex` | AI assistant triggered via keyboard shortcut |
| `/pair-programmer:update` | Update npm dependencies (videodb SDK, electron) |

## How It Works

1. The recorder runs as an Electron app exposing an HTTP API on `localhost:8899`
2. It captures screen, microphone, and system audio via VideoDB Capture SDK
3. Everything is indexed in real-time (transcripts, scene descriptions)
4. Claude Code queries the API to get context about what you're working on

## Keyboard Shortcut

Press `Cmd+Shift+A` to trigger the AI assistant. It reads your current screen/audio context and responds via an overlay.

## Updating Dependencies

```bash
/pair-programmer:update
```

Stops the recorder, runs `npm update` to pull latest SDK versions, and restarts.

## Requirements

- macOS (screen recording + microphone permissions)
- [VideoDB API key](https://console.videodb.io)
- Node.js 18+

## License

MIT
