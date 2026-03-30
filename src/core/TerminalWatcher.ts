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
  if (/^(jest|vitest|pytest|mocha|npm\s+test|yarn\s+test|npx\s+jest)/.test(c)) { return 'test'; }
  if (/^(npm\s+run\s+build|yarn\s+build|tsc|vite\s+build|next\s+build|webpack|rollup)/.test(c)) { return 'build'; }
  if (/^git\s/.test(c)) { return 'git'; }
  if (/^(npm\s+(install|i|ci)|yarn\s+(add|install)|pnpm\s+(add|install|i)|pip\s+install|cargo\s+add)/.test(c)) { return 'install'; }
  if (/^(npm\s+(run\s+dev|start|run\s+start)|yarn\s+(dev|start)|node\s|python\s|cargo\s+run|go\s+run)/.test(c)) { return 'run'; }
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

  private readonly disposables: vscode.Disposable[] = [];
  private readonly buffers = new Map<vscode.Terminal, ExecutionBuffer>();
  private readonly terminalIds = new Map<vscode.Terminal, string>();
  private shellIntegrationAvailable = false;
  private debounceTimers = new Map<vscode.Terminal, NodeJS.Timeout>();

  private getTerminalId(terminal: vscode.Terminal): string {
    if (!this.terminalIds.has(terminal)) {
      // Creation time isn't explicitly available, so we use current time when first seen
      const id = `term-${terminal.name}-${Date.now()}`;
      this.terminalIds.set(terminal, id);
    }
    return this.terminalIds.get(terminal)!;
  }

  constructor() {
    // ── Shell Integration: command start ────────────────────────────────
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution(async (e) => {
        this.shellIntegrationAvailable = true;
        const terminal = e.terminal;
        // e.execution is TerminalShellExecution — has commandLine, cwd, read()
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

        this._onCommandStart.fire({ id, cmd, cwd, terminalId: termId, terminalName: terminal.name });

        // Read output stream from the execution object
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
          isAgentRun: this.detectAgentRun(),
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
            isAgentRun: this.detectAgentRun(),
            errorOutput: 'Terminal closed before command finished',
          };
          if (this.isMeaningfulCommand(buffer.cmd)) {
            this._onCommandFinished.fire(entry);
          }
          this.buffers.delete(terminal);
        }
        this.debounceTimers.delete(terminal);
      }),
    );

    // ── Fallback: Raw Terminal Data (for non-integrated shells) ─────────
    this.disposables.push(
      (vscode.window as any).onDidWriteTerminalData((e: any) => {
        if (this.shellIntegrationAvailable) { return; } // Skip fallback if integration is active
        
        const terminal = e.terminal;
        let buf = this.buffers.get(terminal);
        if (!buf) {
          buf = {
            id: generateId(),
            cmd: '(Raw Stream)', // We can't easily distinguish command from output here
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

        // Cap buffer
        if (buf.output.length > MAX_BUFFER_SIZE) {
          buf.output = buf.output.slice(-MAX_BUFFER_SIZE / 2);
        }

        // Debounce: If no data for X ms, consider the command "finished" if output has error patterns
        if (this.debounceTimers.has(terminal)) {
          clearTimeout(this.debounceTimers.get(terminal)!);
        }

        this.debounceTimers.set(terminal, setTimeout(() => {
          this.finalizeRawBuffer(terminal);
        }, DEBOUNCE_TERMINAL_MS * 10)); // Longer debounce for raw stream
      }),
    );

    // ── Shell integration availability notification ─────────────────────
    this.disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration((e) => {
        this.shellIntegrationAvailable = true;
      }),
    );
  }

  private finalizeRawBuffer(terminal: vscode.Terminal): void {
    const buffer = this.buffers.get(terminal);
    if (!buffer || this.shellIntegrationAvailable) { return; }

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
        isAgentRun: false,
        errorOutput: this.extractErrorOutput(output),
      };
      this._onCommandFinished.fire(entry);
    }
    
    // Refresh buffer for next stream
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

  public stopCommand(id: string): void {
    for (const [terminal, buffer] of this.buffers.entries()) {
      if (buffer.id === id) {
        // Send Ctrl+C (Interrupt) to the terminal
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

      for await (const chunk of stream as AsyncIterable<any>) {
        if (!this.buffers.has(terminal)) { break; } // terminal or command gone

        const text = typeof chunk === 'string' ? chunk : String(chunk);
        const cleaned = redact(stripAnsi(text));
        
        this._onData.fire({ terminal, data: cleaned });

        // Cap buffer size to prevent memory issues
        if (buffer.output.length + cleaned.length > MAX_BUFFER_SIZE) {
          buffer.output = buffer.output.slice(-MAX_BUFFER_SIZE / 2) + cleaned.slice(0, MAX_BUFFER_SIZE / 2);
        } else {
          buffer.output += cleaned;
        }
      }
    } catch {
      // Stream may close unexpectedly — that's ok
    }
  }

  private extractErrorOutput(output: string): string {
    const lines = output.trim().split('\n');
    const lastLines = lines.slice(-30); // Last 30 lines for context
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

  private detectAgentRun(): boolean {
    // Heuristic: if no terminal is "active" (focused by user), it's likely agent-run
    const activeTerminal = vscode.window.activeTerminal;
    return !activeTerminal;
  }

  dispose(): void {
    this._onCommandFinished.dispose();
    this._onWrongDirectory.dispose();
    this.buffers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private isMeaningfulCommand(cmd: string): boolean {
    const c = cmd.trim();
    if (!c) return false;
    // Allow greetings and common short inputs
    const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'test', 'foo', 'bar', 'ping'];
    if (greetings.includes(c.toLowerCase())) return true;
    
    if (c.length < 2 && !['l', 'p', 's', 'w', 'q'].includes(c)) return false; 
    if (c.startsWith('\x1b')) return false; 
    if (c.includes('\ufffd')) return false; 
    return true;
  }
}
