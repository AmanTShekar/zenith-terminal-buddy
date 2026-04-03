# Contributing to Terminal Buddy

First off, thank you for considering contributing to Terminal Buddy! It's people like you that make Terminal Buddy such a great tool.

## How Can I Contribute?

### Reporting Bugs
- **Check the Issues**: Before reporting, please search existing issues to see if the bug has already been reported.
- **Use the Template**: When you're ready, use the [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md) to provide as much detail as possible.

### Suggesting Enhancements
- **Start a Discussion**: If you have a big idea, feel free to open an issue or a discussion first to get feedback.
- **Explain the "Why"**: Describe the problem you're trying to solve and how the enhancement helps.

### Your First Code Contribution
1.  **Fork the repository**.
2.  **Clone your fork**: `git clone https://github.com/YOUR_USER/terminal-buddy.git`.
3.  **Install dependencies**: `npm install`.
4.  **Create a branch**: Use a descriptive name like `feat-new-mascot` or `fix-terminal-flicker`.
5.  **Make your changes**.
6.  **Run tests**: Always run `npm test` before submitting. PRs that break the build will not be merged.
7.  **Submit a Pull Request**: Use our [PR Template](.github/PULL_REQUEST_TEMPLATE.md) for faster review.

## Code Style & Standards
- **TypeScript**: We use TypeScript for everything. No plain JS please!
- **Modularity**: Keep the `PanelProvider.ts` clean by extracting logic into specific services (AI, core, utils).
- **Aesthetics**: UI changes should follow the "Premium & Vibrant" aesthetic of the extension.

## Data Privacy
Never commit API keys, personal logs, or sensitive environment variables. Terminal Buddy uses VS Code's `SecretStorage` for a reason!

## Community & Conduct
By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

Happy hacking! 🚀
