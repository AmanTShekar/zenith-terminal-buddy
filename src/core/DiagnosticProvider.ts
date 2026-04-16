import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CommandEntry } from '../types';

export class DiagnosticProvider {
  private diagnostics: vscode.DiagnosticCollection;

  constructor() {
    this.diagnostics = vscode.languages.createDiagnosticCollection('terminal-buddy');
  }

  public reportError(entry: CommandEntry): void {
    const errorOutput = entry.errorOutput || '';
    if (!errorOutput) { return; }

    this.diagnostics.clear(); // Clear old terminal diagnostics

    // Regex for file patterns: path/to/file.ts:25:5 or path/to/file.ts:25
    const fileRegex = /([a-zA-Z0-9._\-\/\\ ]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/g;
    let match;
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    while ((match = fileRegex.exec(errorOutput)) !== null) {
      const filePathStr = match[1];
      const line = parseInt(match[2], 10) - 1;
      const col = match[3] ? parseInt(match[3], 10) - 1 : 0;

      const absolutePath = this.resolvePath(filePathStr, entry.cwd, projectRoot);
      if (absolutePath && fs.existsSync(absolutePath)) {
        const uri = vscode.Uri.file(absolutePath);
        const range = new vscode.Range(line, col, line, col + 10);
        const diagnostic = new vscode.Diagnostic(
          range,
          `⛔ Terminal Error in '${entry.cmd}': ${errorOutput.substring(0, 500)}`,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'Terminal Buddy';
        
        const existing = this.diagnostics.get(uri) || [];
        this.diagnostics.set(uri, [...existing, diagnostic]);
      }
    }
  }

  private resolvePath(p: string, cwd: string, root?: string): string | null {
    if (path.isAbsolute(p)) { return p; }
    
    const possiblePaths = [
      path.join(cwd, p),
      root ? path.join(root, p) : null
    ].filter(Boolean) as string[];

    for (const res of possiblePaths) {
      if (fs.existsSync(res)) { return res; }
    }
    return null;
  }

  public clear(): void {
    this.diagnostics.clear();
  }
}
