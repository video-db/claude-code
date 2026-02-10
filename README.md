# VideoDB — Claude Code Plugin Marketplace

A plugin marketplace for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) powered by [VideoDB](https://videodb.io).

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
| [pair-programmer](./plugins/pair-programmer/) | AI pair programmer with real-time screen and audio context |

### Install a plugin

```bash
/plugin install pair-programmer@videodb
```

## Updating

```bash
# Pull latest marketplace changes
/plugin marketplace update

# Reinstall a plugin to get latest code
/plugin install pair-programmer@videodb
```

## Local Development

To load a plugin directly from disk (skips cache, changes take effect immediately):

```bash
claude --plugin-dir ~/videodb/claude-code/plugins/pair-programmer
```

## License

MIT
