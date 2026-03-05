---
description: Search recording context — screen, mic, and system audio events
tools: Bash, Read, Task
---

Search the pair programmer's recording context to answer questions about what the user has been doing, saying, or seeing.

## Events File

All recording events are in `/tmp/videodb_pp_events.jsonl` (one JSON per line). Each line has:

```json
{"ts": "2026-03-05T10:15:30.123Z", "unix_ts": 1709374530.12, "channel": "visual_index", "data": {"text": "..."}}
```

| Channel | Content | Density |
|---------|---------|---------|
| `visual_index` | Screen descriptions from VLM | Dense (~1 every 2s) |
| `transcript` | Mic speech-to-text | Sparse (~sentences) |
| `audio_index` | System audio summaries | Sparse (~sentences) |
| `capture_session` | Lifecycle events (ignore for search) | Rare |

Session info with RTStream IDs is at `/tmp/videodb_pp_info.json`.

## Flow

### 1. Pre-flight

Check that a recording session exists:

```bash
cat /tmp/videodb_pp_info.json
```

If file doesn't exist or is empty, tell the user no recording session is available.

### 2. Classify the query and pick execution mode

Based on the user's question, pick strategy AND execution mode:

| Query type | Example | Strategy | Execution |
|------------|---------|----------|-----------|
| Recent context | "what's on my screen?" | Tail last N events | **Direct** — trivial, small output |
| Keyword / topic | "find the error" | Grep keyword | **Direct** — fast, small output |
| Cross-channel | "what was on screen when I said X?" | Two-step grep | **Direct** — sequential dependency |
| User intent | "what did I ask?" | Read last 5 min transcript | **Subagent** — reads events, returns intent summary |
| Time-bounded (> 5 min) | "what was I doing in the last 30 min?" | Time filter per channel | **Parallel subagents** — one per channel |
| Broad semantic | "when was I debugging performance?" | Local grep + remote search | **Parallel subagents** — local + remote simultaneously |
| Full context scan | "summarize everything about auth" | All channels + remote | **Parallel subagents** — one per channel + one remote |

### 3a. Direct execution (simple queries)

For recent context, keyword grep, and cross-channel correlation — run CLI commands directly. These are fast and produce small output.

**Filter by channel:**

```bash
grep '"channel":"transcript"' /tmp/videodb_pp_events.jsonl | tail -20
```

**Last N events of a specific channel:**

```bash
grep '"channel":"visual_index"' /tmp/videodb_pp_events.jsonl | tail -10
```

**Keyword search across all channels (excluding lifecycle events):**

```bash
grep -v '"channel":"capture_session"' /tmp/videodb_pp_events.jsonl | grep -i 'auth'
```

**Time-window filter (last N minutes):**

```bash
awk -v cutoff=$(($(date +%s) - 300)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl
```

Combine time filter with channel filter by piping:

```bash
awk -v cutoff=$(($(date +%s) - 300)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"transcript"'
```

**Cross-channel correlation:**

1. Find the event in one channel:
   ```bash
   grep '"channel":"transcript"' /tmp/videodb_pp_events.jsonl | grep -i 'broken'
   ```
2. Extract the `unix_ts` from the matching line(s).
3. Search the other channel within +/- 15 seconds of that timestamp:
   ```bash
   awk -v ts=TIMESTAMP -v window=15 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > (ts-window) && a[1] < (ts+window)' /tmp/videodb_pp_events.jsonl | grep '"channel":"visual_index"'
   ```

### 3b. Subagent execution (complex queries)

For queries that read a lot of events or need parallel search across channels, **spawn subagents using the Task tool**. Each subagent runs in its own context window, reads/filters events, and returns only a concise summary. This keeps the main conversation clean.

**When to use subagents:**
- The query touches multiple channels and you want results in parallel
- The time window is large (> 5 minutes) and will produce many events
- You need both local and remote search simultaneously
- The query asks for user intent (mic analysis) which requires reading + interpreting

