import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CommandEntry, ErrorExplanation } from '../types';

export class AgentSync {
  private workspaceRoot: string | undefined;
  private buddyDir: string | undefined;

  constructor() {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (this.workspaceRoot) {
      this.buddyDir = path.join(this.workspaceRoot, '.buddy');
    }
  }

  /**
   * Syncs a command and its explanation to the agent context file.
   */
  public async sync(entry: CommandEntry, explanation: ErrorExplanation): Promise<void> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    if (!config.get<boolean>('agentSyncEnabled', true) || !this.buddyDir) {
      return;
    }

    try {
      if (!fs.existsSync(this.buddyDir)) {
        fs.mkdirSync(this.buddyDir, { recursive: true });
      }

      // Add to .gitignore if it exists and doesn't contain .buddy/
      this.ensureGitIgnore();

      // Human Readable Log
      const logPath = path.join(this.workspaceRoot!, config.get<string>('agentContextPath', '.buddy/antigravity.md'));
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const content = `\n## [${timestamp}] Terminal Event: ${entry.status.toUpperCase()}\n- **Command**: \`${entry.cmd}\`\n- **Status**: ${entry.status}\n\n### Analysis\n> ${explanation.summary}\n\n---\n`;
      fs.appendFileSync(logPath, content, 'utf8');
      this.maintainLimit(logPath);

      // 🤖 Machine Readable State (Better Direct Sync)
      const statePath = path.join(this.buddyDir, 'antigravity.json');
      let state: any = { lastUpdated: entry.timestamp, recentErrors: [] };
      if (fs.existsSync(statePath)) {
        try {
          state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        } catch {}
      }
      state.lastUpdated = entry.timestamp;
      state.recentErrors.unshift({
        cmd: entry.cmd,
        error: entry.errorOutput?.substring(0, 200),
        solution: explanation.summary,
        fix: explanation.fix,
        timestamp: entry.timestamp
      });
      state.recentErrors = state.recentErrors.slice(0, 10);
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

      // 🖱️ Cursor rules sync
      this.syncCursorRules(entry, explanation);

    } catch (err) {
      console.error('[Terminal Buddy] AgentSync failed:', err);
    }
  }

  private syncCursorRules(entry: CommandEntry, explanation: ErrorExplanation): void {
    if (!this.workspaceRoot) { return; }
    const cursorRulesPath = path.join(this.workspaceRoot, '.cursorrules');
    try {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const markerStart = '<!-- BUDDY_CONTEXT_START -->';
      const markerEnd = '<!-- BUDDY_CONTEXT_END -->';
      const newBlock = `${markerStart}
### 🚨 Last Terminal Error (${timestamp})
- **Command**: \`${entry.cmd}\`
- **Error**: ${entry.errorOutput?.substring(0, 300) || 'Unknown error'}
- **Suggested Fix**: ${explanation.summary}
${markerEnd}`;

      let content = '';
      if (fs.existsSync(cursorRulesPath)) {
        content = fs.readFileSync(cursorRulesPath, 'utf8');
      }

      if (content.includes(markerStart)) {
        // Replace existing block
        const regex = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, 'g');
        content = content.replace(regex, newBlock);
      } else {
        // Append new block
        content += `\n\n${newBlock}\n`;
      }

      fs.writeFileSync(cursorRulesPath, content, 'utf8');
    } catch (err) {}
  }

  private ensureGitIgnore(): void {
    if (!this.workspaceRoot) { return; }
    const gitIgnorePath = path.join(this.workspaceRoot, '.gitignore');
    try {
      if (fs.existsSync(gitIgnorePath)) {
        const content = fs.readFileSync(gitIgnorePath, 'utf8');
        if (!content.includes('.buddy/')) {
          fs.appendFileSync(gitIgnorePath, '\n# Terminal Buddy Context\n.buddy/\n');
        }
      }
    } catch (err) {}
  }

  private maintainLimit(filePath: string): void {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 50 * 1024) { // 50KB
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        // Keep the last 200 lines roughly
        const truncated = lines.slice(-500).join('\n');
        fs.writeFileSync(filePath, truncated, 'utf8');
      }
    } catch (err) {}
  }
}
