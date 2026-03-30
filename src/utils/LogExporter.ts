import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CommandEntry } from '../types';

export class LogExporter {
  public static async export(entries: CommandEntry[]): Promise<void> {
    if (entries.length === 0) {
      vscode.window.showWarningMessage('Terminal Buddy: No history to export!');
      return;
    }

    const options: vscode.SaveDialogOptions = {
      defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'terminal-history.json')),
      filters: {
        'JSON': ['json'],
        'Markdown': ['md'],
        'Text': ['txt']
      }
    };

    const fileUri = await vscode.window.showSaveDialog(options);
    if (!fileUri) return;

    try {
      let content = '';
      const ext = path.extname(fileUri.fsPath).toLowerCase();

      if (ext === '.json') {
        content = JSON.stringify(entries, null, 2);
      } else if (ext === '.md') {
        content = '# Terminal Buddy History\n\n';
        content += entries.map(e => {
          const date = new Date(e.timestamp).toLocaleString();
          let md = `## [${e.status.toUpperCase()}] ${e.cmd}\n`;
          md += `- **At**: ${date}\n`;
          md += `- **CWD**: ${e.cwd}\n`;
          if (e.errorOutput) {
            md += `\n### Error Output\n\`\`\`text\n${e.errorOutput}\n\`\`\`\n`;
          }
          return md;
        }).join('\n---\n\n');
      } else {
        content = entries.map(e => {
          return `[${new Date(e.timestamp).toLocaleString()}] [${e.status}] ${e.cmd}\n${e.errorOutput ? `ERROR: ${e.errorOutput}\n` : ''}`;
        }).join('\n');
      }

      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
      vscode.window.showInformationMessage(`Terminal Buddy: History exported to ${path.basename(fileUri.fsPath)} 📝`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Terminal Buddy: Export failed: ${err.message}`);
    }
  }
}
