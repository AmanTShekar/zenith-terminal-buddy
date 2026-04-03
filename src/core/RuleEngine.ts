import * as vscode from 'vscode';
import * as path from 'path';
import { ErrorExplanation } from '../types';

interface Rule {
  id: string;
  match: (cmd: string, output: string, exitCode: number) => boolean;
  result: (cmd: string, output: string, cwd?: string) => Promise<ErrorExplanation>;
}

function extractModuleName(output: string, pattern: RegExp): string {
  const match = output.match(pattern);
  return match?.[1] ?? 'unknown';
}

function extractPort(output: string): string {
  const match = output.match(/(?:port|address)\s*(?::|=)?\s*(\d{2,5})/i)
    ?? output.match(/EADDRINUSE.*?:(\d{2,5})/);
  return match?.[1] ?? '???';
}

const TYPO_MAP: Record<string, string> = {
  npx: 'npx',
  nmp: 'npm',
  gi: 'git',
  gti: 'git',
  pythom: 'python',
  pytohn: 'python',
  pyhton: 'python',
  nodde: 'node',
  ndoe: 'node',
  dokcer: 'docker',
  cdDotDot: 'cd ..',
  sl: 'ls',
  dc: 'cd',
};

const rules: Rule[] = [
  {
    id: 'dep-check-proactive',
    match: (cmd, _output, exitCode) => {
      if (exitCode === 0) {
        return false;
      }
      const tool = cmd.trim().split(/\s+/)[0].toLowerCase();
      return ['npm', 'yarn', 'node', 'npx'].includes(tool);
    },
    result: async (cmd, _output, cwd) => {
      if (!cwd) {
        return null as any;
      }
      const pkgUri = vscode.Uri.file(path.join(cwd, 'package.json'));
      const modulesUri = vscode.Uri.file(path.join(cwd, 'node_modules'));
      
      try {
        await vscode.workspace.fs.stat(pkgUri);
        try {
          await vscode.workspace.fs.stat(modulesUri);
        } catch {
          return {
            summary: `Dependencies not installed!`,
            cause: `I see a \`package.json\` but \`node_modules\` is missing. Your project isn't ready to run.`,
            fix: `Run \`npm install\` to set up your project.`,
            suggestedCommands: ['npm install'],
            fromCache: false, source: 'rule',
          };
        }
      } catch { }
      return null as any;
    }
  },
  {
    id: 'env-guard-proactive',
    match: (cmd, _output, exitCode) => {
      if (exitCode === 0) {
        return false;
      }
      const tool = cmd.trim().split(/\s+/)[0].toLowerCase();
      return ['npm', 'node', 'python', 'rails', 'yarn', 'pnpm'].includes(tool);
    },

    result: async (_cmd, _output, cwd) => {
      if (!cwd) { return null as any; }
      const dotEnvUri = vscode.Uri.file(path.join(cwd, '.env'));
      const exampleUri = vscode.Uri.file(path.join(cwd, '.env.example'));
      
      try {
        await vscode.workspace.fs.stat(exampleUri);
        try {
          await vscode.workspace.fs.stat(dotEnvUri);
        } catch {
          return {
            summary: `Missing .env file!`,
            cause: `I see a \`.env.example\` but you don't have a \`.env\` file. Your app likely needs it to start.`,
            fix: `Copy the example: \`cp .env.example .env\`, then fill in your real values.`,
            suggestedCommands: ['cp .env.example .env'],
            fromCache: false, source: 'rule',
          };
        }
      } catch { }
      return null as any;
    }
  },
  {
    id: 'did-you-mean',
    match: (_cmd, output) => {
      return /command not found|is not recognized/i.test(output);
    },
    result: async (cmd) => {
      const tool = cmd.trim().split(/\s+/)[0].toLowerCase();
      const suggestion = TYPO_MAP[tool];
      if (suggestion && suggestion !== tool) {
        return {
          summary: `Typo detected! Did you mean \`${suggestion}\`?`,
          cause: `"${tool}" is not a valid command, but \`${suggestion}\` is very similar.`,
          fix: `Try re-running with \`${cmd.replace(tool, suggestion)}\`.`,
          suggestedCommands: [cmd.replace(tool, suggestion)],
          fromCache: false, source: 'rule',
        };
      }
      return null as any;
    }
  },
  {
    id: 'npm-missing-script',
    match: (_, output) => {
      return /npm ERR!.*missing script/i.test(output);
    },
    result: async (cmd) => ({
      summary: `The npm script you tried to run doesn't exist.`,
      cause: `There's no script called "${cmd.replace(/^npm\s+run\s+/, '')}" in your package.json.`,
      fix: 'Check the "scripts" section in your package.json to see what scripts are available. Run `npm run` to list them all.',
      suggestedCommands: ['npm run'],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'cannot-find-module',
    match: (_, output) => {
      return /Cannot find module/i.test(output);
    },
    result: async (_, output) => {
      const name = extractModuleName(output, /Cannot find module ['"]([^'"]+)['"]/);
      const isLocal = name.startsWith('.') || name.startsWith('/');
      return {
        summary: `The module "${name}" could not be found.`,
        cause: isLocal
          ? `The file path "${name}" doesn't exist. Check for typos in the import path.`
          : `The package "${name}" is not installed in node_modules.`,
        fix: isLocal
          ? 'Check that the file exists and the path is correct (including file extension).'
          : `Run \`npm install ${name}\` to install it.`,
        suggestedCommands: isLocal ? [] : [`npm install ${name}`],
        fromCache: false, source: 'rule',
      };
    },
  },
  {
    id: 'python-no-module',
    match: (_, output) => {
      return /No module named/i.test(output);
    },
    result: async (_, output) => {
      const name = extractModuleName(output, /No module named ['"]?([^\s'"]+)/);
      return {
        summary: `Python module "${name}" is not installed.`,
        cause: `The module is not in your Python environment.`,
        fix: `Install it with \`pip install ${name}\` (or \`pip3 install ${name}\`).`,
        suggestedCommands: [`pip install ${name}`],
        fromCache: false, source: 'rule',
      };
    },
  },
  {
    id: 'eaddrinuse',
    match: (_, output) => {
      return /EADDRINUSE|address already in use/i.test(output);
    },
    result: async (_, output) => {
      const port = extractPort(output);
      return {
        summary: `Port ${port} is already in use by another process.`,
        cause: 'Another server or process is already listening on this port.',
        fix: `Find and kill the process using port ${port}, or use a different port.`,
        suggestedCommands: process.platform === 'win32'
          ? [`netstat -ano | findstr :${port}`]
          : [`lsof -i :${port}`, `kill -9 $(lsof -t -i :${port})`],
        fromCache: false, source: 'rule',
      };
    },
  },
  {
    id: 'enoent',
    match: (_, output) => {
      return /ENOENT/i.test(output);
    },
    result: async (_, output) => ({
      summary: 'A file or directory was not found.',
      cause: 'The path you referenced doesn\'t exist on disk. This often happens when a file was deleted, moved, or the path has a typo.',
      fix: 'Double-check the file path. If you just cloned the repo, you might need to run `npm install` first.',
      suggestedCommands: [],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'eacces',
    match: (_, output) => {
      return /EACCES|permission denied/i.test(output);
    },
    result: async () => ({
      summary: 'Permission denied — you don\'t have access to this file or folder.',
      cause: 'The current user doesn\'t have read/write/execute permissions for the target.',
      fix: process.platform === 'win32'
        ? 'Try running your terminal as Administrator, or check file permissions in Properties.'
        : 'Try with `sudo`, or fix permissions with `chmod`.',
      suggestedCommands: [],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'command-not-found',
    match: (_, output) => {
      return /command not found|is not recognized|not found.*command/i.test(output);
    },
    result: async (fullCommand, _, cwd) => {
      const tool = fullCommand.trim().split(/\s+/)[0];
      const args = fullCommand.split(/\s+/).slice(1);
      const cmdTool = tool.toLowerCase();

      // 1. Path Validation
      for (const arg of args) {
        if (arg.includes('/') || arg.includes('\\') || arg.includes('.')) {
          const p = path.isAbsolute(arg) ? arg : path.join(cwd || '', arg);
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(p));
          } catch {
            if (arg.length > 2 && !arg.startsWith('-')) {
              return {
                summary: `Buddy spotted a missing path!`,
                cause: `You're trying to use "${arg}", but I can't find it in "${path.basename(cwd || 'your project')}".`,
                fix: `Check for typos or use \`ls\` to see if the file moved.`,
                suggestedCommands: ['ls', 'cd ..'],
                fromCache: false, source: 'rule',
              };
            }
          }
        }
      }

      // 2. Env Guard
      if (cwd && ['npm', 'node', 'python', 'rails'].includes(cmdTool)) {
        const dotEnvUri = vscode.Uri.file(path.join(cwd, '.env'));
        const exUri = vscode.Uri.file(path.join(cwd, '.env.example'));
        try {
          await vscode.workspace.fs.stat(exUri);
          try {
            await vscode.workspace.fs.stat(dotEnvUri);
          } catch {
            return {
              summary: `Missing Environment variables!`,
              cause: `I see a \`.env.example\` but you don't have a \`.env\` file yet. Your code probably needs it.`,
              fix: `Run \`cp .env.example .env\` and fill in your secrets.`,
              suggestedCommands: ['cp .env.example .env'],
              fromCache: false, source: 'rule',
            };
          }
        } catch { }
      }

      // 3. Greeting check
      const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'test', 'foo', 'bar', 'ping'];
      if (greetings.includes(cmdTool)) {
        return {
          summary: `Hello! 👋 The terminal doesn't understand "${tool}".`,
          cause: 'You typed a greeting or placeholder word directly into the system shell.',
          fix: 'If you want to talk to me, use the Chat box below! For terminal commands, you need to use standard CLI programs.',
          suggestedCommands: [],
          fromCache: false, source: 'rule',
        };
      }

      // 4. Empty Directory Detection
      if (cwd) {
        try {
          const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(cwd));
          const actualFiles = files.filter(f => !f[0].startsWith('.'));
          if (actualFiles.length === 0) {
            return {
              summary: `This directory is empty!`,
              cause: `You tried to run a command, but there's nothing in this folder to run.`,
              fix: `Try initializing a project first, or check if you are in the wrong folder.`,
              suggestedCommands: ['npm init -y', 'cd ..'],
              fromCache: false, source: 'rule',
            };
          }
        } catch { }
      }

      return {
        summary: `Command "${tool}" wasn't found on your system.`,
        cause: `The system shell cannot find any executable named "${tool}". This usually means it's not installed, or its path is not in your system's PATH.`,
        fix: `Check for typos. If "${tool}" is a real tool, ensure you've installed it correctly and restarted your terminal.`,
        suggestedCommands: [],
        fromCache: false, source: 'rule',
      };
    },
  },
  {
    id: 'python-venv-dormant',
    match: (cmd, _, exitCode) => {
      return exitCode !== 0 && (cmd.startsWith('python') || cmd.startsWith('pip'));
    },
    result: async (cmd, _, cwd) => {
      if (!cwd || process.env.VIRTUAL_ENV) {
        return null as any;
      }

      const venvFolders = ['.venv', 'venv', 'env'];
      for (const found of venvFolders) {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(path.join(cwd, found)));
          const isWindows = process.platform === 'win32';
          const act = isWindows ? `.\\${found}\\Scripts\\activate` : `source ./${found}/bin/activate`;
          return {
            summary: `Your Python virtual environment is not active!`,
            cause: `You're running \`${cmd.split(' ')[0]}\` but you haven't activated the "${found}" environment found in this folder.`,
            fix: `Activate it first by running: \`${act}\``,
            suggestedCommands: [act],
            fromCache: false, source: 'rule',
          };
        } catch { }
      }
      return null as any;
    }
  },
  {
    id: 'enomem',
    match: (_, output) => {
      return /ENOMEM|out of memory|heap out of memory|JavaScript heap/i.test(output);
    },
    result: async () => ({
      summary: 'Your system ran out of memory.',
      cause: 'The process needed more RAM than was available. This is common with large builds or test suites.',
      fix: 'Close other applications to free memory. For Node.js, increase the heap size.',
      suggestedCommands: ['export NODE_OPTIONS="--max-old-space-size=4096"'],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'syntax-error',
    match: (_, output, exitCode) => {
      return exitCode !== 0 && /SyntaxError/i.test(output);
    },
    result: async (_, output) => {
      const lineMatch = output.match(/(?:line|:)\s*(\d+)/i);
      const line = lineMatch?.[1] ?? '?';
      return {
        summary: `Syntax error in your code (around line ${line}).`,
        cause: 'There\'s a typo or invalid syntax in your source code — a missing bracket, comma, or semicolon.',
        fix: 'Check the file and line number in the error output. Look for missing brackets, commas, or mismatched quotes.',
        suggestedCommands: [],
        fromCache: false, source: 'rule',
      };
    },
  },
  {
    id: 'network-timeout',
    match: (_, output) => {
      return /ETIMEDOUT|network timeout|EAI_AGAIN|ECONNREFUSED|ENOTFOUND/i.test(output);
    },
    result: async () => ({
      summary: 'A network request failed — couldn\'t reach the server.',
      cause: 'This could be a DNS issue, firewall block, the server being down, or no internet connection.',
      fix: 'Check your internet connection. If behind a proxy or VPN, make sure it\'s configured correctly.',
      suggestedCommands: [],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'auth-401',
    match: (_, output, exitCode) => {
      return exitCode !== 0 && /\b401\b|unauthorized/i.test(output);
    },
    result: async () => ({
      summary: 'Authentication failed (401 Unauthorized).',
      cause: 'Your API key, token, or login credentials are missing, expired, or incorrect.',
      fix: 'Check your API key or login credentials. Make sure environment variables are set correctly.',
      suggestedCommands: [],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'git-push-rejected',
    match: (cmd, output) => {
      return /^git\s+push/i.test(cmd) && /rejected|non-fast-forward/i.test(output);
    },
    result: async () => ({
      summary: 'Git push was rejected — the remote has changes you don\'t have.',
      cause: 'Someone else pushed to this branch, or you need to pull first.',
      fix: 'Run `git pull --rebase` to get the latest changes, then push again.',
      suggestedCommands: ['git pull --rebase', 'git push'],
      fromCache: false, source: 'rule',
    }),
  },
  {
    id: 'ts-config-error',
    match: (_, output) => {
      return /tsconfig.*error|TS\d{4,5}:/i.test(output);
    },
    result: async (_, output) => {
      const tsMatch = output.match(/(TS\d{4,5})/);
      const code = tsMatch?.[1] ?? 'TS????';
      return {
        summary: `TypeScript compilation error (${code}).`,
        cause: 'There\'s a type error or configuration issue in your TypeScript project.',
        fix: 'Check the file and line mentioned in the error. Common fixes: add missing types, fix type mismatches, or install @types packages.',
        suggestedCommands: ['npx tsc --noEmit'],
        fromCache: false, source: 'rule',
      };
    },
  },
];


export class RuleEngine {
  async check(cmd: string, output: string, exitCode: number, cwd?: string): Promise<ErrorExplanation | null> {
    if (exitCode === 0) { return null; }

    for (const rule of rules) {
      try {
        if (rule.match(cmd, output, exitCode)) {
          return await rule.result(cmd, output, cwd);
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
