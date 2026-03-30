
# Terminal Buddy — v0 Implementation Plan
> Give this file to any AI (Claude, Gemini, GPT) and say:
> **"Build this VS Code extension exactly as described. Follow every section in order. Do not skip any section."**

---

## What this is

A VS Code extension called **Terminal Buddy** that lives in the bottom panel (next to the Terminal tab). It watches the user's terminal, explains errors in plain English, suggests smart commands based on the project, shows a filterable log of all commands run (including by AI agents), helps with git, detects missing dependencies, and has an optional animated pet companion. It is NOT a code fixer — it is a knowledgeable companion that guides and explains.

---

## Ground rules for the AI building this
- Use **TypeScript** throughout. No JavaScript files.
- Use **VS Code Extension API** only — no Electron-specific APIs.
- Every feature must degrade gracefully — if something fails, catch the error silently and continue. Never crash the extension.
- All storage is local using VS Code's `ExtensionContext.globalState` — no external database, no file writes outside the extension's storage.
- The AI API is **optional and pluggable** — the extension must work fully without it using only the rule engine. AI calls are a bonus layer on top.
- Support **Windows, Mac, and Linux** — test path separators, shell detection, and command syntax for all three.
- Default to doing less, not more — never auto-run commands without user confirmation.
- Every user-facing string should be clear, friendly, and jargon-free.

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5+ |
| Extension API | VS Code Extension API (`vscode` module) |
| Panel UI | Webview (HTML + vanilla JS + CSS variables) |
| Storage | `vscode.ExtensionContext.globalState` |
| File watching | `vscode.workspace.createFileSystemWatcher` |
| Terminal watching | `vscode.window.onDidWriteTerminalData` + shell integration |
| AI API | Google Gemini 2.5 Flash (free tier, no credit card) |
| AI fallback | Groq (Llama 3.3 70B, free tier) |
| Build tool | esbuild (fast, simple bundling) |
| Package manager | npm |

---

## Project folder structure

```
terminal-buddy/
├── src/
│   ├── extension.ts          ← entry point, registers everything
│   ├── panel/
│   │   ├── PanelProvider.ts  ← manages the webview panel
│   │   └── panel.html        ← the UI (injected into webview)
│   ├── core/
│   │   ├── TerminalWatcher.ts   ← watches terminal output
│   │   ├── ProjectScanner.ts    ← scans workspace for project info
│   │   ├── CommandLogger.ts     ← stores and retrieves command history
│   │   ├── RuleEngine.ts        ← instant answers for common errors
│   │   ├── DependencyDetector.ts ← detects missing packages
│   │   ├── GitHelper.ts         ← reads git status
│   │   └── SuggestionEngine.ts  ← generates smart suggestions
│   ├── ai/
│   │   ├── AIClient.ts       ← unified AI client (Gemini + Groq fallback)
│   │   └── prompts.ts        ← all AI prompt templates
│   ├── pet/
│   │   └── PetManager.ts     ← pet state, mood, XP, reactions
│   └── types.ts              ← all shared TypeScript interfaces
├── package.json              ← extension manifest
├── tsconfig.json
├── esbuild.config.js
└── README.md
```

---

## package.json — complete manifest

