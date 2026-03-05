---
description: Set up VideoDB Pair Programmer — install dependencies and configure API key
---

Set up the VideoDB Pair Programmer.

## Steps

### 1. Install Dependencies

In the skill directory (the directory containing SKILL.md), install these npm packages:
- `electron`
- `videodb`
- `dotenv`

### 2. Configure API Key

The user must set `VIDEO_DB_API_KEY` either by:
- `export VIDEO_DB_API_KEY=your-key` in their shell, OR
- Adding `VIDEO_DB_API_KEY=your-key` to a `.env` file in their project root

Get a free API key at https://console.videodb.io (50 free uploads, no credit card).

**Do NOT** read, write, or handle the API key yourself. Always let the user set it.

### 3. Confirm

Tell the user:
- Setup is complete
- Run `/pair-programmer record` to start recording
