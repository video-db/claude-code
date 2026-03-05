---
description: Change VideoDB Pair Programmer settings (indexing, backend URL, etc.)
---

Change VideoDB Pair Programmer settings.

## Steps

### 1. Check Current Configuration

Read the config file at `pp.config.json` in the user's current working directory (project root) using the file read tool.

**Decision:**

- **File doesn't exist** → Create it with defaults (see schema below) and continue to **Step 3**
- **File exists** → User may want to change something. Read up instructions at **Configuration Schema**
- **File exists and user has nothing to change** → Go to **Step 3**

### 2. Save Configuration

Create or update `pp.config.json` in the user's current working directory (project root). Use defaults for any fields not explicitly changed (see schema below).

### 3. Confirm

Say settings have been saved.

---

## Configuration Schema

**When the user wants to change settings**, offer a single choice:

1. **"Go through each setting"** — For users who want to see every option and possibly change several. Ask one setting at a time: state what the option does and its current/default value, then ask for a new value or "keep current". Move to the next only after they answer. For indexing, go into **VideoDB Indexing Configuration** and walk through visual → system_audio → mic (and their sub-fields) in order.

2. **"Change a specific setting"** — Use the organised MCQ hierarchy below. After each change, return to the same level (top-level MCQ, or indexing sub-MCQ, or the chosen index's sub-field list) so the user can change another or go back.

---

### MCQ hierarchy (keep it organised)

**Always show all options** in every MCQ — list every option below; do not omit, collapse, or limit the number of choices.

**Level 1 — Top-level settings**

Show one MCQ: "Which setting would you like to change?" with **all** of these options (each with short description and current value in parentheses):

1. **`videodb_backend_url`** — API endpoint. (current: e.g. `https://api.videodb.io`)
2. **VideoDB Indexing Configuration** — Screen, system audio, and mic indexing (prompts, batching). → goes to Level 2
3. **Done** — Finish and save.

If they pick 1: show what it does, current value, ask for new value or "keep current". Then show **Level 1 MCQ again** with all 3 options.

If they pick 2: go to **Level 2**. If they pick 3: save config and confirm.

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

Location: `<project_root>/pp.config.json`

```json
{
  "videodb_backend_url": "https://api.videodb.io",
  "visual_index": { "enabled": true, "prompt": "Describe what is visible on the screen, focusing on the main application, content being viewed, and any notable UI elements.", "batch_time": 2, "frame_count": 3, "model_name": "mini" },
  "system_audio_index": { "enabled": true, "prompt": "Summarize what is being said in the audio.", "batch_type": "sentence", "batch_value": 3, "model_name": "mini" },
  "mic_index": { "enabled": true, "prompt": "Transcribe the user's speech.", "batch_type": "sentence", "batch_value": 3, "model_name": "mini" }
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `videodb_backend_url` | API endpoint | https://api.videodb.io |

**Indexing sub-fields (for Level 3 MCQ):**

| Parent | Field | Description | Default |
|--------|-------|-------------|---------|
| visual_index | enabled | On/off for screen indexing | true |
| visual_index | prompt | AI prompt for screen content | "Describe what is visible on the screen, focusing on the main application, content being viewed, and any notable UI elements." |
| visual_index | batch_time | Seconds between screen captures | 2 |
| visual_index | frame_count | Frames per batch | 3 |
| visual_index | model_name | AI model to use | mini |
| system_audio_index | enabled | On/off for system audio | true |
| system_audio_index | prompt | AI prompt for system audio | "Summarize what is being said in the audio." |
| system_audio_index | batch_type | "sentence" or "time" | sentence |
| system_audio_index | batch_value | Sentences or seconds per batch | 3 |
| system_audio_index | model_name | AI model to use | mini |
| mic_index | enabled | On/off for mic | true |
| mic_index | prompt | AI prompt for mic | "Transcribe the user's speech." |
| mic_index | batch_type | "sentence" or "time" | sentence |
| mic_index | batch_value | Sentences or seconds per batch | 3 |
| mic_index | model_name | AI model to use | mini |

Indexing can also be overridden at runtime via `/pair-programmer:record`.
