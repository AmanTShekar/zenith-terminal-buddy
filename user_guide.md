# Terminal Buddy User Guide (v1.0.0) 🐱🚀

Welcome to the **Power User Edition** of Terminal Buddy! This guide explains how to install the extension manually and unlock its advanced terminal monitoring features.

## 📦 Manual Installation (VSIX)
Since Terminal Buddy is currently in private release, you can install it directly from the `.vsix` file:

1.  Open **VS Code**.
2.  Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS) to open the Command Palette.
3.  Type **"Extensions: Install from VSIX..."** and select it.
4.  Navigate to your Terminal Buddy folder and select the **`terminal-buddy-0.0.4.vsix`** file.
5.  Wait for the "Installation complete" notification.
6.  **Restart VS Code** (or reload the window).

## ⚡ Unlocking Power User Features
Version 0.0.4 includes experimental terminal monitoring (raw data capture). Due to VS Code security rules, these features require a special "authorization flag" to run.

### How to Launch with the Power Flag:
1.  **Close all VS Code windows.**
2.  Open your **Command Prompt** (cmd) or **PowerShell**.
3.  Run the following command:
    ```bash
    code --enable-proposed-api Zenithdev.zenith-terminal-buddy
    ```

### What You Get in Power Mode:
- **Raw Stream Capture**: Buddy can see terminal data even when "Shell Integration" isn't fully active.
- **Deeper Command Context**: More accurate AI explanations based on the exact text on the screen.

## 🛠️ Main Features (Stable)
Even without the special flag, these features are always active:
- **AI Chat/Sidebar**: Talk to Buddy about your terminal logs.
- **Log Filtering**: Filter command history by status, terminal name, or project folder.
- **Pet Companion**: A Leveling pet that reacts to your productivity.
- **Port Manager**: Monitor and "Kill" dev servers directly from the UI.
- **Git Status**: Real-time branch and status monitoring.

## 🧹 Maintenance & Cleanup
If Buddy ever stays "Frozen" or fails to load:
- Use the command **"Terminal Buddy: Clear History"** from the Command Palette.
- Uninstall the extension, delete the `terminal-buddy-0.0.4.vsix`, and re-install a fresh copy.
