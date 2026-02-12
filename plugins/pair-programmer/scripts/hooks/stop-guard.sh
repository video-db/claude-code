#!/bin/bash
# Stop guard hook for the pair-programmer cortex agent.
# Reads the transcript to check if the agent sent a final overlay message.
# If not, blocks the stop and tells the agent to continue.

set -euo pipefail

INPUT=$(cat)
LOG="/tmp/videodb-hooks.log"
SOCK="/tmp/videodb-hook.sock"
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""')

# Only guard if recorder is running (socket exists)
[ -S "$SOCK" ] || exit 0

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [StopGuard] Checking transcript for final overlay call" >> "$LOG"

# Check if transcript exists
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [StopGuard] No transcript, allowing stop" >> "$LOG"
  exit 0
fi

# Count show_overlay calls (MCP tool calls in transcript)
OVERLAY_CALLS=$(grep -c 'show_overlay' "$TRANSCRIPT_PATH" 2>/dev/null) || OVERLAY_CALLS=0
LOADING_CALLS=$(grep -c '"loading"' "$TRANSCRIPT_PATH" 2>/dev/null) || LOADING_CALLS=0
CONTENT_CALLS=$((OVERLAY_CALLS - LOADING_CALLS))

# Check if any overlay call has substantial text (>100 chars)
# Match both "text":"..." and "text": "..." formats from MCP tool arguments
HAS_SUBSTANTIAL=""
if grep -o '"text"[[:space:]]*:[[:space:]]*"[^"]*"' "$TRANSCRIPT_PATH" 2>/dev/null | awk '{ if (length($0) > 110) { print "yes"; exit } }' | grep -q "yes" 2>/dev/null; then
  HAS_SUBSTANTIAL="yes"
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [StopGuard] overlay=$OVERLAY_CALLS loading=$LOADING_CALLS content=$CONTENT_CALLS substantial=$HAS_SUBSTANTIAL" >> "$LOG"

if [ "$CONTENT_CALLS" -ge 1 ] && [ "$HAS_SUBSTANTIAL" = "yes" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [StopGuard] Substantial final overlay found, allowing stop" >> "$LOG"
  exit 0
fi

# Agent hasn't sent a proper final answer — block the stop
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [StopGuard] No substantial overlay found, blocking stop" >> "$LOG"

jq -n '{
  "decision": "block",
  "reason": "You have NOT sent a complete answer to the overlay yet. Your text output is invisible to the user — only show_overlay calls are visible. You MUST:\n1. Finish your full analysis (launch subagents if you have not, synthesize their results)\n2. Call the show_overlay MCP tool with a comprehensive, well-structured response (code snippets + explanation)\n3. The response must be substantial — not a brief summary. Show code, suggest fixes, be specific.\nDo NOT stop until you have sent your complete final answer via show_overlay."
}'

exit 0
