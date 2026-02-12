---
name: pair-programmer
description: AI pair programming with real-time screen and audio context. Use when the user wants to record their screen, check recording status, get context from what they're doing, or control the VideoDB recorder.
---

# VideoDB Pair Programmer – HTTP API

AI pair programming with real-time screen and audio context. Control everything via the **recorder HTTP API**. Port is in `~/.config/videodb/config.json` as `recorder_port` (default **8899**).

**Base URL:** `http://127.0.0.1:PORT`

---

## On Session Start

When a new session starts and the user hasn't requested anything specific, run `/pair-programmer:record-config` to verify setup and start the recorder if needed.

---

## Lifecycle

- **Session Start:** If config is complete, starts the recorder; if deps missing, prompts to run `/pair-programmer:record-config`.
- **Session End:** Stops the recorder app.
- **After `/pair-programmer:record-config`:** Installs deps if needed, runs `start-recorder.sh` to start the app.

---

## Commands (slash commands)

| Command | What it does |
|---------|-------------|
| `/pair-programmer:record` | Start or stop recording |
| `/pair-programmer:record-status` | Show recording status |
| `/pair-programmer:refresh-context` | Fetch and summarize all context |
| `/pair-programmer:what-happened` | Summarize recent activity timeline |
| `/pair-programmer:record-config` | Configure API key and settings |
| `/pair-programmer:cortex` | Shortcut-triggered: analyze context, respond via overlay |

---

## HTTP API Reference

All POST requests require `Content-Type: application/json`. Replace `PORT` with the value from config (default `8899`).

---

### GET `/api/status` — Recording status

Returns current recording state, session ID, duration, buffer counts, and active rtstreams.

```bash
curl -s http://127.0.0.1:PORT/api/status
```

**Response:**
```json
{
  "status": "ok",
  "recording": true,
  "sessionId": "cs-abc123",
  "duration": 45,
  "bufferCounts": { "screen": 12, "mic": 8, "system_audio": 5 },
  "rtstreams": [
    { "rtstream_id": "rt-xxx", "name": "display", "scene_index_id": "si-yyy", "index_type": "screen" },
    { "rtstream_id": "rt-zzz", "name": "mic", "scene_index_id": "si-www", "index_type": "mic" }
  ]
}
```

**Use `rtstreams`** to:
- Search indexed content → pass `rtstream_id` to `POST /api/rtstream/search`
- Update indexing prompt → pass `rtstream_id` + `scene_index_id` to `POST /api/rtstream/update-prompt`

---

### POST `/api/record/start` — Start recording

Opens the screen picker UI and begins recording. Optionally override indexing config for this session.

```bash
# Basic start (opens picker)
curl -s -X POST http://127.0.0.1:PORT/api/record/start \
  -H "Content-Type: application/json" -d '{}'

# Start with custom indexing prompt
curl -s -X POST http://127.0.0.1:PORT/api/record/start \
  -H "Content-Type: application/json" \
  -d '{"indexing_config":{"visual":{"prompt":"Focus on code and error messages"}}}'
```

**Body (optional):**
```json
{
  "indexing_config": {
    "visual": { "prompt": "...", "batch_time": 2, "frame_count": 3 },
    "mic": { "enabled": true, "prompt": "..." },
    "system_audio": { "enabled": true, "prompt": "..." }
  }
}
```
Only include fields you want to override; others use config defaults.

**Response:** `{ "status": "ok", "sessionId": "cs-abc123" }` or `{ "status": "error", "error": "Already recording" }`

---

### POST `/api/record/stop` — Stop recording

```bash
curl -s -X POST http://127.0.0.1:PORT/api/record/stop \
  -H "Content-Type: application/json"
```

**Response:** `{ "status": "ok", "duration": 120 }` (seconds)

---

### GET `/api/context/:type` — Get captured context

Returns the last N items from the context buffer. Type is `screen`, `mic`, `system_audio`, or `all`.

