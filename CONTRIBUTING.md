# Contributing to Terminal Buddy

First off, thank you for considering contributing to Terminal Buddy! It’s people like you who make the open-source community an amazing place to learn, inspire, and create.

### ⚠️ Current Project Status
Terminal Buddy is currently in **active development (v0)**. We are focusing on stabilizing core features, improving AI accuracy, and refining the pet mascot system. Anyone is welcome to add features, suggest improvements, or report bugs.

---

## How Can I Contribute?

### Reporting Bugs
- Use the [GitHub Issue Tracker](TODO_ADD_LINK) to report bugs.
- Include as much detail as possible: steps to reproduce, VS Code version, OS, and any relevant logs from the Terminal Buddy panel.

### Suggesting Enhancements
- If you have an idea for a new feature, a better rule for the engine, or a new pet companion, open an enhancement request in the Issue Tracker.

### Pull Requests
1.  **Fork the repo** and create your branch from `main`.
2.  **Install dependencies** (`npm install`).
3.  If you've added code that should be tested, add tests.
4.  If you've changed APIs, update the documentation.
5.  Ensure the build passes (`npm run build`).
6.  Open a Pull Request with a clear description of your changes.

---

## Development Setup

Terminal Buddy is built with TypeScript and esbuild.

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/terminal-buddy.git
cd terminal-buddy

# Install dependencies
npm install

# Build the extension
npm run build

# Start watch mode
npm run watch
```

To test the extension:
1.  Open the project in VS Code.
2.  Press `F5` to open the **Extension Development Host**.
3.  Open the Terminal Buddy sidebar to see your changes in action.

---

## Code Style
- Use TypeScript for all logic.
- Follow the project's layout (src/core, src/ai, src/panel, etc.).
- Keep components small and focused.
- Ensure every user-facing string is clear, friendly, and jargon-free.

## Disclaimers & Data
By contributing to this project, you agree that your contributions will be licensed under the project's [MIT License](LICENSE). Please do not include any sensitive data in your PRs or issues.

Happy coding! 🐱🤖🐶👻
