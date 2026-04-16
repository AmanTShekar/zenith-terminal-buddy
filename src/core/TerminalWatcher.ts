import * as vscode from 'vscode';
import {
  CommandEntry, CommandStatus, CommandTag, ActiveCommand,
  MAX_BUFFER_SIZE, MAX_ERROR_OUTPUT_LENGTH, DEBOUNCE_TERMINAL_MS,
} from '../types';
import { redact } from './RedactionUtils';

// Comprehensive ANSI escape sequence stripper
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

function stripAnsi(str: string): string {
  if (!str || str.length > 100000) { return str.replace(ANSI_RE, ''); } // Fallback for very large strings
  return str.replace(ANSI_RE, '');
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function tagCommand(cmd: string): CommandTag {
  const c = cmd.trim().toLowerCase();
  if (/^(jest|vitest|pytest|mocha|npm\s+test|yarn\s+test|npx\s+jest|rspec|bundle\s+exec\s+rspec)/.test(c)) { return 'test'; }
  if (/^(npm\s+run\s+build|yarn\s+build|tsc|vite\s+build|next\s+build|webpack|rollup|dotnet\s+build|mvn\s+package|gradle\s+build)/.test(c)) { return 'build'; }
  if (/^git\s/.test(c)) { return 'git'; }
  if (/^(npm\s+(install|i|ci)|yarn\s+(add|install)|pnpm\s+(add|install|i)|pip\s+install|cargo\s+add|bundle\s+install|composer\s+install)/.test(c)) { return 'install'; }
  if (/^(npm\s+(run\s+dev|start|run\s+start)|yarn\s+(dev|start)|node\s|python\s|cargo\s+run|go\s+run|rails\s+s|php\s+artisan\s+serve)/.test(c)) { return 'run'; }
  return 'other';
}

interface ExecutionBuffer {
  id: string;
  cmd: string;
  cwd: string;
  output: string;
  startTime: number;
}

export class TerminalWatcher implements vscode.Disposable {
  private readonly _onCommandFinished = new vscode.EventEmitter<CommandEntry>();
  public readonly onCommandFinished = this._onCommandFinished.event;

  private readonly _onBuddyTrigger = new vscode.EventEmitter<{ terminal: vscode.Terminal; cmd: string }>();
  public readonly onBuddyTrigger = this._onBuddyTrigger.event;

  private readonly _onCommandStart = new vscode.EventEmitter<{ id: string; cmd: string; cwd: string; terminalId: string; terminalName: string; isAgentRun: boolean }>();
  public readonly onCommandStart = this._onCommandStart.event;

  private readonly _onWrongDirectory = new vscode.EventEmitter<{ cmd: string; correctPath: string }>();
  public readonly onWrongDirectory = this._onWrongDirectory.event;

  private readonly _onData = new vscode.EventEmitter<{ terminal: vscode.Terminal; data: string }>();
  public readonly onData = this._onData.event;

  private readonly _onSensitivityDetected = new vscode.EventEmitter<vscode.Terminal>();
  public readonly onSensitivityDetected = this._onSensitivityDetected.event;

  private readonly _onJiraIssueDetected = new vscode.EventEmitter<string>();
  public readonly onJiraIssueDetected = this._onJiraIssueDetected.event;

  private readonly disposables: vscode.Disposable[] = [];
  private buffers: Map<vscode.Terminal, ExecutionBuffer> = new Map();
  private purposeCache: Map<string, string> = new Map();
  private aiClient?: any;
  private history: Map<string, { cmd: string }[]> = new Map();
  private historyLimit: number;
  private portMonitor?: any;
  private readonly terminalIds = new Map<vscode.Terminal, string>();
  private readonly shellIntegration = new Map<vscode.Terminal, boolean>();
  private debounceTimers = new Map<vscode.Terminal, NodeJS.Timeout>();
  private pendingPurposeRequests = new Set<string>();
  private lastBuddyTerminal?: vscode.Terminal;
  private lastCommandTime = new Map<vscode.Terminal, number>();
  private agentDetected = new Map<vscode.Terminal, boolean>();

  public getTerminalId(terminal: vscode.Terminal): string {
    if (!this.terminalIds.has(terminal)) {
      const id = `term-${terminal.name}-${Date.now()}`;
      this.terminalIds.set(terminal, id);
    }
    return this.terminalIds.get(terminal)!;
  }

  public setLastBuddyTerminal(terminal: vscode.Terminal): void {
    this.lastBuddyTerminal = terminal;
  }

  constructor(historyLimit: number = 100, aiClient?: any, portMonitor?: any) {
    this.historyLimit = historyLimit;
    this.aiClient = aiClient;
    this.portMonitor = portMonitor;
    this.setupListeners();
  }

  private setupListeners() {
    // ── Shell Integration: command start ────────────────────────────────
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution(async (e) => {
        const terminal = e.terminal;
        console.log(`[Terminal Buddy] Shell Execution STARTED: ${terminal.name}`);
        this.shellIntegration.set(terminal, true);
        const execution = e.execution;
        const cmd = execution.commandLine?.value ?? '';
        const cwd = execution.cwd?.fsPath ?? '';
        
        // Scan for Jira IDs in the command itself or branch-related git commands
        this.scanForJiraId(cmd);
        
        const termId = this.getTerminalId(terminal);

        const id = generateId();
        this.buffers.set(terminal, {
          id,
          cmd,
          cwd,
          output: '',
          startTime: Date.now(),
        });

        const h = this.history.get(termId) || [];
        h.push({ cmd });
        if (h.length > this.historyLimit) { h.shift(); }
        this.history.set(termId, h);

        const isAgentRun = this.hasAgentActivity(terminal, Date.now());
        this._onCommandStart.fire({ id, cmd, cwd, terminalId: termId, terminalName: terminal.name, isAgentRun });
        this.readExecutionOutput(terminal, execution);
      }),
    );

    // ── Shell Integration: command end ──────────────────────────────────
    this.disposables.push(
      vscode.window.onDidEndTerminalShellExecution((e) => {
        const terminal = e.terminal;
        console.log(`[Terminal Buddy] Shell Execution ENDED: ${terminal.name} (Code: ${e.exitCode})`);
        const buffer = this.buffers.get(terminal);
        if (!buffer) { return; }

        const exitCode = e.exitCode ?? null;
        const status = (exitCode === 0 || exitCode === null) ? 'ok' : 'error';
        
        const entry: CommandEntry = {
          id: buffer.id,
          cmd: redact(buffer.cmd),
          cwd: buffer.cwd,
          project: this.extractProjectName(buffer.cwd),
          status,
          exitCode,
          tag: tagCommand(buffer.cmd),
          timestamp: buffer.startTime,
          isAgentRun: this.detectAgentRun(terminal, buffer.startTime),
          errorOutput: status === 'error' ? stripAnsi(buffer.output).substring(0, MAX_ERROR_OUTPUT_LENGTH) : undefined,
          durationMs: Date.now() - buffer.startTime,
          terminalId: this.getTerminalId(terminal),
          terminalName: terminal.name,
        };

        const isMeaningful = this.isMeaningfulCommand(buffer.cmd);
        const cleaned = this.cleanRawCommand(buffer.cmd).toLowerCase();
        const isTrigger = ['buddy', 'check', 'zenith'].includes(cleaned);

        if (isTrigger) {
          this._onBuddyTrigger.fire({ terminal, cmd: cleaned });
          // Also fire as a successful command for history, or suppress?
          // Let's suppress "trigger" commands from history to keep it clean.
        } else if (isMeaningful) {
          this._onCommandFinished.fire(entry);
        }
        this.buffers.delete(terminal);
      }),
    );

    // ── Terminal closed: finalize any pending command ────────────────────
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        const termId = this.terminalIds.get(terminal);
        const buffer = this.buffers.get(terminal);
        if (buffer) {
          const entry: CommandEntry = {
            id: generateId(),
            cmd: buffer.cmd,
            cwd: buffer.cwd,
            project: this.extractProjectName(buffer.cwd),
            status: 'warning',
            exitCode: null,
            tag: tagCommand(buffer.cmd),
            timestamp: buffer.startTime,
            isAgentRun: this.detectAgentRun(terminal, buffer.startTime),
            errorOutput: 'Terminal closed before command finished',
            terminalId: termId || 'unknown',
            terminalName: terminal.name,
          };
          if (this.isMeaningfulCommand(buffer.cmd)) {
            this._onCommandFinished.fire(entry);
          }
          this.buffers.delete(terminal);
        }
        this.debounceTimers.delete(terminal);
        this.terminalIds.delete(terminal);
        this.shellIntegration.delete(terminal);
        if (termId) {
          this.purposeCache.delete(termId);
          this.history.delete(termId);
          this.pendingPurposeRequests.delete(termId);
        }
        if (this.lastBuddyTerminal === terminal) {
          this.lastBuddyTerminal = undefined;
        }
      }),
    );

    // ── Fallback: Raw Terminal Data (for non-integrated shells) ─────────
    if (typeof (vscode.window as any).onDidWriteTerminalData === 'function') {
      try {
        this.disposables.push(
          (vscode.window as any).onDidWriteTerminalData((e: any) => {
            const terminal = e.terminal;
            if (this.shellIntegration.get(terminal)) { return; }
            
            let buf = this.buffers.get(terminal);
            if (!buf) {
              buf = {
                id: generateId(),
                cmd: '(Raw Stream)',
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
                output: '',
                startTime: Date.now(),
              };
              this.buffers.set(terminal, buf);
            }

            const rawData = e.data;
            const text = stripAnsi(rawData);
            buf.output += text;

            this._onData.fire({ terminal, data: text });

            if (buf.output.length > MAX_BUFFER_SIZE) {
              buf.output = buf.output.slice(-MAX_BUFFER_SIZE / 2);
            }

            if (this.debounceTimers.has(terminal)) {
              clearTimeout(this.debounceTimers.get(terminal)!);
            }

            this.debounceTimers.set(terminal, setTimeout(() => {
              this.finalizeRawBuffer(terminal);
            }, DEBOUNCE_TERMINAL_MS * 5)); // ⚡ Performance: 500ms delay instead of 1000ms
          }),
        );
      } catch (err) {
        console.warn('[Terminal Buddy] Raw data fallback disabled due to API restriction.');
      }
    }

    // ── Shell integration availability notification ─────────────────────
    this.disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration((e) => {
        this.shellIntegration.set(e.terminal, true);
      }),
    );
  }

  private finalizeRawBuffer(terminal: vscode.Terminal): void {
    const buffer = this.buffers.get(terminal);
    if (!buffer || this.shellIntegration.get(terminal)) { return; }

    const output = buffer.output;
    const hasError = /error|failed|exception|not recognized|not found/i.test(output);
    
    const isMeaningful = this.isMeaningfulCommand(output);
    if (!isMeaningful) { 
      // Reset for next potential command
      buffer.id = generateId();
      buffer.output = '';
      buffer.startTime = Date.now();
      return; 
    }

    const entry: CommandEntry = {
      id: buffer.id,
      cmd: this.cleanRawCommand(output),
      cwd: buffer.cwd,
      project: this.extractProjectName(buffer.cwd),
      status: hasError ? 'error' : 'ok',
      exitCode: hasError ? 1 : 0,
      tag: 'other',
      timestamp: buffer.startTime,
      isAgentRun: this.detectAgentRun(terminal, buffer.startTime),
      errorOutput: hasError ? this.extractErrorOutput(output) : undefined,
    };

    if (entry.cmd.length > 0) {
      this._onCommandFinished.fire(entry);
    }
    
    buffer.id = generateId();
    buffer.output = '';
    buffer.startTime = Date.now();
  }

  public getActiveCommands(): ActiveCommand[] {
    return Array.from(this.buffers.entries()).map(([terminal, b]) => ({
      id: b.id,
      cmd: b.cmd,
      cwd: b.cwd,
      startTime: b.startTime,
      terminalId: this.getTerminalId(terminal),
      terminalName: terminal.name,
    }));
  }

  public getAllTerminals(): any[] {
    return vscode.window.terminals.map(t => {
      const buffer = this.buffers.get(t);
      const isFocused = vscode.window.activeTerminal === t;
      const termId = this.getTerminalId(t);
      return {
        id: termId,
        name: t.name,
        active: isFocused,
        isExecuting: !!buffer,
        purpose: this.getCachedPurpose(termId, t, buffer),
        port: this.portMonitor?.getPorts().find((p: any) => p.processId === (t as any).processId)?.port,
      };
    });
  }

  private getCachedPurpose(id: string, terminal: vscode.Terminal, buffer?: ExecutionBuffer): string {
    const heuristic = this.guessTerminalPurpose(terminal, buffer);
    if (heuristic !== 'Idle Terminal') {
      return heuristic;
    }
    
    const cached = this.purposeCache.get(id);
    if (cached) {
      return cached;
    }

    if (this.aiClient && !this.pendingPurposeRequests.has(id)) {
      this.pendingPurposeRequests.add(id);
      const history = (this.history.get(id) || []).slice(-3).map(h => h.cmd).join('\n');
      this.aiClient.describeTerminal(terminal.name, history).then((desc: string) => {
        this.purposeCache.set(id, desc);
        this.pendingPurposeRequests.delete(id);
      }).catch(() => {
        this.pendingPurposeRequests.delete(id);
      });
    }

    if (this.pendingPurposeRequests.has(id)) {
      return 'Analyzing...';
    }

    return 'Idle Terminal';
  }

  private guessTerminalPurpose(terminal: vscode.Terminal, buffer?: ExecutionBuffer): string {
    if (buffer) {
      const cmd = buffer.cmd.toLowerCase();
      if (cmd.includes('dev') || cmd.includes('start')) { return 'Development Server'; }
      if (cmd.includes('test')) { return 'Running Tests'; }
      if (cmd.includes('build')) { return 'Building Project'; }
      if (cmd.includes('git')) { return 'Git Operations'; }
    }
    const name = terminal.name.toLowerCase();
    if (name.includes('node') || name.includes('npm')) { return 'JavaScript Runtime'; }
    if (name.includes('python')) { return 'Python Environment'; }
    if (name.includes('zsh') || name.includes('bash') || name.includes('fish')) { return 'Interactive Shell'; }
    return 'Idle Terminal';
  }

  public stopCommand(id: string): void {
    for (const [terminal, buffer] of this.buffers.entries()) {
      if (buffer.id === id) {
        terminal.sendText('\x03');
        return;
      }
    }
  }

  private async readExecutionOutput(
    terminal: vscode.Terminal,
    execution: vscode.TerminalShellExecution,
  ): Promise<void> {
    const buffer = this.buffers.get(terminal);
    if (!buffer) { return; }

    try {
      const stream = execution.read();
      if (!stream) { return; }

      for await (const chunk of stream as AsyncIterable<string>) {
        if (!this.buffers.has(terminal)) { break; }

        // 🛡️ Stability: Limit processing frequency for extremely fast outputs
        if (chunk.length > 50000) {
          // Large chunk detected - likely a log dump. 
          // Truncate to avoid blocking the extension host thread with regex/redaction
          const text = chunk.slice(0, 10000) + '\n... [Buddy: Large Output Truncated] ...\n' + chunk.slice(-10000);
          this.processChunk(terminal, buffer, text);
        } else {
          this.processChunk(terminal, buffer, chunk);
        }
      }
    } catch { }
  }

  private processChunk(terminal: vscode.Terminal, buffer: ExecutionBuffer, text: string): void {
    if (/[Pp]assword:|PASS[:=]|SECRET[:=]/i.test(text)) {
        this._onSensitivityDetected.fire(terminal);
        return; 
    }

    if (buffer.output.length + text.length > MAX_BUFFER_SIZE) {
      buffer.output = (buffer.output + text).slice(-MAX_BUFFER_SIZE);
    } else {
      buffer.output += text;
    }
  }

  private extractErrorOutput(output: string): string {
    const lines = output.trim().split('\n');
    const lastLines = lines.slice(-30);
    const joined = lastLines.join('\n');
    return joined.length > MAX_ERROR_OUTPUT_LENGTH
      ? joined.slice(-MAX_ERROR_OUTPUT_LENGTH)
      : joined;
  }

  private extractProjectName(cwd: string): string {
    if (!cwd) { return 'unknown'; }
    const parts = cwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  private detectAgentRun(terminal: vscode.Terminal, startTime: number): boolean {
    if (this.lastBuddyTerminal === terminal) {
      return true;
    }
    
    // Heuristic: If commands start less than 1.5s after the previous one ended, it's likely an agent
    const lastTime = this.lastCommandTime.get(terminal) || 0;
    const isRapid = (startTime - lastTime) < 1500;
    
    this.lastCommandTime.set(terminal, Date.now());
    
    if (isRapid) {
      this.agentDetected.set(terminal, true);
    }
    
    return this.agentDetected.get(terminal) || false;
  }

  private hasAgentActivity(terminal: vscode.Terminal, now: number): boolean {
     if (this.lastBuddyTerminal === terminal) { return true; }
     const lastTime = this.lastCommandTime.get(terminal) || 0;
     if ((now - lastTime) < 1500) {
        this.agentDetected.set(terminal, true);
        return true;
     }
     return this.agentDetected.get(terminal) || false;
  }

  private scanForJiraId(text: string): void {
    // Regex for typical Jira keys: PROJ-123
    const jiraRegex = /\b([A-Z][A-Z0-9]+-[0-9]+)\b/g;
    const matches = text.match(jiraRegex);
    if (matches) {
      matches.forEach(id => this._onJiraIssueDetected.fire(id));
    }
  }

  dispose(): void {
    this._onCommandFinished.dispose();
    this._onCommandStart.dispose();
    this._onWrongDirectory.dispose();
    this._onData.dispose();
    this._onSensitivityDetected.dispose();
    this._onJiraIssueDetected.dispose();
    this.buffers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.terminalIds.clear();
    this.shellIntegration.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private cleanRawCommand(raw: string): string {
    // 🧠 Strip common prompts from the start/end of raw buffer captures
    // Patterns: C:\Users\Asus> or (ps) C:\Users\Asus> or user@host:~$
    let c = raw.trim();
    c = c.replace(/^[(\w+)]?\s*[A-Z]:\\[^>]*>\s*/i, ''); // Windows CMD/PS prompt
    c = c.replace(/^[\w.-]+@[\w.-]+:?[^$#]*[$#]\s*/, ''); // POSIX prompt
    if (c.length > 100) { c = c.substring(0, 100) + '...'; }
    return c || '(Raw Output)';
  }

  private isMeaningfulCommand(cmd: string): boolean {
    const c = cmd.trim();
    if (!c) { return false; }
    
    // Very short commands often used in terminal
    const shortWhitelist = ['g', 'l', 'ls', 'cd', 'vi', 'rm', 'cp', 'mv', 'ps', 'df', 'du', 'hi'];
    if (shortWhitelist.includes(c.toLowerCase())) { return true; }

    const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'test', 'foo', 'bar', 'ping'];
    if (greetings.includes(c.toLowerCase())) { return true; }

    // Strip common prompt leftovers before length check
    const cleaned = c.replace(/[A-Z]:\\[^>]*>/gi, '').trim();
    if (cleaned.length < 2) { return false; }
    
    if (c.startsWith('\x1b')) { return false; } 
    if (c.includes('\ufffd')) { return false; } 
    return true;
  }
}
