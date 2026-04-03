# Change Log

## [0.0.1] — Unreleased

### Added
- Initial release of Terminal Buddy
- Terminal command watching and logging
- Rule-based error explanations (20 common patterns)
- BYOK AI explanations (Gemini, OpenAI, Claude, Groq)
- Smart command suggestions
- Git status monitoring and main-branch push warnings
- Missing dependency detection
- Filterable, searchable command history
- Pet companion with mood, XP, and leveling system
- Wrong directory detection
- Streaming chat interface with markdown rendering
- Dynamic model discovery for newer AI constraints (e.g. Gemini 2.5/3.1)
- Strict Webview Content Security Policy (CSP) implementation

### Fixed/Changed
- Resolved Webview UI freezing issues by restoring layout retrieval methods (`getCss`, `getBody`).
- Optimized terminal performance by removing artificial constraints, parallelizing context gathering, and optimizing disk I/O.
- Unified JavaScript execution contexts via event listeners for proper HTML-webview integration.
- Separated AI structural data (UI rendering) from natural language chat features to prevent incorrect parsing.
- Alleviated API connection failures by enforcing strict rate-limiting respect against external quota limits.
- Overhauled README, contributing guidelines, features document, and buddy setup for clearer open-source presence.
