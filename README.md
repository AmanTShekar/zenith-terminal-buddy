# Terminal Buddy

> Your friendly terminal companion inside VS Code — explains errors, suggests commands, tracks history, helps with git, and has a pet. 🐱

## Features

- 📋 **Command Log** — Every terminal command tracked with status, tag, and timestamp
- 💡 **Smart Suggestions** — Ranked suggestions based on your project, errors, and git state
- 🔀 **Git Status** — Branch, uncommitted files, ahead/behind counts, conflict detection
- 🧠 **Error Explanation** — 21 built-in rules + optional AI explanations
- 🤖 **BYOK AI** — Bring your own key for Gemini, OpenAI, Claude, or Groq
- 📦 **Dependency Detection** — Spots missing npm/pip packages and suggests the fix
- 🐱 **Pet Companion** — Emoji pet with mood, XP, and leveling system
- 🔍 **Search + Filter** — Filter log by status, tag; full-text search

## Getting Started

1. **Install** the extension
2. Open the **Terminal Buddy** tab in VS Code's bottom panel (next to Terminal)
3. Run commands in your terminal — they appear in the log automatically

## AI Setup (Optional)

Run the command: **Terminal Buddy: Set AI API Key**

Choose your provider:
| Provider | Cost | Get Key |
|----------|------|---------|
| Google Gemini | ✅ Free | [aistudio.google.com](https://aistudio.google.com) |
| OpenAI | 💳 Paid | [platform.openai.com](https://platform.openai.com) |
| Anthropic Claude | 💳 Paid | [console.anthropic.com](https://console.anthropic.com) |
| Groq | ✅ Free tier | [console.groq.com](https://console.groq.com) |

API keys are stored securely using VS Code's built-in Secret Storage — never in plain text.

## Commands

| Command | Description |
|---------|-------------|
| `Terminal Buddy: Open Panel` | Open the panel |
| `Terminal Buddy: Set AI API Key` | Configure your AI provider |
| `Terminal Buddy: Clear History` | Clear command history |
| `Terminal Buddy: Toggle Pet Mode` | Show/hide the pet |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `terminalBuddy.aiEnabled` | `false` | Enable AI explanations |
| `terminalBuddy.aiProvider` | `gemini` | AI provider (gemini/openai/claude/groq) |
| `terminalBuddy.petEnabled` | `true` | Show pet companion |
| `terminalBuddy.petType` | `cat` | Pet type (cat/dog/robot/ghost) |
| `terminalBuddy.petName` | `Buddy` | Pet name |
| `terminalBuddy.warnOnMainPush` | `true` | Warn before pushing to main |
| `terminalBuddy.maxHistoryItems` | `500` | Max command history |

## Shell Integration

Terminal Buddy uses VS Code's Shell Integration API for reliable command tracking. This is enabled by default in VS Code for bash, zsh, fish, and PowerShell. If terminal output isn't being captured, check that shell integration is enabled in your VS Code settings.

## Pet System

Your pet reacts to what you do:
- 😸 **Happy** — Command succeeded after a failure
- 😿 **Worried** — Three commands failed in a row
- 🙀 **Excited** — New workspace opened
- 😴 **Sleeping** — No activity for 10 minutes
- 🫣 **Scared** — You just ran `rm -rf`

Earn XP by fixing errors, following suggestions, and writing clean git commits. Level up to 5!

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Press F5 in VS Code to launch Extension Development Host
```

---

*Built with ❤️ for developers who want a friend in their terminal.*
