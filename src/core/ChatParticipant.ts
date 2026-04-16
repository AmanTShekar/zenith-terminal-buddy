import * as vscode from 'vscode';
import { CommandLogger } from './CommandLogger';
import { GitHelper } from './GitHelper';
import { AIClient } from '../ai/AIClient';

export class ChatParticipant {
  constructor(
    private logger: CommandLogger,
    private git: GitHelper,
    private ai: AIClient
  ) {}

  public async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (request.command === 'explain') {
      await this.handleExplain(stream, token);
    } else if (request.command === 'fix') {
      await this.handleFix(stream, token);
    } else if (request.command === 'status') {
      await this.handleStatus(stream, token);
    } else {
      stream.markdown('I am your **Terminal Buddy**! Try these commands: \n- `/explain`: Analyze the last error \n- `/fix`: Suggest a code fix \n- `/status`: Project health check');
    }
  }

  private async handleExplain(stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
    const lastError = this.logger.getRecent(10).find(e => e.status === 'error');
    if (!lastError) {
      stream.markdown('No recent terminal errors found to explain! ✨');
      return;
    }

    stream.progress('Analyzing terminal output...');
    const explanation = await this.ai.explain(lastError);
    
    if (explanation) {
      stream.markdown(`### Analysis of \`${lastError.cmd}\`\n\n`);
      stream.markdown(`**Summary**: ${explanation.summary}\n\n`);
      stream.markdown(`**Cause**: ${explanation.cause}\n\n`);
      stream.markdown(`**Suggested Fix**: ${explanation.fix}\n\n`);
      
      if (explanation.suggestedCommands?.length) {
        stream.markdown('**Suggested Commands**:\n');
        explanation.suggestedCommands.forEach(cmd => stream.button({ command: 'workbench.action.terminal.sendSequence', arguments: [{ text: cmd }], title: `Run ${cmd}` }));
      }
    }
  }

  private async handleFix(stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
    stream.markdown('I recommend checking the **Buddy Dashboard** for deep code fixes, or try running the suggested commands from `/explain`!');
  }

  private async handleStatus(stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
    const stats = this.logger.getStats();
    const git = await this.git.getStatus(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
    
    stream.markdown(`### 📊 Project Health\n\n`);
    stream.markdown(`- **Total Commands**: ${stats.total}\n`);
    stream.markdown(`- **Success Rate**: ${Math.round(stats.successRate * 100)}%\n`);
    stream.markdown(`- **Current Branch**: \`${git?.branch || 'unknown'}\`\n`);
    stream.markdown(`- **Uncommitted Changes**: ${git?.uncommittedCount || 0}\n`);
    
    if (git?.hasConflicts) {
      stream.markdown('\n⚠️ **Merge conflicts detected!** Fix them before pushing.');
    }
  }
}
