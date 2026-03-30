<div align="center">
 
  
  <h1>Terminal Buddy</h1>

  <img src="https://github.com/AmanTShekar/zenith-terminal-buddy/blob/main/logo%20terminal%20buddy.jpg" alt="Terminal Buddy Banner" width="80%" height="60%">
  
  <p><b>A Knowledgeable Companion for Your Terminal</b></p>

  <p>
    <img src="https://img.shields.io/badge/status-heavy%20development-orange?style=for-the-badge" alt="Status: Heavy Development">
    <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome">
  </p>

  <p>
    <i>Stop fighting with cryptic terminal errors. Get plain-English explanations, smart command suggestions, and a little mascot companion, all inside VS Code.</i>
  </p>
</div>

---

## 🚀 Why Terminal Buddy?

Terminal output is often cluttered with ANSI codes, jargon-heavy error messages, and context that’s hard to parse. For developers, this leads to **constant context switching**: you copy an error, paste it into a browser, search, and then come back to the IDE.

**Terminal Buddy was made to reduce that friction.** It acts as a bridge between the raw terminal and your development workflow, providing:
- **Instant Clarity**: Explains <i>why</i> a command failed without leaving VS Code.
- **Proactive Guidance**: Suggests the next logical step (e.g., missing dependencies, git branch fixes).
- **Reduced Anxiety**: Checks for dangerous operations (like `rm -rf`) and warns before they happen.
- **Engagement**: A fun, interactive pet mascot that grows as your terminal skills improve.

---

## ✨ Key Features

- 📋 **Live Command Log**: Track every command you run with status indicators, tags (git, test, build), and timestamps.
- 💡 **AI-Powered Explanations**: Integrates with **Gemini**, **Groq**, **OpenAI**, and **Claude** to explain complex failures.
- 📦 **Dependency Guardian**: Automatically detects missing packages (`npm`, `pip`, etc.) and offers one-click install suggestions.
- 🔀 **Git Intelligence**: Real-time branch monitoring, push warnings for `main`, and merge conflict detection.
- 🐱 **Interactive Mascot**: Choose a Cat, Dog, Robot, or Ghost companion. They celebrate your wins and worry with you when builds fail.
- 🔎 **Semantic History Search**: Find that one command you ran three days ago using natural language.

---

## 🛠️ Getting Started

1.  **Install** the extension from the VS Code Marketplace.
2.  Open the **Terminal Buddy** panel in the bottom activity bar (next to your Terminal).
3.  (Optional) Run `Terminal Buddy: Set AI API Key` to enable AI features.

### Supported AI Providers
| Provider | Setup | Cost |
|----------|-------|------|
| **Google Gemini** | [aistudio.google.com](https://aistudio.google.com) | ✅ Free |
| **Groq (Llama)** | [console.groq.com](https://console.groq.com) | ✅ Free Tier |
| **Anthropic Claude**| [console.anthropic.com](https://console.anthropic.com) | 💳 Paid |
| **OpenAI GPT** | [platform.openai.com](https://platform.openai.com) | 💳 Paid |

---

## 🔒 Security, Privacy & Liability

> [!IMPORTANT]
> **Data Handling & API Usage**  
> Terminal Buddy is an Open Source project provided **"AS IS"**. By using this software, you acknowledge and agree to the following:
> 1.  **Direct Communication**: When AI features are enabled, Terminal Buddy sends the **last few lines of terminal output** and the **failed command** to the AI provider of your choice (via YOUR API keys).
> 2.  **No Intermediary**: Data is sent directly from your machine to the AI provider's API. We do not store, intercept, or mirror your terminal data on any external servers.
> 3.  **Third-Party Liability**: We are NOT responsible for how third-party AI providers (Google, OpenAI, Anthropic, etc.) handle your data. Please review their respective privacy policies.
> 4.  **No Warranty**: We accept NO liability for any data loss, security breaches, or system issues that may result from using this software or from the suggestions provided by the AI.

Always verify commands before executing them, especially those suggested by AI. Terminal Buddy is a *guide*, not a substitute for developer judgment.

---

## 🚧 Status: Heavy Development

This project is currently under **heavy development** to perfect its features and increase reliability. It is a lightweight companion that aims to be zero-config.

**We need your help!**  
- Want to add a feature?
- Found a bug in the rule engine?
- Want to create a new pet skin?

We encourage anyone to contribute and help make Terminal Buddy better. Check out our [Contributing Rules](CONTRIBUTING.md) to get started!

---

## 👤 Creator Space

Terminal Buddy is maintained by **[Zenith Team/Creator Name]** and the open-source community.

If you like this project, consider giving it a ⭐ on GitHub and sharing it with your team!

---

## ⚖️ License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  <i>Built for developers who just want a friend in their terminal. ❤️</i>
</p>
