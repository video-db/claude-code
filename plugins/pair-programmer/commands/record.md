---
description: Start or stop screen/audio recording with optional runtime config
tools: Bash, Read
mcpServers: recorder
---

Control recording via the `recorder` MCP tools.

## Flow

### 1. Ensure recorder is ready

Use the **Read tool** to read `~/.config/videodb/config.json`. Check `setup` is `true` and `videodb_api_key` exists. Get `recorder_port` (default 8899).

```bash
lsof -i :$PORT >/dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING"
```

- **Config OK + RUNNING** → go to step 2
- **Config missing / `setup: false`** → Do NOT ask the user, immediately execute `/pair-programmer:setup` yourself and then continue to step 2
- **Config OK + NOT RUNNING** → Tell the user to restart their Claude session to start the pair programmer

### 2. Start or stop

Call `get_status` to check the current recording state.

- **If NOT recording** → call `record_start`. Optionally pass `indexing_config` if the user specifies a focus (e.g. `{"indexing_config":{"visual":{"prompt":"Focus on code"}}}`).
- **If already recording** → call `record_stop`.
- **If user explicitly says "stop"** → stop regardless.

### 3. Report result

- Start → confirm recording started
- Stop → report duration from response
- Error → show the error message
