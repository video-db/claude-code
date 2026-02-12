#!/bin/bash
# Fast hook — pipes raw event JSON to the recorder's Unix socket.
# The recorder handles parsing, filtering, and overlay dispatch.
SOCK="/tmp/videodb-hook.sock"
[ -S "$SOCK" ] || exit 0
cat | nc -U "$SOCK" &
exit 0