```json
{
  "name": "terminal-buddy",
  "displayName": "Terminal Buddy",
  "description": "Your friendly terminal companion — explains errors, suggests commands, tracks history, and helps with git.",
  "version": "0.0.1",
  "publisher": "your-publisher-name",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "keywords": ["terminal", "error", "helper", "ai", "companion"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "terminalBuddy.openPanel", "title": "Terminal Buddy: Open Panel" },
      { "command": "terminalBuddy.clearHistory", "title": "Terminal Buddy: Clear History" },
      { "command": "terminalBuddy.setApiKey", "title": "Terminal Buddy: Set AI API Key" },
      { "command": "terminalBuddy.togglePet", "title": "Terminal Buddy: Toggle Pet Mode" }
    ],
    "configuration": {
      "title": "Terminal Buddy",
      "properties": {
        "terminalBuddy.petEnabled": {
          "type": "boolean", "default": true, "description": "Show pet companion"
        },
        "terminalBuddy.petType": {
          "type": "string", "default": "cat",
          "enum": ["cat", "dog", "robot", "ghost"],
          "description": "Choose your pet"
        },
        "terminalBuddy.petName": {
          "type": "string", "default": "Buddy", "description": "Name your pet"
        },
        "terminalBuddy.aiEnabled": {
          "type": "boolean", "default": false, "description": "Enable AI explanations (requires API key)"
        },
        "terminalBuddy.geminiApiKey": {
          "type": "string", "default": "", "description": "Google Gemini API key (free at aistudio.google.com)"
        },
        "terminalBuddy.groqApiKey": {
          "type": "string", "default": "", "description": "Groq API key (free at console.groq.com)"
        },
        "terminalBuddy.warnOnMainPush": {
          "type": "boolean", "default": true, "description": "Warn before pushing to main/master"
        },
        "terminalBuddy.maxHistoryItems": {
          "type": "number", "default": 500, "description": "Max command history entries"
        }
      }
    },
    "views": {
      "terminal": [
        {
          "type": "webview",
          "id": "terminalBuddy.panel",
          "name": "Terminal Buddy"
        }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.config.js",
    "watch": "node esbuild.config.js --watch",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "esbuild": "^0.20.0",
    "@vscode/vsce": "^2.0.0"
  }
}
```

---

## types.ts — all shared interfaces

Define these first. Every other file imports from here.

```typescript
export type ProjectType = 'react' | 'vue' | 'node' | 'python' | 'rust' | 'go' | 'unknown';
export type CommandStatus = 'ok' | 'error' | 'warning' | 'running';
export type CommandTag = 'test' | 'build' | 'git' | 'install' | 'agent' | 'run' | 'other';
export type PetMood = 'happy' | 'worried' | 'sleeping' | 'excited' | 'scared' | 'neutral';
export type PetType = 'cat' | 'dog' | 'robot' | 'ghost';

export interface CommandEntry {
  id: string;               // unique id (timestamp + random)
  cmd: string;              // the raw command string
  cwd: string;              // directory it ran in
  project: string;          // project name (folder name)
  status: CommandStatus;
  exitCode: number | null;
  tag: CommandTag;
  timestamp: number;        // Date.now()
  isAgentRun: boolean;      // true if run by AI agent, not user
  errorOutput?: string;     // captured stderr if any
  agentSessionId?: string;  // groups agent commands together
}

export interface ProjectInfo {
  path: string;             // absolute path to project folder
  name: string;             // folder name
  type: ProjectType;
  confidence: number;       // 0-1 score
  scripts: Record<string, string>;  // from package.json scripts
  hasDotEnv: boolean;
  hasDotEnvExample: boolean;
  hasNodeModules: boolean;
  hasGit: boolean;
  detectedTools: string[];  // e.g. ['docker', 'prisma', 'typescript']
}

export interface WorkspaceMap {
  rootPath: string;
  projects: ProjectInfo[];
  scannedAt: number;
}

export interface GitStatus {
  branch: string;
  isMainOrMaster: boolean;
  uncommittedCount: number;
  aheadCount: number;
  behindCount: number;
  hasConflicts: boolean;
  lastCommitMessage: string;
  lastCommitTime: string;
}

export interface Suggestion {
  id: string;
  cmd: string;
  label: string;
  reason: string;
  dir: string;             // which subdirectory to run from
  priority: number;        // higher = show first
  category: 'fix' | 'workflow' | 'git' | 'setup';
}

export interface ErrorExplanation {
  summary: string;         // one sentence plain English
  cause: string;           // why it happened
  fix: string;             // what to do
  learnMoreUrl?: string;
  suggestedCommands?: string[];
  fromCache: boolean;
}

export interface PetState {
  type: PetType;
  name: string;
  mood: PetMood;
  xp: number;
  level: number;
  errorsFixed: number;
  lastActiveAt: number;
}

export interface PanelMessage {
  type: string;
  payload: unknown;
}
```

---

## extension.ts — entry point

This file only does three things: registers commands, creates the panel, starts the watchers. Keep it short.

```typescript
// On activate:
// 1. Create PanelProvider and register it as a webview view
// 2. Create TerminalWatcher and start watching
// 3. Create ProjectScanner and scan workspace on open
// 4. Register all commands
// 5. Set up file system watcher for package.json changes (re-scan on change)

// On deactivate:
// Dispose all watchers and subscriptions cleanly
```

