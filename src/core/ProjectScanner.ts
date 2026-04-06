import * as vscode from 'vscode';
import {
  ProjectInfo, ProjectType, WorkspaceMap, FileNode,
  SCANNER_MAX_DEPTH,
} from '../types';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'target', '.cargo', '.idea', '.vscode',
  'coverage', '.nyc_output', '.turbo', '.cache',
]);

export class ProjectScanner {
  private map: WorkspaceMap = { rootPath: '', projects: [], scannedAt: 0 };
  private hasScanned = false;

  async scan(force = false): Promise<void> {
    if (this.hasScanned && !force && this.map.fileTree) { return; }
    
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.map = { rootPath: '', projects: [], scannedAt: Date.now() };
      this.hasScanned = true;
      return;
    }
    // ... rest of scan ...
    const rootPath = folders[0].uri.fsPath;
    const projects: ProjectInfo[] = [];
    const visited = new Set<string>();
    
    // 🌳 Build File Tree
    const tree = await this.buildFileTree(folders[0].uri, 0);

    for (const folder of folders) {
      await this.walkDirectory(folder.uri, 0, projects, visited).catch(() => {});
    }

    this.map = { rootPath, projects, fileTree: tree, scannedAt: Date.now() };
    this.hasScanned = true;
  }

  private async buildFileTree(uri: vscode.Uri, depth: number): Promise<FileNode> {
    const name = uri.fsPath.split(/[\\/]/).pop() || 'root';
    const node: FileNode = { name, type: 'directory', path: uri.fsPath, children: [] };
    
    if (depth > SCANNER_MAX_DEPTH) { return node; } // Standardized depth

    try {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      for (const [eName, type] of entries) {
        // ALLOW critical dotfiles for security visibility
        const isCriticalDotfile = eName === '.env' || eName === '.env.example';
        if (SKIP_DIRS.has(eName) || (eName.startsWith('.') && !isCriticalDotfile)) {
          continue; 
        }
        
        const childUri = vscode.Uri.joinPath(uri, eName);
        if (type === vscode.FileType.Directory) {
          node.children!.push(await this.buildFileTree(childUri, depth + 1));
        } else {
          node.children!.push({ name: eName, type: 'file', path: childUri.fsPath });
        }
      }
    } catch { }
    
    return node;
  }

  private async walkDirectory(
    dirUri: vscode.Uri,
    depth: number,
    projects: ProjectInfo[],
    visited: Set<string>,
  ): Promise<void> {
    if (depth > SCANNER_MAX_DEPTH) { return; }

    const dirPath = dirUri.fsPath;
    if (visited.has(dirPath)) { return; } // symlink loop guard
    visited.add(dirPath);

    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      const entryNames = new Set(entries.map(([name]) => name));

      // Check for project signature files
      const hasPackageJson = entryNames.has('package.json');
      const hasRequirementsTxt = entryNames.has('requirements.txt');
      const hasPyprojectToml = entryNames.has('pyproject.toml');
      const hasCargoToml = entryNames.has('Cargo.toml');
      const hasGoMod = entryNames.has('go.mod');
      const hasPomXml = entryNames.has('pom.xml');
      const hasBuildGradle = entryNames.has('build.gradle');
      const hasMakefile = entryNames.has('Makefile');
      const hasCMakeLists = entryNames.has('CMakeLists.txt');
      const hasDotEnv = entryNames.has('.env');
      const hasDotEnvExample = entryNames.has('.env.example');
      const hasNodeModules = entryNames.has('node_modules');
      const hasGit = entryNames.has('.git');
      const hasVenv = entryNames.has('venv') || entryNames.has('.venv') || entryNames.has('env');
      const hasCsProj = Array.from(entryNames).some(f => f.endsWith('.csproj') || f.endsWith('.sln'));
      const hasGemfile = entryNames.has('Gemfile') || entryNames.has('Rakefile');

      const isProject = hasPackageJson || hasRequirementsTxt || hasPyprojectToml
        || hasCargoToml || hasGoMod || hasPomXml || hasBuildGradle || hasMakefile || hasCMakeLists || hasVenv
        || hasCsProj || hasGemfile;

      if (isProject) {
        let type: ProjectType = 'unknown';
        let confidence = 0.5;
        let scripts: Record<string, string> = {};
        const detectedTools: string[] = [];

        // Parse package.json if exists
        if (hasPackageJson) {
          try {
            const pkgUri = vscode.Uri.joinPath(dirUri, 'package.json');
            const raw = await vscode.workspace.fs.readFile(pkgUri);
            const pkg = JSON.parse(Buffer.from(raw).toString('utf-8'));
            scripts = pkg.scripts ?? {};
            const allDeps = {
              ...pkg.dependencies,
              ...pkg.devDependencies,
            };

            // Detect project type from dependencies
            if (allDeps['next']) { type = 'nextjs'; confidence = 0.95; }
            else if (allDeps['react']) { type = 'react'; confidence = 0.9; }
            else if (allDeps['vue']) { type = 'vue'; confidence = 0.9; }
            else if (allDeps['@angular/core']) { type = 'angular'; confidence = 0.9; }
            else if (allDeps['svelte']) { type = 'svelte'; confidence = 0.9; }
            else if (allDeps['express'] || allDeps['fastify'] || allDeps['koa'] || allDeps['hono']) {
              type = 'node'; confidence = 0.85;
            }
            else { type = 'node'; confidence = 0.7; }

            // Detect tools
            if (allDeps['typescript'] || entryNames.has('tsconfig.json')) { detectedTools.push('typescript'); }
            if (allDeps['prisma'] || allDeps['@prisma/client']) { detectedTools.push('prisma'); }
            if (allDeps['tailwindcss']) { detectedTools.push('tailwind'); }
            if (entryNames.has('Dockerfile')) { detectedTools.push('docker'); }
            if (allDeps['eslint']) { detectedTools.push('eslint'); }
            if (allDeps['jest'] || allDeps['vitest'] || allDeps['mocha']) { detectedTools.push('testing'); }

          } catch {
            type = 'node';
            confidence = 0.5;
          }
        } else if (hasCsProj) {
          type = 'csharp'; confidence = 0.9;
        } else if (hasGemfile) {
          type = 'ruby'; confidence = 0.9;
        } else if (hasRequirementsTxt || hasPyprojectToml || hasVenv) {
          type = 'python'; confidence = 0.85;
        } else if (hasCargoToml) {
          type = 'rust'; confidence = 0.9;
        } else if (hasGoMod) {
          type = 'go'; confidence = 0.9;
        } else if (hasPomXml || hasBuildGradle) {
          type = 'java'; confidence = 0.85;
        } else if (hasCMakeLists || Array.from(entryNames).some(f => f.endsWith('.cpp') || f.endsWith('.cc'))) {
          type = 'cpp'; confidence = 0.8;
        } else if (hasMakefile || Array.from(entryNames).some(f => f.endsWith('.c'))) {
          type = 'c'; confidence = 0.8;
        }

        if (entryNames.has('Dockerfile')) { detectedTools.push('docker'); }
        if (hasGit) { detectedTools.push('git'); }

        const name = dirPath.replace(/\\/g, '/').split('/').pop() || 'unknown';

        // ── [NEW] Venv Detection ──────────────────────────────────────────
        let venvData = undefined;
        if (hasVenv || type === 'python') {
          const venvFolder = entryNames.has('.venv') ? '.venv' : (entryNames.has('venv') ? 'venv' : 'env');
          const venvPath = vscode.Uri.joinPath(dirUri, venvFolder).fsPath;
          const isWindows = process.platform === 'win32';
          const activatePath = isWindows ? `${venvFolder}/Scripts/activate` : `${venvFolder}/bin/activate`;
          const activateCmd = isWindows ? `.\\${activatePath.replace(/\//g, '\\')}` : `source ./${activatePath}`;
          
          // Robust check: Is the CURRENT process.env.VIRTUAL_ENV matching THIS venv folder?
          const currentVenv = process.env.VIRTUAL_ENV;
          const isActive = currentVenv ? (currentVenv.replace(/\\/g, '/').toLowerCase() === venvPath.replace(/\\/g, '/').toLowerCase()) : false;

          venvData = {
            exists: entryNames.has(venvFolder),
            path: venvFolder,
            isActive,
            activateCmd,
          };
        }

        // ... entry point detection ...
        const entryPoints: { label: string; path: string; cmd: string }[] = [];
        const filesArr = Array.from(entryNames);

        if (type === 'python') {
          const ep = filesArr.find((f) => ['main.py', 'app.py', 'run.py', 'manage.py'].includes(f));
          if (ep) { entryPoints.push({ label: `🐍 Run ${ep}`, path: ep, cmd: `python ${ep}` }); }
        } else if (type === 'rust') {
          entryPoints.push({ label: '🦀 Cargo Run', path: 'Cargo.toml', cmd: 'cargo run' });
          entryPoints.push({ label: '🦀 Cargo Test', path: 'Cargo.toml', cmd: 'cargo test' });
        } else if (type === 'go') {
          const hasMainGo = filesArr.includes('main.go');
          entryPoints.push({ label: '🐹 Go Run', path: hasMainGo ? 'main.go' : '.', cmd: `go run ${hasMainGo ? 'main.go' : '.'}` });
        } else if (type === 'java') {
          const ep = filesArr.find((f) => ['Main.java', 'App.java'].includes(f));
          if (ep) { entryPoints.push({ label: `☕ Run ${ep}`, path: ep, cmd: `javac ${ep} && java ${ep.replace('.java', '')}` }); }
        } else if (type === 'c' || type === 'cpp') {
          if (hasMakefile) {
            entryPoints.push({ label: '🔨 Make', path: 'Makefile', cmd: 'make' });
            entryPoints.push({ label: '🔨 Make Clean', path: 'Makefile', cmd: 'make clean' });
          } else {
            const ep = filesArr.find((f) => f.startsWith('main.') && (f.endsWith('.c') || f.endsWith('.cpp')));
            if (ep) {
              const compiler = ep.endsWith('.cpp') ? 'g++' : 'gcc';
              entryPoints.push({ label: `🔨 Build & Run ${ep}`, path: ep, cmd: `${compiler} ${ep} -o main && ./main` });
            }
          }
        } else if (type === 'node' && !hasPackageJson) {
          const ep = filesArr.find((f) => ['index.js', 'app.js', 'server.js'].includes(f));
          if (ep) { entryPoints.push({ label: `🟢 Run ${ep}`, path: ep, cmd: `node ${ep}` }); }
        } else if (type === 'csharp') {
          entryPoints.push({ label: '🎯 Dotnet Run', path: '.', cmd: 'dotnet run' });
          entryPoints.push({ label: '🎯 Dotnet Test', path: '.', cmd: 'dotnet test' });
        } else if (type === 'ruby') {
          const ep = filesArr.find((f) => ['main.rb', 'app.rb'].includes(f)) || filesArr.find(f => f.endsWith('.rb'));
          if (ep) { entryPoints.push({ label: `💎 Run ${ep}`, path: ep, cmd: `ruby ${ep}` }); }
          if (hasGemfile) { entryPoints.push({ label: '💎 Bundle Install', path: 'Gemfile', cmd: 'bundle install' }); }
        }

        projects.push({
          path: dirPath,
          name,
          type,
          confidence,
          scripts,
          hasDotEnv,
          hasDotEnvExample,
          hasNodeModules,
          hasGit,
          detectedTools: [...new Set(detectedTools)],
          topLevelFiles: filesArr.slice(0, 50),
          venv: venvData,
          entryPoints: entryPoints,
        });
      }

      // Recurse into subdirectories (limit depth to SCANNER_MAX_DEPTH)
      if (depth < SCANNER_MAX_DEPTH) {
        for (const [name, fileType] of entries) {
          if (fileType !== vscode.FileType.Directory) { continue; }
          if (SKIP_DIRS.has(name) || name === '.git') { continue; }
          
          // ALLOW critical dotfolders/dotfiles for security visibility
          const isCriticalDot = name === '.env' || name === '.env.example';
          if (name.startsWith('.') && !isCriticalDot) { continue; }

          const childUri = vscode.Uri.joinPath(dirUri, name);
          await this.walkDirectory(childUri, depth + 1, projects, visited);
        }
      }
    } catch {
      // Permission denied or other read error — skip silently
    }
  }

  getMap(): WorkspaceMap {
    return this.map;
  }

  getCurrentProject(cwd: string): ProjectInfo | null {
    if (!cwd) { return null; }
    const normalized = cwd.replace(/\\/g, '/').toLowerCase();

    // Find the most specific (longest path) project matching cwd
    let best: ProjectInfo | null = null;
    for (const p of this.map.projects) {
      const pNorm = p.path.replace(/\\/g, '/').toLowerCase();
      if (normalized.startsWith(pNorm)) {
        if (!best || p.path.length > best.path.length) {
          best = p;
        }
      }
    }
    return best;
  }

  getProjectByName(name: string): ProjectInfo | null {
    return this.map.projects.find((p) => p.name === name) ?? null;
  }
}
