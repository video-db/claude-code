<!-- PROJECT SHIELDS -->
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Website][website-shield]][website-url]

<!-- PROJECT LOGO -->
<br />
<p align="center">
  <a href="https://videodb.io/">
    <img src="https://codaio.imgix.net/docs/_s5lUnUCIU/blobs/bl-RgjcFrrJjj/d3cbc44f8584ecd42f2a97d981a144dce6a66d83ddd5864f723b7808c7d1dfbc25034f2f25e1b2188e78f78f37bcb79d3c34ca937cbb08ca8b3da1526c29da9a897ab38eb39d084fd715028b7cc60eb595c68ecfa6fa0bb125ec2b09da65664a4f172c2f" alt="Logo" width="300" height="">
  </a>

  <h3 align="center">VideoDB — Claude Code Plugin Marketplace</h3>

  <p align="center">
    A plugin marketplace for Claude Code powered by VideoDB
    <br />
    <a href="https://docs.videodb.io"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="#available-plugins">View Plugins</a>
    ·
    <a href="https://github.com/video-db/claude-code/issues">Report Issues</a>
  </p>
</p>

---

## Installation

```bash
# Add the marketplace
/plugin marketplace add video-db/claude-code

# List available plugins
/plugin marketplace list videodb
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| [pair-programmer](./plugins/pair-programmer/README.md) | AI pair programmer with real-time screen and audio context |
| [videodb](./plugins/skills/videodb/README.md) | Process videos using VideoDB Python SDK — upload, search, edit, and capture |

### Install a plugin

```bash
/plugin install pair-programmer@videodb
/plugin install videodb@videodb
```

## Updating

```bash
# Pull latest marketplace changes
/plugin marketplace update

# Reinstall a plugin to get latest code
/plugin install pair-programmer@videodb
/plugin install videodb@videodb
```

## Local Development

To load a plugin directly from disk (skips cache, changes take effect immediately):

```bash
claude --plugin-dir ~/videodb/claude-code/plugins/pair-programmer
```

## Community & Support

- **Docs**: [docs.videodb.io](https://docs.videodb.io)
- **Issues**: [GitHub Issues](https://github.com/video-db/claude-code/issues)
- **Discord**: [Join community](https://discord.gg/py9P639jGz)
- **Console**: [Get API key](https://console.videodb.io)

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
