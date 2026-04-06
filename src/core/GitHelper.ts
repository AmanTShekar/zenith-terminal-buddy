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
  private treeCache: { tree: any; path: string; at: number } | null = null;
  private gitAvailable: boolean | null = null;

  async isGitInstalled(): Promise<boolean> {
    if (this.gitAvailable !== null) { return this.gitAvailable; }
    try {
      const home = process.env.USERPROFILE || process.env.HOME || '.';
      await execGit(['--version'], home);
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
        lastCommitMessage = parts[0] || '';
        lastCommitTime = parts.slice(1).join('|') || '';
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
        remoteUrl: undefined // Fetched separately via getRemoteUrl() to avoid redundant shell exec
      };

      this.cache = { status, path: cwd, at: Date.now() };
      return status;

    } catch {
      return null;
    }
  }

  getSuggestions(status: GitStatus): { cmd: string; label: string; reason: string }[] {
    const suggestions: { cmd: string; label: string; reason: string }[] = [];

    if (status.hasConflicts) {
      suggestions.push({
        cmd: 'git merge --abort',
        label: 'Abort Merge',
        reason: 'You have conflicts. If it\'s too messy, you can abort.',
      });
      suggestions.push({
        cmd: 'git status',
        label: 'Check Conflicts',
        reason: 'See which files need manual resolution.',
      });
    } else if (status.uncommittedCount > 0) {
      suggestions.push({
        cmd: 'git add . && git commit -m "update"',
        label: 'Quick Commit',
        reason: `Save your ${status.uncommittedCount} change(s).`,
      });
    }

    if (status.aheadCount > 0) {
      suggestions.push({
        cmd: 'git push',
        label: 'Push Changes',
        reason: `You are ${status.aheadCount} commit(s) ahead.`,
      });
    }

    if (status.behindCount > 0) {
      suggestions.push({
        cmd: 'git pull --rebase',
        label: 'Update Branch',
        reason: `Remote has ${status.behindCount} new commit(s).`,
      });
    }

    return suggestions;
  }

  getGuide(status: GitStatus): string {
    if (status.hasConflicts) {
      return "🚨 **Yikes! You have merge conflicts.** Open the red files in the tree and look for `<<<<<<<`. Choose the right code, save, then `git add` them. You can also Abort if needed.";
    }
    if (status.behindCount > 0) {
      return `🔄 **Remote is ahead.** You are missing ${status.behindCount} commits. I recommend a \`git pull --rebase\` to keep your history clean!`;
    }
    if (status.aheadCount > 0) {
      return `🚀 **Ready to push!** You have ${status.aheadCount} commits locally that aren't on the server yet.`;
    }
    if (status.uncommittedCount > 0) {
      return `📝 **Unsaved work detected.** You've modified ${status.uncommittedCount} items. Don't forget to commit your progress!`;
    }
    if (status.isMainOrMaster && !status.isDetached) {
      return "🌿 **You're on the main branch.** For new features, it's safer to create a new branch with `git checkout -b branch-name`.";
    }
    return "✅ **Everything looks clean!** Your workspace matches the repository perfectly.";
  }

  async getDetailedTree(cwd: string): Promise<any> {
    if (!cwd) return null;

    // Check Cache
    if (this.treeCache && this.treeCache.path === cwd && Date.now() - this.treeCache.at < GIT_CACHE_TTL_MS) {
      return this.treeCache.tree;
    }

    try {
      // Get all tracked and untracked files with status
      // We use a slightly longer timeout for this specific heavy operation to avoid premature aborts on large repos,
      // but still keep it capped to prevent locking the extension host.
      const porcelain = await execGit(['-C', cwd, 'status', '--porcelain', '-uall'], cwd);
      const lines = porcelain.split('\n').filter(Boolean);
      
      // Safety Cap: Maximum files to process for the visual tree
      const MAX_TREE_FILES = 400;
      if (lines.length > MAX_TREE_FILES) {
        return { 
          name: 'root', 
          status: 'modified', 
          children: [{ 
            name: `Large Repo Alert: ${lines.length} changed items detected. Showing summarized view.`, 
            status: 'warning' 
          }] 
        };
      }

      const tree: any = { name: 'root', children: {}, status: 'clean' };

      for (const line of lines) {
        const status = line.substring(0, 2).trim() || '??';
        const relPath = line.substring(3).trim();
        const parts = relPath.split(/[\\\/]/);
        
        let curr = tree;
        // Limit path depth to prevent memory spikes
        const MAX_PATH_DEPTH = 8;
        const effectiveParts = parts.slice(0, MAX_PATH_DEPTH);

        let skipPart = false;
        const SKIP_DIRS = ['.git', 'node_modules', 'dist', 'build', '.next', 'venv', '.venv', '__pycache__', 'target'];

        for (let i = 0; i < effectiveParts.length; i++) {
          const part = effectiveParts[i];
          if (SKIP_DIRS.includes(part)) { skipPart = true; break; }
          
          if (!curr.children || typeof curr.children !== 'object') {
            break; 
          }

          if (!curr.children[part]) {
            curr.children[part] = { 
              name: part, 
              children: i === effectiveParts.length - 1 ? null : {}, 
              status: 'clean' 
            };
          }
          // Propagate status up
          if (status !== 'clean') {
            curr.children[part].status = status;
            curr.status = 'modified'; 
          }
          curr = curr.children[part];
        }
      }

      const result = this.simplifyTree(tree, 0);
      this.treeCache = { tree: result, path: cwd, at: Date.now() };
      return result;
    } catch {
      return null;
    }
  }

  private simplifyTree(node: any, depth: number): any {
    // Hard recursion limit
    if (depth > 10 || !node) {
      return { name: node?.name || '...', status: 'warning' };
    }

    if (node.children === null || typeof node.children !== 'object') {
      return { name: node.name || 'unknown', status: node.status || 'clean' };
    }
    
    return {
      name: node.name,
      status: node.status,
      children: Object.values(node.children).map(c => this.simplifyTree(c, depth + 1))
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
