# WSL Screen Snipper

Seamlessly capture and manage Windows screenshots from within WSL and VS Code. This extension automatically detects new Windows screenshots and makes them instantly available in your WSL environment with intelligent clipboard integration.

## Features

- **🔄 Auto-Detection**: Monitors Windows Screenshots folder for new captures
- **📋 Smart Clipboard**: Copies WSL file paths directly to clipboard 
- **⚡ Fast Integration**: Terminal paste interceptor (Ctrl+Shift+V) for instant path insertion
- **🎯 Flexible Paths**: Configure custom Windows and WSL directories
- **🧹 Auto Cleanup**: Optional temp directory cleanup on VS Code close
- **📁 Git Integration**: Automatic .gitignore entries for temp directories

## How It Works

1. Take a screenshot on Windows (Win+Shift+S or any screenshot tool)
2. Extension automatically detects the new screenshot
3. Copies it to your WSL temp directory
4. WSL file path is copied to clipboard
5. Use Ctrl+Shift+V in terminal to paste the path directly

## Setup

### 1. Configure Windows Username
Set your Windows username in VS Code settings:
```
WSL Screen Snipper: Windows Username
```
This locates screenshots at `/mnt/c/Users/{username}/Pictures/Screenshots`

### 2. Configure Temp Directory (Optional)
- **Temp Folder Name**: Creates `.{name}` folder in workspace root (default: "Temp-Session-Snips")
- **Custom Temp Path**: Use absolute path for temp directory

## Commands

- **Save Clipboard Image**: Manually save the most recent screenshot
- **Revert to Default Settings**: Reset all extension settings

## Keybindings

- `Ctrl+Shift+V` (in terminal): Paste screenshot path instead of clipboard content

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `windowsUsername` | Windows username for Screenshots path | (empty) |
| `customWindowsPath` | Custom path to Windows Screenshots folder | (empty) |
| `tempFolderName` | Temp folder name in workspace root | "Temp-Session-Snips" |
| `customTempPath` | Custom absolute temp directory path | (empty) |
| `autoCleanup` | Remove temp directory on VS Code close | `true` |
| `addToGitignore` | Add temp folder to .gitignore | `false` |
| `pollingInterval` | Screenshot detection interval (ms) | `500` |

## Requirements

- Windows Subsystem for Linux (WSL)
- VS Code running in WSL environment
- Windows Screenshots folder accessible via `/mnt/c/`

## Installation

### From VS Code Extensions Marketplace
1. Install from VS Code Extensions marketplace
2. Configure your Windows username in settings
3. Start taking screenshots - they'll be automatically available in WSL!

### From Source (Development)
```bash
# Clone the repository
git clone https://github.com/OFurtun/WSL-Screen-Snipper.git
cd WSL-Screen-Snipper

# Install dependencies and compile
npm install
npm run compile

# Package the extension
npm install -g @vscode/vsce
vsce package

# Install the generated .vsix file
code --install-extension wsl-screen-snipper-1.0.0.vsix
```

## Troubleshooting

**Screenshots not detected?**
- Verify Windows username setting matches your actual Windows username
- Check that `/mnt/c/Users/{username}/Pictures/Screenshots` exists
- Try using Custom Windows Path if username-based detection fails

**Temp directory issues?**
- Ensure workspace is open when using Temp Folder Name
- Use Custom Temp Path for non-workspace scenarios
- Check file permissions in target directory

## License

MIT License - see LICENSE file for details.

## Contributing

Issues and pull requests welcome at: https://github.com/OFurtun/WSL-Screen-Snipper