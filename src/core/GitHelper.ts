import { execFile } from 'node:child_process';
import { GitStatus, GIT_TIMEOUT_MS, GIT_CACHE_TTL_MS } from '../types';

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS);

    execFile('git', args, {
      cwd,
      signal: controller.signal,
      maxBuffer: 1024 * 1024, // 1MB
      windowsHide: true,
    }, (err, stdout) => {
      clearTimeout(timeout);
      if (err) { reject(err); }
      else { resolve(stdout.trim()); }
    });
  });
}

export class GitHelper {
  private cache: { status: GitStatus; path: string; at: number } | null = null;
  private gitAvailable: boolean | null = null;

  async isGitInstalled(): Promise<boolean> {
    if (this.gitAvailable !== null) { return this.gitAvailable; }
    try {
      await execGit(['--version'], '.');
      this.gitAvailable = true;
    } catch {
      this.gitAvailable = false;
    }
    return this.gitAvailable;
  }

  async getStatus(cwd: string): Promise<GitStatus | null> {
    if (!cwd) { return null; }

    // Check cache
    if (this.cache && this.cache.path === cwd && Date.now() - this.cache.at < GIT_CACHE_TTL_MS) {
      return this.cache.status;
    }

    if (!await this.isGitInstalled()) { return null; }

    try {
      // Check if this is a git repo
      await execGit(['-C', cwd, 'rev-parse', '--git-dir'], cwd);
    } catch {
      return null; // Not a git repo
    }

    try {
      // Branch name
      let branch = 'unknown';
      let isDetached = false;
      try {
        branch = await execGit(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        if (branch === 'HEAD') {
          isDetached = true;
          // Get short SHA instead
          const sha = await execGit(['-C', cwd, 'rev-parse', '--short', 'HEAD'], cwd);
          branch = `detached@${sha}`;
        }
      } catch { /* empty repo */ }

      const isMainOrMaster = branch === 'main' || branch === 'master';

      // Uncommitted files list
      let uncommittedCount = 0;
      let uncommittedFiles: { status: string, path: string }[] = [];
      try {
        const porcelain = await execGit(['-C', cwd, 'status', '--porcelain'], cwd);
        if (porcelain) {
          const lines = porcelain.split('\n').filter(Boolean);
          uncommittedCount = lines.length;
          uncommittedFiles = lines.map(line => ({
            status: line.substring(0, 2).trim(),
            path: line.substring(3).trim()
          }));
        }
      } catch { /* */ }

      // Ahead/behind counts
      let aheadCount = 0;
      let behindCount = 0;
      if (!isDetached) {
        try {
          const counts = await execGit(
            ['-C', cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{u}'],
            cwd,
          );
          const parts = counts.split(/\s+/);
          aheadCount = parseInt(parts[0], 10) || 0;
          behindCount = parseInt(parts[1], 10) || 0;
        } catch {
          // No upstream set — that's ok
        }
      }

      // Conflicts
      let hasConflicts = false;
      try {
        const conflicts = await execGit(
          ['-C', cwd, 'diff', '--name-only', '--diff-filter=U'],
          cwd,
        );
        hasConflicts = conflicts.length > 0;
      } catch { /* */ }

      // Last commit
      let lastCommitMessage = '';
      let lastCommitTime = '';
      try {
        const log = await execGit(
          ['-C', cwd, 'log', '-1', '--format=%s|%cr'],
          cwd,
        );
        const parts = log.split('|');
        lastCommitMessage = parts[0] ?? '';
        lastCommitTime = parts.slice(1).join('|') ?? '';
      } catch { /* empty repo */ }

      const status: GitStatus = {
        branch,
        isDetached,
        isMainOrMaster,
        uncommittedCount,
        uncommittedFiles,
        aheadCount,
        behindCount,
        hasConflicts,
        lastCommitMessage,
        lastCommitTime,
        remoteUrl: await this.getRemoteUrl(cwd) || undefined
      };

      this.cache = { status, path: cwd, at: Date.now() };
      return status;

    } catch {
      return null;
    }
  }

  getSuggestions(status: GitStatus): { cmd: string; label: string; reason: string }[] {
    const suggestions: { cmd: string; label: string; reason: string }[] = [];

    if (status.uncommittedCount > 0) {
      suggestions.push({
        cmd: 'git add -A && git commit -m ""',
        label: 'Commit all changes',
        reason: `You have ${status.uncommittedCount} uncommitted file(s).`,
      });
    }

    if (status.aheadCount > 0) {
      suggestions.push({
        cmd: 'git push origin HEAD',
        label: 'Push commits',
        reason: `You're ${status.aheadCount} commit(s) ahead of remote.`,
      });
    }

    if (status.behindCount > 0) {
      suggestions.push({
        cmd: 'git pull --rebase',
        label: 'Pull latest changes',
        reason: `You're ${status.behindCount} commit(s) behind remote.`,
      });
    }

    if (status.isMainOrMaster && !status.isDetached) {
      suggestions.push({
        cmd: 'git checkout -b feature/',
        label: 'Create a feature branch',
        reason: `You're on ${status.branch} — consider working on a feature branch.`,
      });
    }

    if (status.hasConflicts) {
      suggestions.push({
        cmd: 'git diff --name-only --diff-filter=U',
        label: 'View conflicting files',
        reason: 'You have merge conflicts that need resolving.',
      });
    }

    return suggestions;
  }

  async getDetailedTree(cwd: string): Promise<any> {
    if (!cwd) return null;
    try {
      // Get all tracked and untracked files with status
      const porcelain = await execGit(['-C', cwd, 'status', '--porcelain', '-uall'], cwd);
      const lines = porcelain.split('\n').filter(Boolean);
      
      const tree: any = { name: 'root', children: {}, status: 'clean' };

      for (const line of lines) {
        const status = line.substring(0, 2).trim() || '??';
        const relPath = line.substring(3).trim();
        const parts = relPath.split(/[\\\/]/);
        
        let curr = tree;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!curr.children[part]) {
            curr.children[part] = { 
              name: part, 
              children: i === parts.length - 1 ? null : {}, 
              status: 'clean' 
            };
          }
          // Propagate status up
          if (status !== 'clean') {
            curr.children[part].status = status;
            curr.status = 'modified'; // Parent is modified if child is
          }
          curr = curr.children[part];
        }
      }

      return this.simplifyTree(tree);
    } catch {
      return null;
    }
  }

  private simplifyTree(node: any): any {
    if (!node.children) return { name: node.name, status: node.status };
    
    return {
      name: node.name,
      status: node.status,
      children: Object.values(node.children).map(c => this.simplifyTree(c))
    };
  }

  async getRemoteUrl(cwd: string): Promise<string | null> {
    if (!cwd) return null;
    try {
      const url = await execGit(['-C', cwd, 'remote', 'get-url', 'origin'], cwd);
      // Convert git@github.com:User/Repo.git to https://github.com/User/Repo
      if (url.startsWith('git@')) {
        return url.replace(':', '/').replace('git@', 'https://').replace(/\.git$/, '');
      }
      return url.replace(/\.git$/, '');
    } catch {
      return null;
    }
  }
}