Key detail: use `vscode.window.registerWebviewViewProvider` with the view ID `terminalBuddy.panel` — this places the panel in the bottom tab bar next to Terminal automatically.

---

## core/TerminalWatcher.ts

This is the most important and trickiest file. Read carefully.

**How terminal watching works in VS Code:**
- Use `vscode.window.onDidWriteTerminalData` — fires every time anything is written to any terminal
- Use `vscode.window.onDidCloseTerminal` — fires when a terminal closes
- Use `vscode.window.onDidOpenTerminal` — fires when a new terminal opens

**The challenge:** VS Code gives you raw terminal output including ANSI escape codes, shell prompts, and partial lines. You must strip ANSI codes before processing.

**Shell integration API (use this for reliable exit codes):**
- `vscode.window.onDidEndTerminalShellExecution` — fires when a command finishes, gives you the exit code reliably
- `vscode.window.onDidStartTerminalShellExecution` — fires when a command starts

**What TerminalWatcher must do:**
1. Listen to `onDidStartTerminalShellExecution` — capture the command string and start time
2. Listen to `onDidEndTerminalShellExecution` — capture exit code, duration, finalize the entry
3. Buffer raw output per terminal using a `Map<Terminal, string>` 
4. On command end: strip ANSI from buffered output, extract last N lines as error context
5. Detect if command was run by an AI agent (check if active editor is an agent panel — or expose a method `markNextCommandAsAgent()` that the panel calls)
6. Emit a typed event: `onCommandFinished(entry: CommandEntry)`

**ANSI stripping:** Use this regex: `/\x1B\[[0-9;]*[mGKHF]/g` — replace all matches with empty string.

**Command tagging logic:**
```
starts with "jest" | "vitest" | "pytest" | "mocha" → tag: 'test'
starts with "npm run build" | "tsc" | "vite build" | "next build" → tag: 'build'
starts with "git" → tag: 'git'
starts with "npm install" | "yarn add" | "pip install" | "cargo add" → tag: 'install'
starts with "npm run dev" | "npm start" | "python" | "node" → tag: 'run'
everything else → tag: 'other'
```

**Wrong directory detection:**
After scanning the workspace, check on every command: if the user types `npm run X` but `X` doesn't exist in the current directory's `package.json` scripts, but DOES exist in a sibling project's scripts — fire a `onWrongDirectory` event with the correct path.

---

## core/ProjectScanner.ts

Runs once on workspace open, then again when `package.json` changes.

**Scanning algorithm:**
1. Get workspace root from `vscode.workspace.workspaceFolders[0].uri.fsPath`
2. Walk directory tree up to **3 levels deep** using `vscode.workspace.fs.readDirectory`
3. For each directory, check for these signature files using `vscode.workspace.fs.stat`:
   - `package.json` → read and parse it (name, scripts, dependencies)
   - `requirements.txt` or `pyproject.toml` → Python
   - `Cargo.toml` → Rust
   - `go.mod` → Go
   - `pom.xml` → Java/Maven
   - `.env` → has env file
   - `.env.example` → has example env
   - `node_modules/` → dependencies installed
   - `Dockerfile` → Docker project
   - `.git/` → git repo
4. Score each directory as a `ProjectInfo` with confidence
5. Detect `ProjectType` by dependencies in `package.json`:
   - `react` in dependencies → React
   - `vue` → Vue
   - `express` | `fastify` | `koa` → Node API
   - else has `package.json` → Node
6. Build `WorkspaceMap` and cache it in memory
7. Emit `onWorkspaceScanned(map: WorkspaceMap)`

**Important:** Skip these directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `.venv`

---

## core/CommandLogger.ts

Stores command history. Simple but must be reliable.

**Storage:** Use `ExtensionContext.globalState.update('commandHistory', entries)` — stores as JSON array. Max 500 entries (configurable). When full, remove oldest.

**Methods to implement:**
- `add(entry: CommandEntry): void` — adds to front of array, trims if over limit, saves
- `getAll(): CommandEntry[]` — returns all entries newest first
- `search(query: string): CommandEntry[]` — fuzzy search across `cmd`, `cwd`, `project` fields
- `getByTag(tag: CommandTag): CommandEntry[]`
- `getByStatus(status: CommandStatus): CommandEntry[]`
- `getRecent(n: number): CommandEntry[]` — last N entries
- `clear(): void`
- `getStats(): { total, ok, error, warning }` — used for the stats row in the panel

