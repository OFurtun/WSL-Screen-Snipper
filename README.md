# WSL Screen Snipper

Seamlessly bridge Windows screenshots into your WSL VS Code workflow. Take a screenshot on Windows, and the file path is automatically copied to your clipboard — ready to Ctrl+V into the terminal.

## How It Works

1. Take a screenshot on Windows (Win+Shift+S, Print Screen, or any tool that saves to the Screenshots folder)
2. Extension detects the new file and copies it to a local WSL temp directory
3. The WSL path is written to your clipboard
4. A notification confirms it's ready — Ctrl+V to paste the path

## Features

- **Auto-detection** — monitors the Windows Screenshots folder using both `fs.watch` and lightweight polling (single `readdir`, no per-file `stat` calls)
- **Clipboard integration** — WSL file path is placed in your clipboard via `vscode.env.clipboard.writeText`
- **Live settings** — configuration changes apply immediately, no reload required
- **Smart cleanup** — on VS Code exit, only screenshots older than today are removed; today's files are kept
- **Git-friendly** — optional `.gitignore` entry for the temp directory

## Installation

```bash
git clone https://github.com/OFurtun/WSL-Screen-Snipper.git
cd WSL-Screen-Snipper
npm install
npm run install-ext
```

Then reload the VS Code window.

### Update

```bash
npm run install-ext
```

### Uninstall

```bash
npm run uninstall-ext
```

## Setup

Set your Windows username in VS Code settings:

```
WSL Screen Snipper > Windows Username
```

This locates screenshots at `/mnt/c/Users/{username}/Pictures/Screenshots`. Alternatively, use **Custom Windows Path** to point to any directory.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `windowsUsername` | Windows username for Screenshots path | *(empty)* |
| `customWindowsPath` | Custom path to Windows Screenshots folder | *(empty)* |
| `tempFolderName` | Temp folder name (creates `.{name}` in workspace root) | `Temp-Session-Snips` |
| `customTempPath` | Custom absolute temp directory path | *(empty)* |
| `autoCleanup` | Remove old screenshots (not today's) on VS Code exit | `true` |
| `addToGitignore` | Add temp folder to `.gitignore` | `false` |
| `pollingInterval` | Screenshot detection interval in ms (100–5000) | `500` |

All settings take effect immediately — no reload needed.

## Commands

- **Save Clipboard Image** — manually grab the most recent screenshot
- **WSL Screen Snipper: Revert to Default Settings** — reset all settings

## Troubleshooting

**Screenshots not detected?**
- Verify your Windows username setting matches your actual Windows username
- Check that `/mnt/c/Users/{username}/Pictures/Screenshots` exists
- Try using Custom Windows Path if the default path doesn't work

**Temp directory not created?**
- Ensure a workspace folder is open when using Temp Folder Name
- Use Custom Temp Path for non-workspace scenarios

**Clipboard takes a few seconds?**
- This is an inherent WSL2-to-Windows interop cost (~5s). The notification only appears after the clipboard is populated, so when you see it, Ctrl+V is ready.

## Requirements

- Windows Subsystem for Linux 2 (WSL2)
- VS Code with Remote - WSL extension
- Windows Screenshots folder accessible via `/mnt/c/`
- `vsce` (`npm install -g @vscode/vsce`) for packaging

## License

MIT License — see LICENSE file for details.
