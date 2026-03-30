# Terminal Buddy — Security Audit

**Date:** 2026-03-30
**Scope:** VS Code extension v0.0.1
**Status:** ✅ Passed

---

## API Key Storage

| Risk | Mitigation |
|------|-----------|
| Keys stored in plain settings.json (readable by anyone) | **Fixed** — all API keys stored via `vscode.ExtensionContext.secrets` (VS Code `SecretStorage`, OS keychain-backed) |
| Key logged to console | **Not present** — keys are only accessed at call time, never logged |
| Key sent to wrong endpoint | **Mitigated** — each provider has a hardcoded endpoint in `types.ts`. User picks provider, key routes to that provider only |

## Terminal Output Handling

| Risk | Mitigation |
|------|-----------|
| Full terminal output sent to AI (may contain secrets) | Output capped at **500 chars** before sending. Warning in README. |
| Buffer overflow from huge output | Output buffer capped at **50KB** per command in `TerminalWatcher.ts` |
| ANSI escape injection in stored output | All output stripped of ANSI before storage and display |
| XSS in webview via command output | All user content rendered via `textContent` / `escapeHtml()`. To prevent attribute injection (`onclick=\'...\'`), quotes are escaped via `&quot;` and `&#39;`, and inline event handlers are removed entirely. |

## Webview Security

| Risk | Mitigation |
|------|-----------|
| Arbitrary script execution in webview | CSP: `script-src 'nonce-{nonce}'` enforces strict script execution. Inline event handlers (e.g. `onclick`) were identified as blocked by CSP and completely removed in favor of safe DOM event delegation. |
| Resource loading from external origins | CSP: `default-src 'none'` — nothing loads from outside |
| Style injection | CSP: `style-src 'unsafe-inline'` — required for VS Code theme variables |
| Font loading | CSP: `font-src ${webview.cspSource}` — only VS Code's own fonts |
| Nonce reuse | Fresh `crypto.randomBytes(16)` nonce on every webview creation |

## Command Execution

| Risk | Mitigation |
|------|-----------|
| Extension auto-runs commands without consent | **Never** — every `runCommand` message triggers `vscode.window.showWarningMessage` with modal confirmation |
| User injects shell escape in suggested commands | Commands come from the rule engine or AI (never from raw terminal output). AI is instructed not to suggest dangerous commands |

## AI / Network

| Risk | Mitigation |
|------|-----------|
| Unbounded AI requests (cost abuse) | Rate limited to **1 call per 3 seconds**. In-memory LRU cache of 100 responses |
| Hanging network calls | **15-second AbortController timeout** on every AI request |
| Malformed AI JSON crashing the extension | `JSON.parse` wrapped in try/catch. Fallback to raw text as summary |
| 401/403 from invalid key | Caught explicitly — shows VS Code notification to re-set key |
| 429 rate limit from provider | Caught silently — logs to console, no user disruption |

## Git Command Execution

| Risk | Mitigation |
|------|-----------|
| Git command injection via branch names | Branch names never shell-interpolated — passed as separate `args[]` to `execFile` |
| Hanging git commands | **3-second AbortController timeout** on every git call |
| Git not installed | Checked on activation. Features silently disabled if absent |

## Storage

| Risk | Mitigation |
|------|-----------|
| Corrupted `globalState` crashes extension | All `globalState.get()` wrapped in try/catch. Resets to empty on corruption |
| Unbounded storage growth | Max 500 entries enforced. Each entry's `errorOutput` capped at 500 chars |
| Concurrent write conflicts | Serial write queue in `CommandLogger` — writes never overlap |

## Overall Security Rating: ✅ SECURE for v0 (Post-Audit Fixes Applied)

Final Audit findings:
1. Identified and resolved an XSS and feature-breaking issue where inline `onclick` handlers were blocked by strict Webview CSP rules. Replaced with safe DOM event delegation (`document.body.addEventListener`) utilizing securely serialized `data-` attributes.
2. Verified `GitHelper` correctly uses Node `execFile` passing directory paths as discrete array arguments, successfully mitigating shell injection via directory or command anomalies.

No critical or high severity issues remain. The BYOK model means the user controls their own API key exposure. The main privacy note is that terminal output can be sent to the user's chosen AI — this is documented.