---
name: pair-programmer
description: AI pair programming with real-time screen and audio context. Use when the user wants to record their screen, start/stop recording, or get context from what they're doing.
---

# VideoDB Pair Programmer

AI pair programming with real-time screen and audio context. Record your screen and audio, with AI-powered indexing that logs visual and audio events in real-time.

## Commands

When user asks for a command, read the corresponding file for instructions:

| Command | Description | Reference |
|---------|-------------|-----------|
| `/pair-programmer record` | Start screen/audio recording | See [commands/record.md](commands/record.md) |
| `/pair-programmer stop` | Stop the running recording | See [commands/stop.md](commands/stop.md) |
| `/pair-programmer search` | Search recording context (screen, mic, audio) | See [commands/search.md](commands/search.md) |
| `/pair-programmer what-happened` | Summarize recent activity | See [commands/what-happened.md](commands/what-happened.md) |
| `/pair-programmer setup` | Install deps and configure API key | See [commands/setup.md](commands/setup.md) |
| `/pair-programmer config` | Change indexing and other settings | See [commands/config.md](commands/config.md) |

## How It Works

1. User runs `/pair-programmer setup` to install dependencies and set `VIDEO_DB_API_KEY` environment variable
2. User runs `/pair-programmer record` to start recording
3. A picker UI appears to select screen and audio sources
4. Recording starts and events are logged to `/tmp/videodb_pp_events.jsonl`
5. User can stop recording from the tray icon (🔴 PP → Stop Recording)

## Output Files

| Path | Content |
|------|---------|
| `/tmp/videodb_pp_pid` | Process ID of the recorder |
| `/tmp/videodb_pp_events.jsonl` | All WebSocket events (JSONL format) |
| `/tmp/videodb_pp_info.json` | Current session info (session_id, rtstream_ids) |

## Event File Format

Events are written as JSONL (one JSON object per line):

```json
{"ts": "2026-03-05T10:15:30.123Z", "unix_ts": 1709374530.12, "channel": "visual_index", "data": {"text": "User is viewing VS Code with auth.ts open"}}
{"ts": "2026-03-05T10:15:31.456Z", "unix_ts": 1709374531.45, "channel": "transcript", "data": {"text": "Let me check the login flow", "is_final": true}}
```

## Environment Variables

The recorder reads these from environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `VIDEO_DB_API_KEY` | Yes | VideoDB API key |
| `VIDEO_DB_BASE_URL` | No | API endpoint (default: https://api.videodb.io) |

## Reading Context

Events are in `/tmp/videodb_pp_events.jsonl`. Use CLI tools to filter — never read the whole file.

| Channel | Content | Density |
|---------|---------|---------|
| `visual_index` | Screen descriptions | Dense (~1 every 2s) |
| `transcript` | Mic speech | Sparse (sentences) |
| `audio_index` | System audio summaries | Sparse (sentences) |

```bash
# Recent screen context
grep '"channel":"visual_index"' /tmp/videodb_pp_events.jsonl | tail -10

# Last 5 min of mic transcript
awk -v cutoff=$(($(date +%s) - 300)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"transcript"'

# Keyword search across all channels
grep -i 'keyword' /tmp/videodb_pp_events.jsonl
```

For semantic search across indexed content, use `search-rtstream.js`:

```bash
node search-rtstream.js --query="your query" --cwd=$(pwd)
```

See [commands/search.md](commands/search.md) for the full search strategy and CLI patterns.
