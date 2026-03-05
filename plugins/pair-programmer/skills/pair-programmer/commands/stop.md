---
description: Stop the running screen/audio recording
tools: Bash, Read
---

Stop the VideoDB Pair Programmer recorder.

## Flow

### 1. Check if running

Read the PID file at `/tmp/videodb_pp_pid`.

- If the file doesn't exist → Tell the user no recorder is currently running.
- If the file exists, check if the process with that PID is still running.
- If the process is not running → Clean up the stale PID file and tell the user.
- If running → Continue to step 2.

### 2. Stop the recorder

Send `SIGTERM` to the process ID from the PID file. This triggers the recorder's graceful shutdown which stops the capture session, waits for the export event, cleans up WebSocket connections, and removes the PID file.

### 3. Verify

Wait a few seconds, then check if the process has exited by checking if the PID is still running.

- If stopped → Tell the user the recording has been stopped.
- If still running → Send `SIGKILL` as a fallback and inform the user.
