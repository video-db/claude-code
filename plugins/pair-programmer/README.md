<h1 align="center">Claude Pair Programmer</h1>

<p align="center">
  Give Claude Code eyes and ears — perception for real-time screen vision, voice, and audio understanding.
</p>

---

## Demo

https://github.com/user-attachments/assets/24f25eff-2af1-4048-9bbb-8d1d09559ebb

---

## 🔌 Installation

```bash
# Add VideoDB marketplace (one-time)
/plugin marketplace add video-db/claude-code-plugins

# Install Pair Programmer
/plugin install pair-programmer@videodb

# Configure with your VideoDB API key
/pair-programmer:record-config
```

**Control from MacOS Tray Menu** (System Tray Icon) after installation.

---

## Why Build This?

**The Problem**: Traditional AI coding assistants are context-blind. When you code with Claude Code, you're constantly copy-pasting screenshots, describing what's on screen, and repeating yourself. Context switching breaks your flow.

**The Solution**: Pair Programmer gives Claude Code perception — eyes to see your screen, ears to hear your voice and system audio, and memory to track context automatically.

Like a programmer sitting next to you who sees your terminal errors, hears your questions, and remembers recent context without you repeating anything.

---

## What Is This?

A perception layer for Claude Code that streams your screen, microphone, and system audio to VideoDB's capture SDK, runs real-time AI indexing, and feeds context directly into Claude Code.

### Core Capabilities

- **👁️ Screen Vision**: Real-time visual indexing with AI-generated scene descriptions. Semantic search across screen history.
- **👂 Voice Hearing**: Live microphone transcription with intent classification (question, command, thinking aloud).
- **🔊 Audio Awareness**: System audio capture (meetings, tutorials) with source classification and summarization.
- **🧠 Context Continuity**: FIFO buffers keep last N items in memory. Claude remembers recent context automatically.

---

## How It Works

1. **Start recording** via `/pair-programmer:record` — continuously captures screen, mic, and system audio in the background
2. **Context buffers** fill up automatically as you work (last 50 items by default)
3. **Trigger AI analysis** anytime via keyboard shortcut (`Cmd+Shift+A` by default) or `/pair-programmer:cortex`
4. **Multi-agent system** analyzes buffered context:
   - **cortex** — Orchestrator that correlates reports and synthesizes answers
   - **code-eye** — Reads visual screen context (files, errors, activities)
   - **voice** — Classifies speech intent and extracts keywords
   - **hearing** — Classifies system audio source
   - **narrator** — Shows status and responses in overlay
5. **Answer appears** in always-on-top overlay window with analysis and suggestions

No copy-pasting. No context switching. Just keep working and ask when you need help.

---

## Features

**Recording & Streaming**
- Real-time screen, mic, and system audio capture via VideoDB SDK
- Multi-channel streaming with AI visual indexing, transcription, and audio summarization
- FIFO context buffers (default 50 items each)

**Multi-Agent System**
- Parallel sense agents report independently to orchestrator
- Adaptive reading strategies based on context size
- Semantic search across rtstream history

**Control Interfaces**
- **MacOS Tray Menu**: Start/stop recording, show/hide overlay
- **CLI Commands**: Slash commands for config, status, search
- **Keyboard shortcut**: Configurable trigger for AI analysis (default `Cmd+Shift+A`)
- **Overlay Window**: Always-on-top responses and loading states

**Session Features**
- Cloudflare tunnel for webhook delivery
- Exported video saved to your VideoDB account

---

## Commands

| Command | Description |
|---------|-------------|
| `/pair-programmer:record` | Start or stop recording (opens source picker on first start) |
| `/pair-programmer:record-config` | Configure API key, buffer sizes, prompts, keyboard shortcut |
| `/pair-programmer:record-status` | Check recording state, rtstream IDs, buffer sizes |
| `/pair-programmer:refresh-context` | Fetch current screen/mic/system_audio context |
| `/pair-programmer:what-happened` | Summarize recent activity with timeline |
| `/pair-programmer:cortex` | Trigger AI analysis of buffered context |

---

## Example Usage

**Recording is active**, you're working on a migration that's failing. You verbally explain: "Why is this migration failing?"

Trigger AI: Press keyboard shortcut (or run `/pair-programmer:cortex`) → Overlay shows "👀 Reading your screen & listening in..." → Agents analyze: terminal error + migration file + your speech → Overlay responds with diagnosis and fix suggestion.

Continue the conversation in the overlay or through Claude Code. Context from previous interactions is remembered.

---

## Configuration

Access via `/pair-programmer:record-config`. Key settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `videodb_api_key` | — | [Get your API key](https://console.videodb.io) |
| `context_buffer_size_*` | `50` | Max entries per buffer (screen/mic/audio) |
| `assistant_shortcut` | `CommandOrControl+Shift+A` | Global keyboard shortcut |
| `visual_index.enabled` | `true` | Enable screen indexing |
| `mic_index.enabled` | `true` | Enable microphone transcription |
| `system_audio_index.enabled` | `true` | Enable system audio indexing |

---

## Requirements

- **macOS 12+** (Monterey or later)
- **Node.js 18+**
- **Claude Code CLI** — [Install guide](https://docs.anthropic.com/en/docs/claude-code)
- **VideoDB API Key** — [Sign up](https://console.videodb.io)

**macOS Permissions** (System Settings > Privacy & Security):
- ✅ Microphone Access
- ✅ Screen Recording
- ✅ System Audio Recording
- ✅ Accessibility (optional, for overlay always-on-top)

---

## MacOS Tray Integration

After installation, a tray icon appears in your menu bar with options:
- Start/Stop Recording
- Show/Hide Overlay
- Open Config
- Quit

**Tip**: If the overlay blocks your work, hide it via tray menu. Recording continues in background. Use the keyboard shortcut or slash command to trigger analysis anytime.

---

## Community & Support

- **Plugin Issues**: [Claude Code Repository](https://github.com/video-db/claude-code-plugins/issues)
- **VideoDB SDK Issues**: [VideoDB Capture Quickstart](https://github.com/video-db/videodb-capture-quickstart/issues)
- **Documentation**: [docs.videodb.io](https://docs.videodb.io)
- **Discord**: [Join community](https://discord.gg/py9P639jGz)

---

<p align="center">Made with ❤️ by the <a href="https://videodb.io">VideoDB</a> team</p>
