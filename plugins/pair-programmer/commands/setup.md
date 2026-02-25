---
description: Set up VideoDB Pair Programmer — API key, dependencies, and configuration
---

Set up the VideoDB Pair Programmer (first-time or re-setup).

## Steps

### 1. Check Current Configuration

Read the config file at `~/.config/videodb/config.json` using the file read tool.

**Decision:**

- **File doesn't exist, or exists with `setup: false` or no `videodb_api_key`** → Continue to **STEP 2()**
- **File exists with `setup: true` and has API key** → User may want to change something. Readup Instructions at **Configuration Schema()** 
- **File exists with `setup: true` and user has nothing to change** → Go to **Step 4()**

### 2. Collect API Key (initial setup)

**IMPORTANT: Ask directly in chat, NOT via multiple-choice questions.**

Wait for the user's response. Never echo or log the full key; mask as `sk-***xyz`.

### 3. Save Configuration

Create or update `~/.config/videodb/config.json`: set `setup: true`, set `videodb_api_key` to the provided key, use defaults for other fields (see schema below). Create the directory `~/.config/videodb/` if it doesn't exist.

**After writing the file, set permissions to 600** (owner read/write only — it contains the API key):
```bash
chmod 600 ~/.config/videodb/config.json
```

### 4. Install Dependencies

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-recorder.sh"
```

### 5. Confirm

Say setup is complete. Tell the user to restart their Claude session so the pair programmer starts automatically.

---

## Configuration Schema

**When the user wants to change settings** (config exists, `setup: true`), offer a single choice:

1. **"Go through each setting"** — For users who want to see every option and possibly change several. Ask one setting at a time: state what the option does and its current/default value, then ask for a new value or "keep current". Move to the next only after they answer. Mask the API key when showing current value. For indexing, go into **VideoDB Indexing Configuration** and walk through visual → system_audio → mic (and their sub-fields) in order.

2. **"Change a specific setting"** — Use the organised MCQ hierarchy below. After each change, return to the same level (top-level MCQ, or indexing sub-MCQ, or the chosen index's sub-field list) so the user can change another or go back.

---

### MCQ hierarchy (keep it organised)

**Always show all options** in every MCQ — list every option below; do not omit, collapse, or limit the number of choices.

**Level 1 — Top-level settings**

Show one MCQ: "Which setting would you like to change?" with **all** of these options (each with short description and current value in parentheses; mask API key):

1. **`videodb_api_key`** — Your VideoDB API key for authentication. (current: e.g. `sk-***xyz`)
2. **`videodb_backend_url`** — API endpoint. (current: e.g. `https://api.videodb.io`)
3. **`recorder_port`** — HTTP API port for recorder. (current: e.g. `8899`)
4. **`context_buffer_size`** — Max context items kept. (current: e.g. `50`)
5. **`assistant_shortcut`** — Global shortcut for assistant. (current: e.g. `CommandOrControl+Shift+A`)
6. **VideoDB Indexing Configuration** — Screen, system audio, and mic indexing (prompts, batching). → goes to Level 2
7. **Done** — Finish and save (then go to Step 4).

If they pick 1–5: show what it does, current value (mask if secret), ask for new value or "keep current". Then show **Level 1 MCQ again** with all 7 options.

If they pick 6: go to **Level 2**. If they pick 7: save config and proceed.

---

**Level 2 — VideoDB Indexing Configuration**

Show one MCQ: "Which indexing would you like to change?" with **all** of:

1. **Visual index** (`visual_index`) — Screen / display indexing. → goes to Level 3 (Visual)
2. **System audio index** (`system_audio_index`) — System audio indexing. → goes to Level 3 (System audio)
3. **Mic index** (`mic_index`) — Microphone indexing. → goes to Level 3 (Mic)
4. **Back to main settings** → show Level 1 MCQ again.

If they pick 1: go to **Level 3 — Visual index**. If 2: **Level 3 — System audio index**. If 3: **Level 3 — Mic index**. If 4: Level 1 (show all Level 1 options again).

---

**Level 3 — Index sub-fields (one menu per index type)**

**Visual index** — "Which visual_index setting?" Show **all** options: `enabled` (on/off), `prompt` (AI prompt for screen), `batch_time` (seconds between captures), `frame_count` (frames per batch). For the chosen one: show what it does, current value, ask for new value or "keep current". Then show this same Level 3 (Visual) MCQ again, plus option "Back to Indexing" → Level 2.

**System audio index** — "Which system_audio_index setting?" Show **all** options: `enabled`, `prompt`, `batch_type` (sentence | time), `batch_value` (number). Same flow: show description + current → get new value → show this MCQ again + "Back to Indexing" → Level 2.

**Mic index** — "Which mic_index setting?" Show **all** options: `enabled`, `prompt`, `batch_type`, `batch_value`. Same flow: show description + current → get new value → show this MCQ again + "Back to Indexing" → Level 2.

---

Use the schema below for field names, descriptions, and defaults when explaining or writing the file.

Location: `~/.config/videodb/config.json`

```json
{
  "setup": true,
  "videodb_api_key": "sk-xxx",
  "videodb_backend_url": "https://api.videodb.io",
  "recorder_port": 8899,
  "context_buffer_size": 50,
  "context_buffer_size_screen": 50,
  "context_buffer_size_mic": 50,
  "context_buffer_size_system_audio": 50,
  "assistant_shortcut": "CommandOrControl+Shift+A",
  "visual_index": { "enabled": true, "prompt": "Describe what is visible on the screen...", "batch_time": 2, "frame_count": 3 },
  "system_audio_index": { "enabled": true, "prompt": "Summarize what is being said...", "batch_type": "sentence", "batch_value": 3 },
  "mic_index": { "enabled": true, "prompt": "Transcribe the user's speech...", "batch_type": "sentence", "batch_value": 3 }
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `videodb_api_key` | VideoDB API key (required). Mask in UI. | — |
| `videodb_backend_url` | API endpoint | https://api.videodb.io |
| `recorder_port` | Recorder HTTP API port | 8899 |
| `context_buffer_size` | Default max context items (used if per-type not set) | 50 |
| `context_buffer_size_screen` | Max screen context items (FIFO queue length) | value of `context_buffer_size` |
| `context_buffer_size_mic` | Max mic context items (FIFO queue length) | value of `context_buffer_size` |
| `context_buffer_size_system_audio` | Max system audio context items (FIFO queue length) | value of `context_buffer_size` |
| `assistant_shortcut` | Global shortcut for assistant | CommandOrControl+Shift+A |

**Indexing sub-fields (for Level 3 MCQ):**

| Parent | Field | Description | Default |
|--------|-------|-------------|---------|
| visual_index | enabled | On/off for screen indexing | true |
| visual_index | prompt | AI prompt for screen content | "Describe what is visible on the screen..." |
| visual_index | batch_time | Seconds between screen captures | 2 |
| visual_index | frame_count | Frames per batch | 3 |
| system_audio_index | enabled | On/off for system audio | true |
| system_audio_index | prompt | AI prompt for system audio | "Summarize what is being said..." |
| system_audio_index | batch_type | "sentence" or "time" | sentence |
| system_audio_index | batch_value | Sentences or seconds per batch | 3 |
| mic_index | enabled | On/off for mic | true |
| mic_index | prompt | AI prompt for mic | "Transcribe the user's speech..." |
| mic_index | batch_type | "sentence" or "time" | sentence |
| mic_index | batch_value | Sentences or seconds per batch | 3 |

Indexing can also be overridden at runtime via `/pair-programmer:record`.

Security: never expose the full API key; always mask (e.g. `sk-***xyz`).
