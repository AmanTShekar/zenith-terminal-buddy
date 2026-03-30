import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Executable {
  name: string;
  path: string;
  type: 'script' | 'binary' | 'npm' | 'python' | 'go';
  command: string;
}

export class ExecutableScanner {
  public async scan(dir: string): Promise<Executable[]> {
    if (!dir || !fs.existsSync(dir)) return [];

    const executables: Executable[] = [];
    try {
      const files = fs.readdirSync(dir);

      // ── NPM Scripts ─────────────────────────────────────────────────────
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts) {
          for (const [name, cmd] of Object.entries(pkg.scripts)) {
            executables.push({
              name: `npm run ${name}`,
              path: pkgPath,
              type: 'npm',
              command: `npm run ${name}`
            });
          }
        }
      }

      // ── Shell Scripts & Binaries ────────────────────────────────────────
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) continue;

        const ext = path.extname(file).toLowerCase();
        
        if (process.platform === 'win32') {
          if (['.bat', '.cmd', '.ps1', '.exe'].includes(ext)) {
            executables.push({
              name: file,
              path: fullPath,
              type: ext === '.exe' ? 'binary' : 'script',
              command: file.startsWith('./') ? file : `./${file}`
            });
          }
        } else {
          // Check for unix executable bit
          try {
            fs.accessSync(fullPath, fs.constants.X_OK);
            executables.push({
              name: file,
              path: fullPath,
              type: stats.size > 100000 ? 'binary' : 'script', // Heuristic for binary vs script
              command: `./${file}`
            });
          } catch {
             // Not executable
          }
        }

        // ── Python Main ───────────────────────────────────────────────────
        if (file === 'main.py' || file === 'app.py' || file === 'manage.py') {
          executables.push({
            name: `python ${file}`,
            path: fullPath,
            type: 'python',
            command: `python ${file}`
          });
        }
      }

      // ── Go main ────────────────────────────────────────────────────────
      if (files.includes('go.mod') && (files.includes('main.go') || files.includes('cmd'))) {
        executables.push({
          name: 'go run .',
          path: path.join(dir, 'go.mod'),
          type: 'go',
          command: 'go run .'
        });
      }

    } catch (err) {
      console.error('[Terminal Buddy] Failed to scan executables:', err);
    }

    return executables;
  }
}
