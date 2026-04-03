import * as vscode from 'vscode';
import {
  CommandEntry, CommandStatus, CommandTag, ActiveCommand,
  MAX_BUFFER_SIZE, MAX_ERROR_OUTPUT_LENGTH, DEBOUNCE_TERMINAL_MS,
} from '../types';
import { redact } from './RedactionUtils';

// Comprehensive ANSI escape sequence stripper
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

function stripAnsi(str: string): string {
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

  private readonly _onCommandStart = new vscode.EventEmitter<{ id: string; cmd: string; cwd: string; terminalId: string; terminalName: string }>();
  public readonly onCommandStart = this._onCommandStart.event;

  private readonly _onWrongDirectory = new vscode.EventEmitter<{ cmd: string; correctPath: string }>();
  public readonly onWrongDirectory = this._onWrongDirectory.event;

  private readonly _onData = new vscode.EventEmitter<{ terminal: vscode.Terminal; data: string }>();
  public readonly onData = this._onData.event;

  private readonly _onSensitivityDetected = new vscode.EventEmitter<vscode.Terminal>();
  public readonly onSensitivityDetected = this._onSensitivityDetected.event;

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
        this.shellIntegration.set(terminal, true);
        const execution = e.execution;
        const cmd = execution.commandLine?.value ?? '';
        const cwd = execution.cwd?.fsPath ?? '';
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

        this._onCommandStart.fire({ id, cmd, cwd, terminalId: termId, terminalName: terminal.name });
        this.readExecutionOutput(terminal, execution);
      }),
    );

    // ── Shell Integration: command end ──────────────────────────────────
    this.disposables.push(
      vscode.window.onDidEndTerminalShellExecution((e) => {
        const terminal = e.terminal;
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
          isAgentRun: this.detectAgentRun(terminal),
          errorOutput: status === 'error' ? stripAnsi(buffer.output).substring(0, MAX_ERROR_OUTPUT_LENGTH) : undefined,
          durationMs: Date.now() - buffer.startTime,
          terminalId: this.getTerminalId(terminal),
          terminalName: terminal.name,
        };

        if (this.isMeaningfulCommand(buffer.cmd)) {
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
            isAgentRun: this.detectAgentRun(terminal),
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
        }, DEBOUNCE_TERMINAL_MS * 10));
      }),
    );

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
    
    if (hasError && this.isMeaningfulCommand(output)) {
       const entry: CommandEntry = {
        id: buffer.id,
        cmd: '(Output Analysis)',
        cwd: buffer.cwd,
        project: this.extractProjectName(buffer.cwd),
        status: 'error',
        exitCode: 1,
        tag: 'other',
        timestamp: buffer.startTime,
        isAgentRun: this.detectAgentRun(terminal),
        errorOutput: this.extractErrorOutput(output),
      };
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

        const text = chunk;
        if (/[Pp]assword:|PASS[:=]|SECRET[:=]/i.test(text)) {
            this._onSensitivityDetected.fire(terminal);
            continue; 
        }

        if (buffer.output.length + text.length > MAX_BUFFER_SIZE) {
          buffer.output = (buffer.output + text).slice(-MAX_BUFFER_SIZE);
        } else {
          buffer.output += text;
        }
      }
    } catch { }
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

  private detectAgentRun(terminal: vscode.Terminal): boolean {
    return this.lastBuddyTerminal === terminal;
  }

  dispose(): void {
    this._onCommandFinished.dispose();
    this._onCommandStart.dispose();
    this._onWrongDirectory.dispose();
    this._onData.dispose();
    this._onSensitivityDetected.dispose();
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

  private isMeaningfulCommand(cmd: string): boolean {
    const c = cmd.trim();
    if (!c) { return false; }
    const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'test', 'foo', 'bar', 'ping'];
    if (greetings.includes(c.toLowerCase())) { return true; }
    if (c.length < 2 && !['l', 'p', 's', 'w', 'q'].includes(c)) { return false; }
    if (c.startsWith('\x1b')) { return false; } 
    if (c.includes('\ufffd')) { return false; } 
    return true;
  }
}