**Fuzzy search implementation (no libraries needed):**
Split the query into words. An entry matches if ALL words appear somewhere in `cmd + cwd + project` (case insensitive). This is fast enough for 500 entries.

---

## core/RuleEngine.ts

Instant answers for common errors. No AI needed. Runs first, AI only runs if rule engine returns null.

**Structure:** An array of rules, each with a `match` function and a `result` function:

```typescript
interface Rule {
  id: string;
  match: (cmd: string, output: string, exitCode: number) => boolean;
  result: (cmd: string, output: string) => ErrorExplanation;
}
```

**Rules to implement for v0:**

| Error pattern | Explanation |
|---|---|
| output contains "ENOENT" | File or directory not found. Check the path exists. |
| output contains "EACCES" or "permission denied" | Permission denied. Try with `sudo` or fix file permissions with `chmod`. |
| output contains "EADDRINUSE" or "address already in use" | Port is already used by another process. Find it with `lsof -i :PORT` and kill it. |
| output contains "Cannot find module" | A package is not installed. Run `npm install PACKAGE_NAME`. |
| output contains "command not found" | This command is not installed on your system. |
| output contains "ENOMEM" or "out of memory" | Not enough memory. Close other apps or increase Node memory with `NODE_OPTIONS=--max-old-space-size=4096`. |
| output contains "SyntaxError" | There's a JavaScript/TypeScript syntax error. Check the file and line number shown. |
| output contains "ETIMEDOUT" or "network timeout" | Network request timed out. Check your internet connection. |
| output contains "401" or "unauthorized" | Authentication failed. Check your API key or login credentials. |
| output contains "403" or "forbidden" | Access denied. You don't have permission to do this. |
| output contains "CORS" | Cross-origin request blocked. Check your server's CORS settings. |
| cmd starts with "git push" and output contains "rejected" | Push rejected. Run `git pull` first to get the latest changes, then push again. |
| cmd starts with "git merge" and output contains "conflict" | Merge conflict. Open the conflicting files and resolve the `<<<` markers. |
| output contains "npm ERR! missing script" | This npm script doesn't exist. Check `package.json` for available scripts. |
| output contains "Python was not found" or "python: command not found" | Python is not installed or not in PATH. Install Python from python.org. |
| output contains "npm warn peer" | Peer dependency warning. Usually safe to ignore, but check if things work. |

---

## core/DependencyDetector.ts

Runs when a command fails. Checks if the error is caused by a missing dependency and suggests the fix.

**Detection patterns:**

```
"Cannot find module 'X'" → suggest: npm install X
"No module named 'X'" → suggest: pip install X
"command not found: X" where X is a known tool → suggest global install
"ENOENT: node_modules" → suggest: npm install (no args)
".env file not found" but .env.example exists → suggest: cp .env.example .env
"nodemon: command not found" → suggest: npm install -g nodemon
"ts-node: command not found" → suggest: npm install -g ts-node
"tsc: command not found" → suggest: npm install -g typescript
```

**Known global tools map:**
```typescript
const GLOBAL_TOOLS: Record<string, string> = {
  'nodemon': 'npm install -g nodemon',
  'ts-node': 'npm install -g ts-node',
  'tsc': 'npm install -g typescript',
  'prettier': 'npm install -g prettier',
  'eslint': 'npm install -g eslint',
  'http-server': 'npm install -g http-server',
  'serve': 'npm install -g serve',
  'pm2': 'npm install -g pm2',
};
```

When a dependency fix is found, emit it as a `Suggestion` with `category: 'fix'` and `priority: 100` (highest).

---

## core/GitHelper.ts

Reads git status by running git commands via `vscode.window.createTerminal` — no. Use Node's `child_process.exec` wrapped in a Promise.

**Methods:**

`getStatus(workspacePath: string): Promise<GitStatus>`
- Run `git -C PATH rev-parse --abbrev-ref HEAD` → branch name
- Run `git -C PATH status --porcelain` → count lines for uncommitted files
- Run `git -C PATH rev-list --count HEAD...@{u}` → ahead/behind (handle errors gracefully if no upstream)
- Run `git -C PATH log -1 --format="%s|%cr"` → last commit message and time
- Run `git -C PATH diff --name-only --diff-filter=U` → conflicts (any output = has conflicts)