**How to spawn search subagents:**

Launch subagents in the **same message** (parallel execution). Give each a focused task with the query and the CLI patterns to use.

**Example: full context scan for "auth discussion"**

Spawn 3 subagents in parallel:

1. **Screen search subagent:**
   > "Search /tmp/videodb_pp_events.jsonl for visual_index events related to 'auth'. Run: `grep '"channel":"visual_index"' /tmp/videodb_pp_events.jsonl | grep -i 'auth'`. Read the output. Return a summary of what was on screen related to auth, with timestamps."

2. **Mic search subagent:**
   > "Search /tmp/videodb_pp_events.jsonl for transcript events related to 'auth'. Run: `grep '"channel":"transcript"' /tmp/videodb_pp_events.jsonl | grep -i 'auth'`. Also read the last 5 minutes of all transcript events for broader context: `awk -v cutoff=$(($(date +%s) - 300)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"transcript"'`. Return a summary of what the user said about auth, with timestamps."

3. **Remote semantic search subagent:**
   > "Run semantic search for 'auth discussion' using: `node search-rtstream.js --query='auth discussion' --cwd=CWD_PATH`. Read the JSON output and return a summary of the top results with timestamps and relevance scores."

**Example: user intent query "what did I ask?"**

Spawn 1 subagent:

> "Read the last 5 minutes of mic transcript from /tmp/videodb_pp_events.jsonl. Run: `awk -v cutoff=$(($(date +%s) - 300)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"transcript"'`. Analyze the transcript and identify: what questions or requests the user made, their intent, and any specific asks. Return a structured summary."

**Example: time-bounded multi-channel ("last 30 minutes")**

Spawn 2-3 subagents in parallel (one per active channel):

1. **Screen subagent:**
   > "Read the last 30 minutes of visual_index events. Run: `awk -v cutoff=$(($(date +%s) - 1800)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"visual_index"'`. Screen events are dense — if output is large, sample every 5th line with `awk 'NR%5==0'`. Return a timeline of what was on screen."

2. **Mic subagent:**
   > "Read the last 30 minutes of transcript events. Run: `awk -v cutoff=$(($(date +%s) - 1800)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"transcript"'`. Return a summary of what the user said, with timestamps."

3. **System audio subagent (if active):**
   > "Read the last 30 minutes of audio_index events. Run: `awk -v cutoff=$(($(date +%s) - 1800)) 'match($0, /"unix_ts":([0-9.]+)/, a) && a[1] > cutoff' /tmp/videodb_pp_events.jsonl | grep '"channel":"audio_index"'`. Return a summary of system audio, with timestamps."

**Rules for subagent prompts:**
- Always include the exact CLI command(s) to run
- Always include the user's original search query for context
- Always ask the subagent to return a **summary with timestamps**, not raw output
- For screen events, tell the subagent to sample if output is large (> 50 lines)
- For remote search, include the `--cwd` path

### 4. Remote search details

For the remote semantic search subagent or direct remote search, use `search-rtstream.js` from the skill directory:

```bash
node search-rtstream.js --query="your search query" --cwd=$(pwd)
```

To search a specific RTStream (get IDs from `/tmp/videodb_pp_info.json`):

```bash
node search-rtstream.js --query="your query" --cwd=$(pwd) --rtstream=rts-xxx
```

Output is a JSON array of matches with `text`, `start`, `end`, `rtstream_name`, and `score`.

Use remote search when:
- Local grep returned no results but the query seems valid
- The query is semantically broad with no specific keyword to grep
- The user explicitly asks to search the full session history

### 5. Synthesize

Combine results from direct execution and/or subagent responses:
- Include timestamps for context
- Summarize findings, don't dump raw data
- If results come from multiple channels, organize by timeline
- Correlate findings across channels (e.g. "at 10:15 you were looking at auth.ts and said 'this needs fixing'")
- If no results found locally or remotely, say so clearly
