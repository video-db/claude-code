#!/bin/bash
# update-recorder.sh - Post-update: stop recorder + reinstall deps
# Run after `claude plugin update pair-programmer@videodb`

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL_DIR="${PLUGIN_ROOT}/skills/pair-programmer"
CONFIG_DIR="${HOME}/.config/videodb"
CONFIG_FILE="${CONFIG_DIR}/config.json"

PORT=$(jq -r '.recorder_port // 8899' "$CONFIG_FILE" 2>/dev/null)

# ── Step 1: Stop recorder if running ──
if lsof -i :$PORT >/dev/null 2>&1; then
  echo "Stopping recorder on port $PORT..."
  PID=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    kill $PID 2>/dev/null
    sleep 2
    if kill -0 $PID 2>/dev/null; then
      kill -9 $PID 2>/dev/null
    fi
    echo "✓ Recorder stopped"
  fi
else
  echo "Recorder not running"
fi

# ── Step 2: Install/update npm dependencies ──
echo ""
cd "$SKILL_DIR"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
else
  echo "Updating dependencies..."
  npm install
fi
echo "✓ Dependencies ready"

echo ""
echo "✓ Update complete. Restart your Claude session to start the pair programmer."