**Warn on main push:** After `getStatus()`, if `branch` is `main` or `master` and the user just ran a `git push` command, emit `onMainPushDetected()`.

**Suggested git actions** (generate these based on current status):
- If uncommitted files > 0 → suggest `git add -A && git commit -m ""`
- If ahead > 0 → suggest `git push origin HEAD`
- If branch is main → suggest `git checkout -b feature/`
- If conflicts > 0 → suggest opening the conflicting files

**Run all git commands with a 3 second timeout.** If git is not installed or not a git repo, return null gracefully.

---

## core/SuggestionEngine.ts

Takes the `WorkspaceMap`, current `cwd`, last `CommandEntry`, and `GitStatus` and produces a ranked list of `Suggestion[]`.

**Scoring system:**
Each suggestion starts at priority 0. Add points:
- Command exists in package.json scripts of current dir: +50
- Command was run successfully before in this project: +30
- Error just occurred and this fixes it: +100
- Missing .env but .env.example exists: +80
- node_modules missing: +90
- Git has uncommitted files: +40
- Wrong directory detected: +100 (redirect suggestion)

Sort by priority descending. Return top 5.

**Always include these if conditions are met:**
- `node_modules` missing → "Run npm install first"
- `.env` missing, `.env.example` exists → "Copy example env file"
- User is in wrong directory for their command → "cd to correct folder"
- Port in use error → "Kill the process using port X"
- Pushing to main → "Create a branch first"

---

## ai/AIClient.ts

Single unified client. Gemini first, Groq as fallback. Only called if `aiEnabled` is true in config AND the rule engine returned null.

**Request flow:**
1. Check if Gemini API key is set → call Gemini
2. If Gemini fails or no key → check Groq API key → call Groq
3. If both fail → return null (rule engine result or nothing is shown)

**Gemini call:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=API_KEY
Body: { contents: [{ parts: [{ text: PROMPT }] }], generationConfig: { maxOutputTokens: 300 } }
```

**Groq call:**
```
POST https://api.groq.com/openai/v1/chat/completions
Headers: Authorization: Bearer API_KEY
Body: { model: "llama-3.3-70b-versatile", messages: [...], max_tokens: 300 }
```

**Cache:** Store AI responses in a `Map<string, ErrorExplanation>` where key is a hash of `cmd + firstLineOfError`. If the same error appears again, return cached result instantly. Cache up to 100 entries in memory (clear oldest when full).

**Rate limiting:** Never call AI more than once per 3 seconds. Queue requests and debounce.

---

## ai/prompts.ts

All prompt templates in one file. Never hardcode prompts elsewhere.

**Error explanation prompt:**
```
You are Terminal Buddy, a friendly terminal assistant. A developer got this error.

Command run: {cmd}
Directory: {cwd}
Project type: {projectType}
Error output (last 20 lines):
{errorOutput}

Respond in this exact JSON format, nothing else:
{
  "summary": "one sentence plain English explanation of what went wrong",
  "cause": "one sentence explaining why it happened",
  "fix": "one or two sentences on exactly how to fix it",
  "suggestedCommands": ["command1", "command2"]
}

Rules: Be friendly and clear. No jargon. Max 2 suggested commands. If you don't know, say so honestly.
```

**Doubt clearing prompt:**
```
You are Terminal Buddy. The developer is asking a follow-up question about an error.

Original command: {cmd}
Error output: {errorOutput}
Developer's question: {question}

