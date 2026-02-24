---
description: Update the pair-programmer plugin to the latest version
---

Run the following command to update the plugin from the marketplace:

```bash
claude plugin update pair-programmer@videodb
```

After the update completes, restart the recorder:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/update-recorder.sh"
```

The update script will:
1. Stop the recorder if running
2. Install/update npm dependencies
3. Restart the recorder automatically if config is ready

If the restart fails, check `/tmp/videodb-recorder.log` for errors.
