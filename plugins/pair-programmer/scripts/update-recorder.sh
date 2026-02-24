#!/bin/bash
# update-recorder.sh - Post-update: install deps + restart recorder
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

# ── Step 3: Restart recorder if config is ready ──
SETUP_DONE=$(jq -r '.setup // false' "$CONFIG_FILE" 2>/dev/null)
API_KEY=$(jq -r '.videodb_api_key // ""' "$CONFIG_FILE" 2>/dev/null)

if [ "$SETUP_DONE" == "true" ] && [ -n "$API_KEY" ] && [ "$API_KEY" != "null" ]; then
  echo ""
  echo "Restarting recorder..."
  cd "$SKILL_DIR"
  PROJECT_DIR="$CLAUDE_PROJECT_DIR" nohup npm start > /tmp/videodb-recorder.log 2>&1 &

  for i in 1 2 3 4 5; do
    sleep 2
    if lsof -i :$PORT >/dev/null 2>&1; then
      echo "✓ Recorder restarted on port $PORT"
      exit 0
    fi
  done

  echo "✗ Failed to restart. Check /tmp/videodb-recorder.log"
  tail -20 /tmp/videodb-recorder.log
  exit 1
else
  echo ""
  echo "Config not ready, skipping restart. Run /pair-programmer:record-config to set up."
fi
