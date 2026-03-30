import {
  Suggestion, WorkspaceMap, CommandEntry, GitStatus,
} from '../types';

function generateId(): string {
  return `sug-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

export class SuggestionEngine {
  generate(
    workspaceMap: WorkspaceMap,
    cwd: string,
    lastCommand: CommandEntry | null,
    gitStatus: GitStatus | null,
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();

    // Find the current project
    const currentProject = workspaceMap.projects.find((p) => {
      const pNorm = p.path.replace(/\\/g, '/').toLowerCase();
      return normalizedCwd.startsWith(pNorm);
    });

    // ── node_modules missing ────────────────────────────────────────────
    if (currentProject && !currentProject.hasNodeModules && currentProject.type !== 'python' && currentProject.type !== 'rust' && currentProject.type !== 'go') {
      suggestions.push({
        id: generateId(),
        cmd: 'npm install',
        label: 'Install dependencies',
        reason: 'No node_modules folder found — dependencies are not installed.',
        dir: currentProject.path,
        priority: 90,
        category: 'setup',
      });
    }

    // ── .env missing but .env.example exists ────────────────────────────
    if (currentProject && !currentProject.hasDotEnv && currentProject.hasDotEnvExample) {
      const copyCmd = process.platform === 'win32' ? 'copy .env.example .env' : 'cp .env.example .env';
      suggestions.push({
        id: generateId(),
        cmd: copyCmd,
        label: 'Create .env file',
        reason: 'Found .env.example but no .env file. Copy it to get started.',
        dir: currentProject.path,
        priority: 80,
        category: 'setup',
      });
    }

    // ── Project scripts (from package.json) ─────────────────────────────
    if (currentProject && currentProject.scripts) {
      const commonScripts = ['dev', 'start', 'build', 'test', 'lint'];
      for (const scriptName of commonScripts) {
        if (currentProject.scripts[scriptName]) {
          const priority = scriptName === 'dev' || scriptName === 'start' ? 50 : 30;
          suggestions.push({
            id: generateId(),
            cmd: `npm run ${scriptName}`,
            label: `Run "${scriptName}"`,
            reason: `Available script in package.json: ${currentProject.scripts[scriptName]}`,
            dir: currentProject.path,
            priority,
            category: 'workflow',
          });
        }
      }
    }

    // ── Git-based suggestions ───────────────────────────────────────────
    if (gitStatus) {
      if (gitStatus.uncommittedCount > 0) {
        suggestions.push({
          id: generateId(),
          cmd: 'git add -A && git commit -m ""',
          label: 'Commit changes',
          reason: `${gitStatus.uncommittedCount} uncommitted file(s).`,
          dir: cwd,
          priority: 40,
          category: 'git',
        });
      }

      if (gitStatus.aheadCount > 0) {
        suggestions.push({
          id: generateId(),
          cmd: 'git push origin HEAD',
          label: 'Push commits',
          reason: `${gitStatus.aheadCount} unpushed commit(s).`,
          dir: cwd,
          priority: 35,
          category: 'git',
        });
      }

      if (gitStatus.behindCount > 0) {
        suggestions.push({
          id: generateId(),
          cmd: 'git pull --rebase',
          label: 'Pull latest changes',
          reason: `${gitStatus.behindCount} commit(s) behind remote.`,
          dir: cwd,
          priority: 45,
          category: 'git',
        });
      }

      if (gitStatus.isMainOrMaster && !gitStatus.isDetached) {
        suggestions.push({
          id: generateId(),
          cmd: 'git checkout -b feature/',
          label: 'Create a feature branch',
          reason: `You're on ${gitStatus.branch}. Feature branches are safer.`,
          dir: cwd,
          priority: 38,
          category: 'git',
        });
      }
    }

    // ── Error-based suggestions (if last command failed) ────────────────
    if (lastCommand && lastCommand.status === 'error' && lastCommand.errorOutput) {
      const output = lastCommand.errorOutput;

      // Port in use
      const portMatch = output.match(/(?:port|EADDRINUSE).*?(\d{2,5})/i);
      if (portMatch) {
        const port = portMatch[1];
        const killCmd = process.platform === 'win32'
          ? `netstat -ano | findstr :${port}`
          : `kill -9 $(lsof -t -i :${port})`;
        suggestions.push({
          id: generateId(),
          cmd: killCmd,
          label: `Kill process on port ${port}`,
          reason: `Port ${port} is occupied by another process.`,
          dir: cwd,
          priority: 100,
          category: 'fix',
        });
      }
    }

    // ── Sort by priority and return top 5 ───────────────────────────────
    suggestions.sort((a, b) => b.priority - a.priority);
    return suggestions.slice(0, 5);
  }
}