Answer in 2-3 sentences max. Be friendly and concrete. No markdown headers.
```

---

## panel/PanelProvider.ts

Manages the webview. Handles communication between extension and UI.

**Message types the extension sends TO the webview:**
```typescript
{ type: 'updateLog', payload: CommandEntry[] }
{ type: 'updateSuggestions', payload: Suggestion[] }
{ type: 'updateGitStatus', payload: GitStatus | null }
{ type: 'updateWorkspaceMap', payload: WorkspaceMap }
{ type: 'updatePetState', payload: PetState }
{ type: 'showExplanation', payload: ErrorExplanation }
{ type: 'showWarning', payload: { message: string } }
{ type: 'updateStats', payload: { total, ok, error, warning } }
```

**Message types the webview sends TO the extension:**
```typescript
{ type: 'runCommand', payload: { cmd: string, cwd: string } }
{ type: 'askDoubt', payload: { question: string } }
{ type: 'dismissWarning' }
{ type: 'clearHistory' }
{ type: 'searchHistory', payload: { query: string } }
{ type: 'filterLog', payload: { status?: string, tag?: string } }
{ type: 'petInteract' }   // user clicked the pet
{ type: 'ready' }         // webview loaded, send initial state
```

**Security:** Always set `localResourceRoots` and use a nonce for inline scripts. Set `Content-Security-Policy` in the webview HTML.

**When the webview sends `runCommand`:** Show a VS Code confirmation dialog (`vscode.window.showWarningMessage`) before running. Never run without confirmation.

**Running commands programmatically:** Create a terminal with `vscode.window.createTerminal`, then call `terminal.sendText(cmd)`. Do not use `child_process` for user-facing commands.

---

## panel/panel.html — UI structure

The panel UI is pure HTML + vanilla JS + CSS variables (no React, no framework — keeps it fast and simple to build).

**Layout (top to bottom):**

```
┌─────────────────────────────────┐
│  [Pet/Icon] Buddy   [mode toggle]│  ← header
├─────────────────────────────────┤
│  [Warning banner if any]        │  ← dismissible
├─────────────────────────────────┤
│  [Tabs: Log | Suggestions | Git]│
├─────────────────────────────────┤
│  [Stats row: Total/OK/Fail/Warn]│  ← log tab only
│  [Search input]                 │  ← log tab only
│  [Filter pills: All/Fail/Test…] │  ← log tab only
│  [Command list]                 │  ← scrollable
├─────────────────────────────────┤
│  [Doubt input: "Ask about this"]│  ← always visible
└─────────────────────────────────┘
```

**CSS:** Use VS Code CSS variables throughout:
- `var(--vscode-editor-background)` for backgrounds
- `var(--vscode-editor-foreground)` for text
- `var(--vscode-button-background)` for buttons
- `var(--vscode-inputValidation-errorBackground)` for errors
- `var(--vscode-terminal-ansiGreen)` for success
- `var(--vscode-terminal-ansiRed)` for errors
- `var(--vscode-terminal-ansiYellow)` for warnings

This makes the panel automatically match the user's VS Code theme (light, dark, high contrast).

**Pet rendering:** Use emoji for v0. Map mood to emoji:
```
cat:   happy=😸 worried=😿 sleeping=😴 excited=🙀 scared=🙀 neutral=🐱
dog:   happy=🐶 worried=😟 sleeping=💤 excited=🐕 scared=😰 neutral=🐶
robot: happy=🤖 worried=⚠️  sleeping=💤 excited=🤖 scared=⚠️  neutral=🤖
ghost: happy=👻 worried=👻 sleeping=💤 excited=👻 scared=👻 neutral=👻
```

**Minimal mode:** In minimal mode, replace pet emoji with a small status circle (green=ok, yellow=warning, red=error) and hide the pet name.

---

## pet/PetManager.ts

Manages pet state. Persists via `globalState`.

**XP system:**
- Error explained: +5 XP
- Suggestion followed (user ran suggested command): +10 XP
- Command succeeds after a failure: +15 XP
- Git warning heeded (user created branch instead of pushing to main): +20 XP

**Level thresholds:** Level 1 = 0 XP, Level 2 = 100 XP, Level 3 = 300 XP, Level 4 = 600 XP, Level 5 = 1000 XP

**Mood rules (check these in order, first match wins):**
1. Last command was `rm -rf` → `scared` for 5 seconds then reset
2. Last 3 commands all failed → `worried`
3. Last command succeeded after a failure → `happy` for 10 seconds
4. New workspace opened → `excited` for 5 seconds
5. No activity for 10 minutes → `sleeping`
6. Default → `neutral`

**On level up:** Send a VS Code notification: "🎉 Buddy leveled up to level X!"

---

## Key implementation details — read carefully

### Terminal shell integration
Shell integration (`onDidEndTerminalShellExecution`) only works when the user's shell has VS Code shell integration enabled. This is automatic for bash/zsh in recent VS Code versions. Always check `execution.shellIntegration` is defined before using it. Fall back to output parsing if not available.

### Windows compatibility
- Use `path.sep` not hardcoded `/`
- Git commands work on Windows if Git is in PATH
- `child_process.exec` on Windows may need `{ shell: true }`
- Port detection command: Windows uses `netstat -ano` not `lsof`

### Webview security
```html
<meta http-equiv="Content-Security-Policy" 
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-NONCE';">
```
Generate a fresh nonce on every webview creation using `crypto.randomBytes(16).toString('base64')`.

### File system watching
```typescript
const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
watcher.onDidChange(() => projectScanner.rescan());
watcher.onDidCreate(() => projectScanner.rescan());
```

### Avoiding performance issues
- Debounce terminal output processing: wait 100ms after last character before processing
- Run `ProjectScanner` in a setTimeout (after 500ms delay on activation) so it doesn't slow startup
- Never use synchronous file operations
- Cache git status for 5 seconds minimum between checks

---

## v0 feature checklist — build in this order

Build and test each before moving to next. Do not skip ahead.

- [ ] **Step 1:** Project scaffold, package.json, tsconfig, esbuild config, empty extension.ts that activates
- [ ] **Step 2:** Basic webview panel that opens in bottom tab, shows "Hello from Buddy"
- [ ] **Step 3:** TerminalWatcher — captures commands and exit codes, logs to console
- [ ] **Step 4:** CommandLogger — stores entries, webview shows live list with status dots
- [ ] **Step 5:** RuleEngine — explain common errors, show in panel when error occurs
- [ ] **Step 6:** ProjectScanner — scan workspace, show workspace map in panel
- [ ] **Step 7:** SuggestionEngine — show top 5 suggestions with Run buttons
- [ ] **Step 8:** DependencyDetector — detect missing packages, surface as priority suggestions
- [ ] **Step 9:** GitHelper — show git status tab, warn on main push
- [ ] **Step 10:** Search + filter in log tab
- [ ] **Step 11:** Pet system — emoji pet with mood reactions
- [ ] **Step 12:** AIClient — Gemini + Groq integration, doubt clearing chat
- [ ] **Step 13:** Wrong directory detection and guidance
- [ ] **Step 14:** Agent session grouping in log
- [ ] **Step 15:** Polish — animations, level up notifications, onboarding message

---

## New ideas for v1 (do NOT build in v0, save for later)

- **Snippet saver:** User can right-click any command in the log and "save as snippet" with a custom name. Saved snippets appear at the top of suggestions always.
- **Team sync:** Export/import command history as a JSON file — share useful command sequences with teammates.
- **Port dashboard:** A mini tab showing all currently active ports and which process owns them. One-click kill.
- **Environment diff:** Compare current `.env` keys against `.env.example` and show which keys are missing or extra.
- **Build time tracker:** Track how long each build/test run takes over time. Show trend (getting faster or slower?).
- **Error frequency heatmap:** Which errors happen most often? Show a simple bar of the top 5 recurring errors.
- **Custom pet skins:** Accept a path to a custom emoji or image for the pet — community contributed.
- **Multi-terminal support:** When user has 3 terminals open, show which terminal each log entry came from.
- **Offline mode indicator:** Detect if npm registry is unreachable and warn before running install commands.
- **Shell alias detector:** Read `~/.bashrc` or `~/.zshrc` for user-defined aliases and include them in suggestions.

---

## How to give this file to an AI and get working code

Say exactly this:

> "Build the VS Code extension described in this file. Start with Step 1 of the feature checklist and complete it fully before moving to Step 2. Ask me before starting each new step. Use TypeScript throughout. Follow every implementation detail exactly as written. When you're unsure about something, default to the simpler, safer approach."

Build one step at a time. Test each step by pressing F5 in VS Code to launch the Extension Development Host. Do not try to build everything at once.

---

## Useful references

- VS Code Extension API: https://code.visualstudio.com/api
- Shell Integration API: https://code.visualstudio.com/api/references/vscode-api#window.onDidEndTerminalShellExecution
- Webview API: https://code.visualstudio.com/api/extension-guides/webview
- Google AI Studio (free Gemini key): https://aistudio.google.com
- Groq Console (free Llama key): https://console.groq.com
- Publishing to marketplace: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

---

*Terminal Buddy v0 — built open source, for developers who just want a friend in their terminal.*
