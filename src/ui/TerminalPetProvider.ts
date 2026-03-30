import * as vscode from 'vscode';
import { CommandLogger } from '../core/CommandLogger';

/**
 * TerminalPetProvider provides gutter decorations (emojis) for terminal commands.
 * This uses the VS Code 1.89+ Terminal Decoration API.
 */
// @ts-ignore
export class TerminalPetProvider implements vscode.TerminalDecorationProvider {
  private _onDidChangeDecorations = new vscode.EventEmitter<any>();
  readonly onDidChangeDecorations = this._onDidChangeDecorations.event;

  constructor(private readonly commandLogger: CommandLogger) {}

  // @ts-ignore
  provideTerminalDecoration(
    terminal: vscode.Terminal,
    execution: any
  ): any {
    const cmd = (execution as any).commandLine?.value || '';
    
    return {
      contentIconPath: this.getIconForExecution(cmd),
      color: new vscode.ThemeColor('terminalBuddy.petColor'),
      title: 'Terminal Buddy Status'
    };
  }

  private getIconForExecution(cmd: string): string {
    if (cmd.includes('rm ') || cmd.includes('git push') || cmd.includes('del ')) {
      return '⚠️';
    }

    const entry = this.commandLogger.getAll().find(e => e.cmd === cmd && Date.now() - e.timestamp < 2000);
    if (entry) {
      if (entry.status === 'error') return '😿';
      if (entry.status === 'ok') return '🐱';
    }

    return '🐾';
  }

  refresh() {
    this._onDidChangeDecorations.fire(undefined);
  }
}
