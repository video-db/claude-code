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
  Give your AI coding agent eyes and ears — real-time screen vision, voice, and audio understanding.
  <br />
  <a href="https://docs.videodb.io"><strong>Explore the docs -></strong></a>
  <br />
  <br />
  <a href="https://github.com/video-db/claude-code/issues">Report Issues</a>
</p>

---

## Demo

https://github.com/user-attachments/assets/24f25eff-2af1-4048-9bbb-8d1d09559ebb

---

## Installation

### Marketplace

```bash
# Add the marketplace (one-time)
/plugin marketplace add video-db/claude-code

# Install the plugin
/plugin install pair-programmer@claude-code
```

### npx

```bash
npx skills add video-db/claude-code
```

### Setup

Set your VideoDB API key — get a free key at [console.videodb.io](https://console.videodb.io) (no credit card required).

```bash
export VIDEO_DB_API_KEY=your-key
```

Or add it to a `.env` file in your project root:

```
VIDEO_DB_API_KEY=your-key
```

Then run setup to install dependencies:

```bash
/pair-programmer setup
```

---

## Quick Start

Start recording your screen, mic, and system audio:

```
/pair-programmer record
```

A picker UI appears to select sources. Once recording starts, a widget overlay shows status, active channels, and elapsed time.

When you need context from your session, search it:

```
/pair-programmer search "what was I working on when I mentioned the auth bug?"
```

```
/pair-programmer search "what did I say in the last 5 minutes?"
```

```
/pair-programmer search "show me what was on screen when the test failed"
```

Summarize recent activity:

```
/pair-programmer what-happened
```

Stop recording when done:

```
/pair-programmer stop
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/pair-programmer record` | Start recording (opens source picker) |
| `/pair-programmer stop` | Stop the running recording |
| `/pair-programmer search` | Search recording context across screen, mic, and audio |
| `/pair-programmer what-happened` | Summarize recent activity |
| `/pair-programmer setup` | Install dependencies and configure API key |
| `/pair-programmer config` | Change indexing settings |

---

## Requirements

- **Node.js 18+**
- **macOS 12+** (Monterey or later)
- **VideoDB API Key** — [Sign up](https://console.videodb.io)

---

## Community & Support

- **Issues**: [GitHub Issues](https://github.com/video-db/claude-code/issues)
- **Docs**: [docs.videodb.io](https://docs.videodb.io)
- **Discord**: [Join community](https://discord.gg/py9P639jGz)

---

<p align="center">Made with ❤️ by the <a href="https://videodb.io">VideoDB</a> team</p>

---

<!-- MARKDOWN LINKS & IMAGES -->
[stars-shield]: https://img.shields.io/github/stars/video-db/claude-code.svg?style=for-the-badge
[stars-url]: https://github.com/video-db/claude-code/stargazers
[issues-shield]: https://img.shields.io/github/issues/video-db/claude-code.svg?style=for-the-badge
[issues-url]: https://github.com/video-db/claude-code/issues
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fvideodb.io%2F&style=for-the-badge&label=videodb.io
[website-url]: https://videodb.io/
