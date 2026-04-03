# 🐱 Terminal Buddy: Intelligence & UX Documentation

Terminal Buddy is an advanced, context-aware AI terminal assistant for VS Code. It transforms the command-line experience from a raw stream of characters into an interactive, secure, and intelligent workspace companion.

---

## 🛠️ Project Scope & Mission
To bridge the gap between AI code generation and CLI execution. Terminal Buddy doesn't just suggest commands; it understands terminal errors, audits security risks, masks sensitive data, and provides an interactive companion to guide the developer.

---

## 🏗️ Technical Architecture

### 🚀 Technology Stack
*   **Editor Layer**: VS Code Extension API (TypeScript)
*   **UI Layer**: Custom Webview Panels with Glassmorphic CSS & Vanilla JS
*   **AI Engine**: Multi-provider support (Gemini, OpenAI, Groq) with **Dynamic Model Discovery**
*   **Shell Integration**: Hooks into VS Code's `TerminalShellIntegration` for reliable command/error capture
*   **Gutter UI**: Modern `TerminalDecorationProvider` implementation for real-time visual feedback
*   **Build System**: Esbuild for high-speed compilation

### 🧩 Core Components

#### 1. Intelligence Layer (`src/ai`)
- **`AIClient.ts`**: Handles stateful conversation history, token-saving summarization (triggering every 6 messages), and real-time streaming output.
- **`prompts.ts`**: A centralized library of system prompts for security audits, error diagnostics, and command generation.

#### 2. Terminal Observability (`src/core`)
- **`TerminalWatcher.ts`**: The heartbeat of the extension. It captures every command execution, filters noise, and detects exit codes using shell integration.
- **`RuleEngine.ts`**: A regex-powered lookup system that instantly matches common terminal errors to pre-defined human solutions.
- **`GitHelper.ts`**: Provides deep repository observability, including a recursive, color-coded file tree of uncommitted changes.

#### 3. Security & Privacy (`src/core`)
- **`SafetyEngine.ts`**: intercepts commands before execution to flag destructive operations (e.g., recursive deletions or "force" commands) with AI-powered risk explanations.
- **`SecretStorage`**: Credentials (API tokens) are handled exclusively via the OS-level keychain securely, bypassing plain-text disk storage.
- **`RedactionUtils.ts`**: Automatically masks API keys, secrets (Stripe, AWS, GitHub), and high-entropy strings from logs using a robust set of regular expressions.
- **CSP Isolation**: Strict Webview Content Security Policy locks down network access to verified AI providers only.

#### 4. Project Mapping (`src/core`)
- **`ProjectScanner.ts`**: Recursively maps the workspace to detect project types (React, Python, C++, Rust, etc.), identifies runnable scripts, detects Python virtual environments (`venv`), and finds entry points.

---

## ✨ Key Features (v4/v5)

### 🛡️ Security Audit
- **Interactive Check**: Every command run from the UI undergoes a security check.
- **Risk Assessment**: AI evaluates the *intent* of the command, not just the string, alerting you on dangerous pipes (`curl | bash`) or system-level changes.

### 🪄 Magic CLI Prompt
- Natural language to CLI command generation.
- **Context-Injection**: The AI knows your project type, top-level files, and active directory to ensure generated commands are precise and ready to run.

### 🌳 Human-Readable Git Tree
- Visualizes git changes as a structured tree in the side-panel.
- Makes it easy to track modifications across large repositories without running multiple `git status` commands.

### 🐱 Interactive Buddy & Gutter Pet
- **Webview Companion**: A level-based companion (Cat, Dog, Robot, Ghost) that responds to your terminal activity with fluid CSS animations.
- **Gutter Decorations**: Real-time terminal feedback using the `TerminalDecorationProvider`. Visual markers (🐾, 🐱, 😿) appear directly in the terminal gutter to reflect command success, failure, or danger.
- **Progression**: Gains XP through successful command executions and interactive troubleshooting.

### 🧠 Intelligent Model Management
- **Dynamic Discovery**: Automatic detection of available models for each AI provider.
- **On-the-Fly Switching**: A dedicated settings gear in the UI allows instant switching between models (e.g., Gemini Flash vs Pro) without reloading.

---

## 📅 Development History & Issue Tracker

### March/April 2026 Focus: UI Polish, Performance, and Security

**1. Webview Freezing & UI Rendering Bugs**
- *The Issue*: Extension users encountered severe "An error occurred while loading view: terminalBuddy.panel" errors which caused the entire layout to fail or freeze interactions.
- *The Fix*: Sourced the bug to missing webview initialization methods (`getCss` & `getBody`). Consolidated fragmented script blocks inside the `PanelProvider.ts` into a single JavaScript execution context. Also unified message listeners for uninterrupted extension-host to webview communication. 

**2. UI Latency & AI Performance Constraints**
- *The Issue*: The application occasionally felt "frozen" due to artificial rate limits placed on AI queries along with locking background tasks. 
- *The Fix*: Removed arbitrary AI rate limits and parallelized endpoint probing alongside context gathering. Optimized local disk I/O allowing the AI mascot/companion to instantly act on commands without blockage causing visual stuttering.

**3. Content Security Policy (CSP) Configuration**
- *The Issue*: Webview scripts and event handlers were increasingly becoming vulnerable to parsing flaws/XSS or failing to build natively. Natural language AI outputs were frequently crashing the parser due to being forced into structured data formats.
- *The Fix*: Replaced inline HTML event handlers with explicit JS event listeners fulfilling a strict local CSP. Separated code flow between UI structuring requests (buttons) and general free-form chat.

**4. External Provider API Connectivity limits**
- *The Issue*: Hard-coded AI targets and models threw "All Gemini endpoints failed" due to maximum capacity/quota constraints per account tier.
- *The Fix*: Engineered dynamic model discovery explicitly mapped out to support scaling token structures like Gemini 2.5/3.1 dynamically honoring individual quota limits seamlessly. Refactored layout to allow fluid interchanging of models via UX components.

---

## 📈 Roadmap & Future Upgrades
- [ ] **Strict Security Mode**: Hard-blocking dangerous command sequences.
- [ ] **Terminal Auto-Redaction**: Masking secrets directly in the VS Code terminal window.
- [ ] **One-Click Venv Sync**: Automatic activation and management of Python/Node environments.
- [ ] **Supply Chain Audit**: Alerting on typo-squatting during package installations.

---

*Documentation version 1.7 | Updated: April 2026 (v5.4 Stability Overhaul)*
