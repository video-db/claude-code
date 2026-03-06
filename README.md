<!-- PROJECT SHIELDS -->
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Website][website-shield]][website-url]

<p align="center">
  <a href="https://videodb.io/">
    <img src="https://codaio.imgix.net/docs/_s5lUnUCIU/blobs/bl-RgjcFrrJjj/d3cbc44f8584ecd42f2a97d981a144dce6a66d83ddd5864f723b7808c7d1dfbc25034f2f25e1b2188e78f78f37bcb79d3c34ca937cbb08ca8b3da1526c29da9a897ab38eb39d084fd715028b7cc60eb595c68ecfa6fa0bb125ec2b09da65664a4f172c2f" alt="VideoDB" width="300" />
  </a>
</p>

<h1 align="center">Pair Programmer</h1>

<p align="center">
  Turn your coding agent into a screen aware, voice aware, context rich collaborator.
  <br />
  Record your screen, microphone, and system audio in real time, then search what happened in natural language.
  <br />
    <br />
  Works with Claude Code, Cursor, Codex, and other skill compatible agents.
</p>

<p align="center">
  <a href="https://docs.videodb.io"><strong>Explore the docs</strong></a>
  ·
  <a href="https://github.com/video-db/pair-programmer/issues">Report an issue</a>
  ·
  <a href="https://discord.gg/py9P639jGz">Join Discord</a>
</p>

---

## What is Pair Programmer?

Pair Programmer is an **agentic skill** that gives your AI coding assistant real time perception.

It captures:

- **Screen** for visual context like terminals, editors, browser tabs, errors, and UI state
- **Microphone** for your spoken intent, ideas, and debugging notes
- **System audio** for tutorials, meetings, demos, and anything else your computer is playing

Once captured, that context becomes searchable.

So instead of re explaining what was on screen, copy pasting logs, or summarizing a 20 minute debugging session, you can ask:

- *What was I doing when the auth flow broke?*
- *What did I say about the database migration?*
- *Show me what was on screen when the test failed*
- *What happened in the last 10 minutes?*

This is the missing perception layer for coding agents.

---

## What's new in PP 2

PP 2 is a major upgrade.

- **Now an agentic skill**  
  Not limited to Claude Code anymore

- **Works across tools**  
  Use it with Claude Code, Cursor, Codex, and other compatible agent environments

- **Install with `npx`**  
  Faster setup, less friction

- **Cleaner UI**  
  Improved picker and recording widget for a smoother experience

---

## Demo

https://github.com/user-attachments/assets/24f25eff-2af1-4048-9bbb-8d1d09559ebb

---

## Install

If you have an older version installed, remove it first before upgrading.

### Option 1: Install with npx

```bash
npx skills add video-db/pair-programmer
```

### Option 2: Install from marketplace

```bash
/plugin marketplace add video-db/pair-programmer
/plugin install pair-programmer
```

---

## Setup

Get a free VideoDB API key from [console.videodb.io](https://console.videodb.io)  
No credit card required.

Set your API key:

```bash
export VIDEO_DB_API_KEY=your-key
```

Or add it to a `.env` file in your project root

Then run:

```bash
/pair-programmer setup
```


## Quick start

Start recording your screen, mic, and system audio:

```bash
/pair-programmer record
```

A source picker will open so you can choose what to capture.   Once recording starts, a lightweight overlay shows recording status, active channels, and elapsed time.

Search your session in natural language:

```bash
/pair-programmer search "what was I working on when I mentioned the auth bug?"
```

```bash
/pair-programmer search "what did I say in the last 5 minutes?"
```

```bash
/pair-programmer search "show me what was on screen when the test failed"
```

Get a summary of recent activity:

```bash
/pair-programmer what-happened
```

Stop recording when you're done:

```bash
/pair-programmer stop
```

---

## Why this is useful

Most coding agents can write code.

Very few can stay grounded in the same context as you.

Pair Programmer helps your agent stay on the same page by giving it access to what you saw, what you said, and what your machine was playing. That means less manual explanation, fewer broken handoffs, and a much more natural way to work.

Use it for:

- debugging sessions
- tutorial driven development
- bug reproduction
- meeting follow ups
- architecture walkthroughs
- voice first coding workflows

---

## Commands

| Command | Description |
|---------|-------------|
| `/pair-programmer record` | Start recording and open the source picker |
| `/pair-programmer stop` | Stop the active recording |
| `/pair-programmer search "<query>"` | Search screen, mic, and audio context using natural language |
| `/pair-programmer what-happened` | Summarize recent activity |
| `/pair-programmer setup` | Install dependencies and complete local setup |
| `/pair-programmer config` | Update indexing and recording settings |

---

## Requirements

- **Node.js 18+**
- **macOS 12+**  
  Windows support is currently in beta
- **VideoDB API key**  
  Get one at [console.videodb.io](https://console.videodb.io)

---

## Community and support

Pair Programmer is open source and designed to be adapted for your own workflows and agent use cases.

- **Issues:** [GitHub Issues](https://github.com/video-db/pair-programmer/issues)
- **Docs:** [docs.videodb.io](https://docs.videodb.io)
- **Discord:** [Join community](https://discord.gg/py9P639jGz)

---

## About VideoDB

VideoDB is the perception, memory, and action layer for AI agents working with video and audio.

Pair Programmer is one example of what becomes possible when agents can understand continuous media in real time.

Learn more at [videodb.io](https://videodb.io)
<p align="center">Made with ❤️ by the <a href="https://videodb.io">VideoDB</a> team</p>

---

<!-- MARKDOWN LINKS & IMAGES -->
[stars-shield]: https://img.shields.io/github/stars/video-db/claude-code.svg?style=for-the-badge
[stars-url]: https://github.com/video-db/claude-code/stargazers
[issues-shield]: https://img.shields.io/github/issues/video-db/claude-code.svg?style=for-the-badge
[issues-url]: https://github.com/video-db/claude-code/issues
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fvideodb.io%2F&style=for-the-badge&label=videodb.io
[website-url]: https://videodb.io/
