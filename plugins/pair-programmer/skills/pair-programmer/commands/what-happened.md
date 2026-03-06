---
description: Summarize recent activity from the recording session
tools: Bash, Read
---

Summarize what the user has been doing recently based on recording context.

## Flow

### 1. Check recording is active

```bash
cat /tmp/videodb_pp_info.json
```

If the file doesn't exist or is empty, tell the user no recording session is available.

### 2. Read recent context from each channel

Read the last 10 minutes of events, filtered by channel. Mic and system audio are sparse and safe to read broadly. Screen is dense — limit to the last 15 lines.

**Screen (last 15 visual events):**

```bash
grep '"channel":"visual_index"' /tmp/videodb_pp_events.jsonl | tail -15
```

**Mic transcript (last 10 minutes):**

Filter `/tmp/videodb_pp_events.jsonl` for lines where `unix_ts` > `(current_epoch - 600)` and channel is `"transcript"`. Get current epoch with `$(date +%s)`. Use grep for channel filtering; for time filtering, generate the appropriate command (grep, awk, python3, jq).

**System audio (last 10 minutes):**

Same time filter as above, but with channel `"audio_index"`.

### 3. Analyze and provide

From the collected events, synthesize:

- **Timeline** — what happened in order, using `ts` timestamps
- **Key actions** — important things the user did (files opened, code written, commands run)
- **Current state** — what's on screen right now (from the most recent visual events)
- **Notable items** — errors, decisions, important details from any channel

### 4. Keep it concise

Present a brief, actionable summary. Don't dump raw events. Organize by timeline and highlight what matters.
