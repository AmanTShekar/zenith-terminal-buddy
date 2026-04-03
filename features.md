# 🐱 Terminal Buddy: Feature Details

Terminal Buddy provides an interactive companion for the VS Code terminal that detects errors and offers contextual AI assistance. Here is a comprehensive overview of its features:

## 1. 🛡️ Security Audit
- **Interactive Check**: Every command executed can undergo a security check before running.
- **Risk Assessment**: The AI engine evaluates the *intent* of the command rather than just pattern-matching strings, effectively warning you of dangerous pipe sequences (like `curl | bash`) and system-level changes such as recursive deletions (`rm -rf`).

## 2. 🪄 Magic CLI Prompt
- **Natural Language to CLI**: Convert natural language queries into accurate, runnable CLI commands directly inside VS Code.
- **Context Injection**: Uses your active project type, top-level workspace files, and active directory to produce highly specific commands natively applicable to your current environment.

## 3. 🌳 Human-Readable Git Tree
- **Visualized Changes**: Projects git modifications directly in the sidebar as a structured, color-coded file tree.
- **Improved Tracking**: Helps track modifications across large repositories without the need to continually run `git status`. Gives warnings for pushing directly to `main` and detects merge conflicts.

## 4. 🐱 Interactive Buddy & Gutter Pet
- **Webview Companion**: An interactive, animated companion (choose from a Cat, Dog, Robot, or Ghost) that responds natively to terminal activity.
- **Gutter Decorations**: Real-time visual markers appear right next to the lines in your terminal gutter (e.g., 🐾, 🐱, 😿) to indicate command success, failure, or danger warnings.
- **Progression System**: Gain XP and level up your companion through successful command execution and active debugging.

## 5. 🧠 Intelligent Model Management
- **Dynamic Model Discovery**: Automatically queries and updates available models for each AI provider, automatically supporting newer account tiers (like Gemini 3.1).
- **On-the-Fly Switching**: Easily switch between underlying AI systems or model sizes without reloading the VS Code window via the UI's gear icon.
- **Multi-Provider Support**: Easily plugs into Google Gemini, Groq (Llama), OpenAI GPT, and Anthropic Claude depending on your provided API keys.

## 6. 📋 Live Command Log & Semantic History
- **Command Tracking**: Keeps a real-time monitor of executed commands with status indicators, metadata tags (git, test, build), and timestamps.
- **Semantic Search**: Locate older terminal commands using natural language instead of requiring a perfect textual match in the command history.

## 7. 📦 Dependency Guardian
- **Automated Detection**: Flags missing dependencies and unresolved modules (`npm`, `pip`, etc.).
- **One-Click Resolvers**: Suggests quick commands to install the missing libraries and resolves the issue quickly.