```bash
# All context (screen + mic + system audio combined)
curl -s http://127.0.0.1:PORT/api/context/all

# Screen context only
curl -s http://127.0.0.1:PORT/api/context/screen

# Mic context only
curl -s http://127.0.0.1:PORT/api/context/mic

# System audio context only
curl -s http://127.0.0.1:PORT/api/context/system_audio
```

**Response for `/api/context/all`:**
```json
{
  "status": "ok",
  "screen": [{ "timestamp": "2025-01-15T10:00:00Z", "text": "User has VS Code open with auth.ts" }],
  "mic": [{ "timestamp": "2025-01-15T10:00:05Z", "text": "I need to fix the login flow" }],
  "system_audio": [{ "timestamp": "2025-01-15T10:00:10Z", "text": "Video tutorial explaining OAuth2" }]
}
```

Each array is a FIFO buffer (oldest first). Buffer size is configurable in config.

---

### POST `/api/rtstream/search` — Semantic search across indexed content

Search past content within a specific rtstream. Get `rtstream_id` from `GET /api/status`.

```bash
curl -s -X POST http://127.0.0.1:PORT/api/rtstream/search \
  -H "Content-Type: application/json" \
  -d '{"rtstream_id":"rt-xxx","query":"error message stack trace"}'
```

**Body:** `{ "rtstream_id": "<from status>", "query": "keyword-rich search" }`

Use keyword-rich queries. Try multiple queries with different terms if the first doesn't return useful results (e.g. "error", "stack trace", "exception", "failed").

---

### POST `/api/rtstream/update-prompt` — Change what the indexing model focuses on

Update the AI prompt used for indexing a stream. Persists to config. Get `rtstream_id` and `scene_index_id` from `GET /api/status`.

```bash
curl -s -X POST http://127.0.0.1:PORT/api/rtstream/update-prompt \
  -H "Content-Type: application/json" \
  -d '{"rtstream_id":"rt-xxx","scene_index_id":"si-yyy","prompt":"Focus on error messages and stack traces"}'
```

Subsequent indexing batches will use the new prompt. Useful when context descriptions are too vague.

---

### POST `/api/overlay/show` — Show overlay message

Display text or a loading spinner in the overlay window.

```bash
# Show text
curl -s -X POST http://127.0.0.1:PORT/api/overlay/show \
  -H "Content-Type: application/json" -d '{"text":"Your message here"}'

# Show loading spinner
curl -s -X POST http://127.0.0.1:PORT/api/overlay/show \
  -H "Content-Type: application/json" -d '{"loading":true}'
```

---

### POST `/api/overlay/hide` — Hide overlay

```bash
curl -s -X POST http://127.0.0.1:PORT/api/overlay/hide \
  -H "Content-Type: application/json"
```

---

### GET `/api/permissions` — Permission status

```bash
curl -s http://127.0.0.1:PORT/api/permissions
```

**Response:** `{ "status": "ok", "message": "Permissions requested at startup via CaptureClient" }`

Permissions (screen recording and microphone) are requested automatically at startup via `CaptureClient.requestPermission`. No manual check needed.

---

### GET `/` or `/api` — List all endpoints

Returns available routes with curl examples.

```bash
curl -s http://127.0.0.1:PORT/
```

---

## First-time setup

Run `/pair-programmer:record-config`: set VideoDB API key, then start recorder.

---

## Files

```
pair-programmer/                    # Plugin root
├── .claude-plugin/
│   └── plugin.json                 # Plugin manifest
├── commands/                       # Slash commands
├── skills/pair-programmer/
│   ├── SKILL.md                    # This file
│   ├── package.json                # Electron + videodb deps (self-contained)
│   ├── recorder-app.js             # Electron app + HTTP API server
│   └── ui/
├── hooks/
│   └── hooks.json                  # SessionStart + SessionEnd hooks
└── scripts/
    ├── ensure-recorder.sh          # SessionStart: deps + permissions + start
    ├── start-recorder.sh           # Manual start after record-config
    └── cleanup-recorder.sh         # SessionEnd: stop recorder
```

Config: `~/.config/videodb/config.json` — `recorder_port` (default 8899), `videodb_api_key`, and optional indexing/context settings. Persists across plugin updates.
