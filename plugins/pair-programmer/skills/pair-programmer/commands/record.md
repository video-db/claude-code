---
description: Start screen/audio recording
tools: Bash, Read
---

Start the VideoDB Pair Programmer recorder.

## Flow

### 1. Check if already running

1. Read the PID file at `/tmp/videodb_pp_pid`
2. If the file exists, check if the process with that PID is still running
3. If running → Tell the user the recorder is already active. They can stop it from the tray icon (🔴 PP in menu bar)
4. If not running → Continue to step 2

### 2. Verify VideoDB connection

Run inline Node.js to verify the API key and connection:

```javascript
require("dotenv").config({ path: require("path").join(process.cwd(), ".env") });
const { connect } = require("videodb");

const apiKey = process.env.VIDEO_DB_API_KEY;
if (!apiKey) {
  console.error("VIDEO_DB_API_KEY not set");
  process.exit(1);
}

const conn = connect({ apiKey });
const coll = await conn.getCollection();
console.log("Connected to VideoDB, collection:", coll.id);
```

- If successful → Continue to step 3
- If `VIDEO_DB_API_KEY not set` → Tell user to either `export VIDEO_DB_API_KEY=your_key` or add it to a `.env` file in their project root
- If connection error → Check if the API key is valid

### 3. Start the recorder

Run the Electron app as a background process from the skill directory:

```bash
nohup npx electron recorder-app.js --cwd=$(pwd) > /tmp/videodb_pp_logs 2>&1 &
```

> Note: `--cwd` passes the user's project root so the recorder can load `.env` from there.

### 4. Confirm

Tell the user:
- The recorder is starting
- A picker UI will appear to select screen/audio sources
- After selection, recording will start automatically
- Events are logged to `/tmp/videodb_pp_events.jsonl`
- Stop recording from the tray icon (🔴 PP → Stop Recording) or the overlay widget
