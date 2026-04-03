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
    if (!dir || !fs.existsSync(dir)) return [];

    const executables: Executable[] = [];
    const rootDir = dir;

    // 2. Recursive scan for all files
    const walk = (currentDir: string, depth: number = 0) => {
      if (depth > 5) return;
      try {
        const files = fs.readdirSync(currentDir);
        
        // Find group name relative to root
        const relative = path.relative(rootDir, currentDir);
        const group = relative === '' ? 'Root' : relative;

        for (const file of files) {
          const fullPath = path.join(currentDir, file);
          const stats = fs.statSync(fullPath);
          
          if (stats.isDirectory()) {
            if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'venv' || file === '.venv' || file === 'build' || file === 'target') continue;
            walk(fullPath, depth + 1);
            continue;
          }

          const ext = path.extname(file).toLowerCase();
          
          if (file === 'package.json') {
             try {
               const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
               if (pkg.scripts) {
                 for (const [name] of Object.entries(pkg.scripts)) {
                   executables.push({
                     name: `npm run ${name}`,
                     path: fullPath,
                     type: 'npm',
                     command: `npm run ${name}`,
                     group: group
                   });
                 }
               }
             } catch (e) {}
          } else if (ext === '.py') {
            executables.push({
              name: file,
              path: fullPath,
              type: 'python',
              command: process.platform === 'win32' ? `python "${fullPath}"` : `python3 "${fullPath}"`,
              group: group
            });
          } else if (ext === '.go' && !file.endsWith('_test.go')) {
            executables.push({
              name: `Go: ${file}`,
              path: fullPath,
              type: 'go',
              command: `go run "${fullPath}"`,
              group: group
            });
          } else if (file === 'docker-compose.yml' || file === 'docker-compose.yaml') {
            executables.push({
              name: 'Docker Compose Up',
              path: fullPath,
              type: 'binary',
              command: 'docker-compose up -d',
              group: group
            });
          } else if (file === 'Makefile') {
            executables.push({
              name: `Make (${file})`,
              path: fullPath,
              type: 'script',
              command: 'make',
              group: group
            });
          } else if (['.sh', '.bat', '.ps1'].includes(ext)) {
            executables.push({
              name: file,
              path: fullPath,
              type: 'script',
              command: process.platform === 'win32' ? `"${fullPath}"` : `./"${file}"`,
              group: group
            });
          }
        }
      } catch (err) {
        // Skip inaccessible directories
      }
    };

    walk(dir);
    return executables;
  }
}
