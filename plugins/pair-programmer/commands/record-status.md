---
description: Check recording status via the recorder MCP tools
tools: Read
mcpServers: recorder
---

Show current recording status.

## Flow

1. Call `get_status`.
2. If it errors with "Recorder not reachable" → recorder is not running, suggest restarting the Claude session to start the pair programmer
3. Report concisely:
   - Recording: "Recording active for Xs — screen: N, mic: N, audio: N items"
   - Not recording: "Not recording. N items in buffer from last session."
   - Mention `rtstream_id` values when present (for searching past content)
