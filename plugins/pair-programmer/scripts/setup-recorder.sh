#!/bin/bash
# setup-recorder.sh - Install dependencies after config is set up
# Call this after running /pair-programmer:setup

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL_DIR="${PLUGIN_ROOT}/skills/pair-programmer"
CONFIG_DIR="${HOME}/.config/videodb"
CONFIG_FILE="${CONFIG_DIR}/config.json"

# Check if config exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: config.json not found. Run /pair-programmer:setup first."
  exit 1
fi

# Check setup status
SETUP_DONE=$(jq -r '.setup // false' "$CONFIG_FILE" 2>/dev/null)
API_KEY=$(jq -r '.videodb_api_key // ""' "$CONFIG_FILE" 2>/dev/null)

if [ "$SETUP_DONE" != "true" ] || [ -z "$API_KEY" ] || [ "$API_KEY" == "null" ]; then
  echo "Error: Setup not complete. Run /pair-programmer:setup first."
  exit 1
fi

# Install deps if needed (clean install to avoid extraneous packages)
if [ ! -d "$SKILL_DIR/node_modules" ] || [ ! -f "$SKILL_DIR/node_modules/.bin/electron" ]; then
  echo "Installing dependencies (this may take a minute for electron)..."
  cd "$SKILL_DIR"
  rm -rf node_modules
  npm install
fi

echo "✓ Dependencies ready. Restart your Claude session to start the pair programmer."
