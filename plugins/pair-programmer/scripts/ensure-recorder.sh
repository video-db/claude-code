#!/bin/bash
# ensure-recorder.sh - SessionStart hook to ensure recorder app is ready
# This runs automatically when a Claude Code session starts

# Guard: only run inside Claude Code CLI. Cursor IDE imports these hooks via
# "Third-party skills" and fires them on every new tab — CLAUDE_CODE_ENTRYPOINT
# is set to "cli" by Claude Code but absent in Cursor.
[ "$CLAUDE_CODE_ENTRYPOINT" != "cli" ] && exit 0

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
SKILL_DIR="${PLUGIN_ROOT}/skills/pair-programmer"
CONFIG_DIR="${HOME}/.config/videodb"
CONFIG_FILE="${CONFIG_DIR}/config.json"

# Check if dependencies are installed (don't auto-install; /pair-programmer:record-config does it on demand)
if [ ! -d "$SKILL_DIR/node_modules" ] || [ ! -f "$SKILL_DIR/node_modules/.bin/electron" ]; then
  echo '⚠️ Dependencies not installed.

Run `/pair-programmer:record-config` to set up the recorder (this will install dependencies).'
  exit 0
fi

# Check if config exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo '⚠️ VideoDB Pair Programmer not configured.

**IMPORTANT: You MUST complete setup before using /pair-programmer:record or any recording commands.**

Run this command NOW to configure:
→ /pair-programmer:record-config

This will set up your API key and start the recorder. Do NOT skip this step.'
  exit 0
fi

# Check if setup is complete
SETUP_DONE=$(jq -r '.setup // false' "$CONFIG_FILE" 2>/dev/null)
API_KEY=$(jq -r '.videodb_api_key // ""' "$CONFIG_FILE" 2>/dev/null)

if [ "$SETUP_DONE" != "true" ] || [ -z "$API_KEY" ] || [ "$API_KEY" == "null" ]; then
  echo '⚠️ VideoDB Pair Programmer setup incomplete.

**IMPORTANT: You MUST complete setup before using /pair-programmer:record or any recording commands.**

Run this command NOW to finish configuration:
→ /pair-programmer:record-config

This will verify your API key and start the recorder. Do NOT skip this step.'
  exit 0
fi

# Setup is complete - start the recorder
# Read port from config (default 8899)
PORT=$(jq -r '.recorder_port // 8899' "$CONFIG_FILE" 2>/dev/null)

# Check if recorder is already running on the port
if lsof -i :$PORT >/dev/null 2>&1; then
  echo "✓ VideoDB Recorder ready on port $PORT."
  exit 0
fi

# Not running - start it in background
cd "$SKILL_DIR"
PROJECT_DIR="$CLAUDE_PROJECT_DIR" nohup npm start > /tmp/videodb-recorder.log 2>&1 &

# Wait briefly and verify it started
sleep 3

if lsof -i :$PORT >/dev/null 2>&1; then
  echo "✓ VideoDB Recorder started on port $PORT. Ready for /pair-programmer:record."
else
  echo "⚠️ Recorder failed to start. Check /tmp/videodb-recorder.log"
  exit 0
fi

exit 0
