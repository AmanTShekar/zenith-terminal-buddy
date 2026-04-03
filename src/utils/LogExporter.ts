import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

    const homeDir = os.homedir().replace(/\\/g, '/');
    const anonymizePath = (p: string) => (p || '').replace(/\\/g, '/').replace(homeDir, '~');
    const anonymizeEntry = (e: CommandEntry) => ({
      ...e,
      cwd: anonymizePath(e.cwd),
      cmd: anonymizePath(e.cmd),
      errorOutput: e.errorOutput ? anonymizePath(e.errorOutput) : undefined,
    });

    try {
      let content = '';
      const ext = path.extname(fileUri.fsPath).toLowerCase();

      if (ext === '.json') {
        content = JSON.stringify(entries.map(anonymizeEntry), null, 2);
      } else if (ext === '.md') {
        content = '# Terminal Buddy History\n\n';
        content += entries.map(e => {
          const a = anonymizeEntry(e);
          const date = new Date(a.timestamp).toLocaleString();
          let md = `## [${a.status.toUpperCase()}] \`${a.cmd}\`\n`;
          md += `- **At**: ${date}\n`;
          md += `- **CWD**: \`${a.cwd}\`\n`;
          if (a.errorOutput) {
            md += `\n### Error Output\n\`\`\`text\n${a.errorOutput}\n\`\`\`\n`;
          }
          return md;
        }).join('\n---\n\n');
      } else {
        content = entries.map(e => {
          const a = anonymizeEntry(e);
          return `[${new Date(a.timestamp).toLocaleString()}] [${a.status}] ${a.cmd}\n${a.errorOutput ? `ERROR: ${a.errorOutput}\n` : ''}`;
        }).join('\n');
      }

      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
      vscode.window.showInformationMessage(`Terminal Buddy: History exported to ${path.basename(fileUri.fsPath)} 📝`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Terminal Buddy: Export failed: ${err.message}`);
    }
  }
}
