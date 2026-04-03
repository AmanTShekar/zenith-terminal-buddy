import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Executable {
  name: string;
  path: string;
  type: 'script' | 'binary' | 'npm' | 'python' | 'go';
  command: string;
  group: string; // The folder name or file name to group by
}

export class ExecutableScanner {
  public async scan(dir: string): Promise<Executable[]> {
    if (!dir) { return []; }
    const uri = vscode.Uri.file(dir);
    const executables: Executable[] = [];

    const walk = async (currentUri: vscode.Uri, depth: number = 0) => {
      if (depth > 5) { return; }
      try {
        const entries = await vscode.workspace.fs.readDirectory(currentUri);
        const relative = path.relative(dir, currentUri.fsPath);
        const group = relative === '' ? 'Root' : relative;

        for (const [name, type] of entries) {
          const fullUri = vscode.Uri.joinPath(currentUri, name);

          if (type === vscode.FileType.Directory) {
            if (['node_modules', '.git', 'dist', 'venv', '.venv', 'build', 'target'].includes(name)) { 
              continue; 
            }
            await walk(fullUri, depth + 1);
            continue;
          }

          const ext = path.extname(name).toLowerCase();
          
          if (name === 'package.json') {
            try {
              const content = await vscode.workspace.fs.readFile(fullUri);
              const pkg = JSON.parse(Buffer.from(content).toString('utf8'));
              if (pkg.scripts) {
                for (const [scriptName] of Object.entries(pkg.scripts)) {
                  executables.push({
                    name: `npm run ${scriptName}`,
                    path: fullUri.fsPath,
                    type: 'npm',
                    command: `npm run ${scriptName}`,
                    group: group
                  });
                }
              }
            } catch (e) {}
          } else if (ext === '.py') {
            executables.push({
              name: name,
              path: fullUri.fsPath,
              type: 'python',
              command: process.platform === 'win32' ? `python "${fullUri.fsPath}"` : `python3 "${fullUri.fsPath}"`,
              group: group
            });
          } else if (ext === '.go' && !name.endsWith('_test.go')) {
            executables.push({
              name: `Go: ${name}`,
              path: fullUri.fsPath,
              type: 'go',
              command: `go run "${fullUri.fsPath}"`,
              group: group
            });
          } else if (name === 'docker-compose.yml' || name === 'docker-compose.yaml') {
            executables.push({
              name: 'Docker Compose Up',
              path: fullUri.fsPath,
              type: 'binary',
              command: 'docker-compose up -d',
              group: group
            });
          } else if (name === 'Makefile') {
            executables.push({
              name: `Make (${name})`,
              path: fullUri.fsPath,
              type: 'script',
              command: 'make',
              group: group
            });
          } else if (['.sh', '.bat', '.ps1'].includes(ext)) {
            executables.push({
              name: name,
              path: fullUri.fsPath,
              type: 'script',
              command: process.platform === 'win32' ? `"${fullUri.fsPath}"` : `./"${name}"`,
              group: group
            });
          }
        }
      } catch (err) {
        // Skip inaccessible directories
      }
    };

    await walk(uri);
    return executables;
  }
}
