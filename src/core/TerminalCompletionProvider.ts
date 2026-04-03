import * as vscode from 'vscode';
import { TerminalWatcher } from './TerminalWatcher';
import { AIClient } from '../ai/AIClient';

export class TerminalCompletionProvider {
  constructor(private terminalWatcher: TerminalWatcher, private aiClient: AIClient) {}

  provideTerminalQuickFixes(terminalHost: any, terminalCommand: any): vscode.ProviderResult<any[]> {
    // This is for quick fixes, but let's use it to suggest improvements if there was an error
    return [];
  }
}

// Note: Inline completion for terminal is a proposed API 'terminalCompletionProvider'
// and 'terminalSelection' which we enabled in package.json
export class TerminalInlineCompletionProvider {
  constructor(private terminalWatcher: TerminalWatcher, private aiClient: AIClient) {}

  async provideInlineCompletionItems(
    terminal: vscode.Terminal,
    line: string,
    context: any // vscode.TerminalInlineCompletionContext
  ): Promise<any[]> {
    if (!line || line.length < 3) return [];

    const history = this.terminalWatcher.getActiveCommands();
    const prompt = `User is typing in terminal "${terminal.name}". 
    Recent commands: ${history.map(h => h.cmd).join(', ')}
    Current line: "${line}"
    Predict the most likely completion for this command. Reply ONLY with the completion suffix (what to add to the line).`;

    const completion = await this.aiClient.callRaw(prompt);
    if (!completion || completion.startsWith('Error')) return [];

    return [{
       insertText: completion.trim(),
       range: new vscode.Range(0, line.length, 0, line.length)
    }];
  }
}
