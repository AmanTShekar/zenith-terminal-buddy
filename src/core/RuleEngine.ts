import * as fs from 'fs';
import * as path from 'path';
import { ErrorExplanation } from '../types';

interface Rule {
  id: string;
  match: (cmd: string, output: string, exitCode: number) => boolean;
  result: (cmd: string, output: string, cwd?: string) => ErrorExplanation;
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

const rules: Rule[] = [
  // ── Specific errors first (higher priority) ───────────────────────────

  {
    id: 'npm-missing-script',
    match: (_, output) => /npm ERR!.*missing script/i.test(output),
    result: (cmd) => ({
      summary: `The npm script you tried to run doesn't exist.`,
      cause: `There's no script called "${cmd.replace(/^npm\s+run\s+/, '')}" in your package.json.`,
      fix: 'Check the "scripts" section in your package.json to see what scripts are available. Run `npm run` to list them all.',
      suggestedCommands: ['npm run'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'cannot-find-module',
    match: (_, output) => /Cannot find module/i.test(output),
    result: (_, output) => {
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
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'python-no-module',
    match: (_, output) => /No module named/i.test(output),
    result: (_, output) => {
      const name = extractModuleName(output, /No module named ['"]?([^\s'"]+)/);
      return {
        summary: `Python module "${name}" is not installed.`,
        cause: `The module is not in your Python environment.`,
        fix: `Install it with \`pip install ${name}\` (or \`pip3 install ${name}\`).`,
        suggestedCommands: [`pip install ${name}`],
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'eaddrinuse',
    match: (_, output) => /EADDRINUSE|address already in use/i.test(output),
    result: (_, output) => {
      const port = extractPort(output);
      return {
        summary: `Port ${port} is already in use by another process.`,
        cause: 'Another server or process is already listening on this port.',
        fix: `Find and kill the process using port ${port}, or use a different port.`,
        suggestedCommands: process.platform === 'win32'
          ? [`netstat -ano | findstr :${port}`]
          : [`lsof -i :${port}`, `kill -9 $(lsof -t -i :${port})`],
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'enoent',
    match: (_, output) => /ENOENT/i.test(output),
    result: (_, output) => ({
      summary: 'A file or directory was not found.',
      cause: 'The path you referenced doesn\'t exist on disk. This often happens when a file was deleted, moved, or the path has a typo.',
      fix: 'Double-check the file path. If you just cloned the repo, you might need to run `npm install` first.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'eacces',
    match: (_, output) => /EACCES|permission denied/i.test(output),
    result: () => ({
      summary: 'Permission denied — you don\'t have access to this file or folder.',
      cause: 'The current user doesn\'t have read/write/execute permissions for the target.',
      fix: process.platform === 'win32'
        ? 'Try running your terminal as Administrator, or check file permissions in Properties.'
        : 'Try with `sudo`, or fix permissions with `chmod`.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'command-not-found',
    match: (_, output) => /command not found|is not recognized|not found.*command/i.test(output),
    result: (cmd, _, cwd) => {
      const tool = cmd.trim().split(/\s+/)[0];
      const lowerTool = tool.toLowerCase();
      
      const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'test', 'foo', 'bar', 'ping'];
      
      if (greetings.includes(lowerTool)) {
        return {
          summary: `Hello! 👋 The terminal doesn't understand "${tool}".`,
          cause: 'You typed a greeting or placeholder word directly into the system shell.',
          fix: 'If you want to talk to me, use the Chat box below! For terminal commands, you need to use standard CLI programs.',
          suggestedCommands: [],
          fromCache: false,
          source: 'rule',
        };
      }

      // ── [NEW] Empty Directory Detection ────────────────────────────────
      if (cwd && fs.existsSync(cwd)) {
        const files = fs.readdirSync(cwd).filter(f => !f.startsWith('.'));
        if (files.length === 0) {
          return {
            summary: `This directory is empty!`,
            cause: `You tried to run a command, but there's nothing in this folder to run.`,
            fix: `Try initializing a project first (e.g., \`npm init\` or \`git clone\`), or check if you are in the wrong folder.`,
            suggestedCommands: ['npm init -y', 'cd ..'],
            fromCache: false,
            source: 'rule',
          };
        }
      }

      // Check for common missing infrastructure
      if (cwd && (lowerTool === 'npm' || lowerTool === 'npm.exe')) {
        const pkgPath = path.join(cwd, 'package.json');
        if (!fs.existsSync(pkgPath)) {
          return {
            summary: `Wait, it looks like you aren't in an npm project.`,
            cause: `You tried to run \`${cmd.trim()}\`, but there is no \`package.json\` in this folder.`,
            fix: `Make sure you have changed your directory (\`cd\`) into your project folder. Use \`ls\` or \`dir\` to see where you are.`,
            suggestedCommands: ['ls', 'pwd'],
            fromCache: false,
            source: 'rule',
          };
        }
      }

      const compilers: Record<string, string> = {
        'javac': 'Java Development Kit (JDK)',
        'gcc': 'GCC (C Compiler)',
        'g++': 'G++ (C++ Compiler)',
        'go': 'Go Programming Language',
        'rustc': 'Rust Programming Language',
      };

      if (compilers[lowerTool]) {
          return {
            summary: `${compilers[lowerTool]} is not installed.`,
            cause: `The command "${tool}" was not found. You need to install the compiler to run this code.`,
            fix: `Download and install ${compilers[lowerTool]} for your system.`,
            suggestedCommands: [],
            fromCache: false,
            source: 'rule',
          };
      }

      if (['vite', 'tsc', 'jest', 'nodemon', 'eslint'].includes(lowerTool)) {
        return {
          summary: `The command "${tool}" is missing — have you installed dependencies?`,
          cause: `You're trying to use ${tool}, but it’s not installed or not in your PATH.`,
          fix: `If this is an npm project, run \`npm install\` first. If it's a global tool, you might need \`npm install -g ${tool}\`.`,
          suggestedCommands: ['npm install'],
          fromCache: false,
          source: 'rule',
        };
      }

      return {
        summary: `Command "${tool}" wasn't found on your system.`,
        cause: `The system shell cannot find any executable named "${tool}". This usually means it's not installed, or its path is not in your system's PATH.`,
        fix: `Check for typos. If "${tool}" is a real tool, ensure you've installed it correctly and restarted your terminal.`,
        suggestedCommands: [],
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'python-venv-dormant',
    match: (cmd, _, exitCode) => exitCode !== 0 && (cmd.startsWith('python') || cmd.startsWith('pip')),
    result: (cmd, _, cwd) => {
      if (!cwd || process.env.VIRTUAL_ENV) return null as any;

      const venvFolders = ['.venv', 'venv', 'env'];
      const found = venvFolders.find(f => fs.existsSync(path.join(cwd, f)));
      
      if (found) {
        const isWindows = process.platform === 'win32';
        const act = isWindows ? `.\\${found}\\Scripts\\activate` : `source ./${found}/bin/activate`;
        return {
          summary: `Your Python virtual environment is not active!`,
          cause: `You're running \`${cmd.split(' ')[0]}\` but you haven't activated the "${found}" environment found in this folder.`,
          fix: `Activate it first by running: \`${act}\``,
          suggestedCommands: [act],
          fromCache: false,
          source: 'rule',
        };
      }
      return null as any;
    }
  },
  {
    id: 'enomem',
    match: (_, output) => /ENOMEM|out of memory|heap out of memory|JavaScript heap/i.test(output),
    result: () => ({
      summary: 'Your system ran out of memory.',
      cause: 'The process needed more RAM than was available. This is common with large builds or test suites.',
      fix: 'Close other applications to free memory. For Node.js, increase the heap size.',
      suggestedCommands: ['export NODE_OPTIONS="--max-old-space-size=4096"'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'syntax-error',
    match: (_, output, exitCode) => exitCode !== 0 && /SyntaxError/i.test(output),
    result: (_, output) => {
      const lineMatch = output.match(/(?:line|:)\s*(\d+)/i);
      const line = lineMatch?.[1] ?? '?';
      return {
        summary: `Syntax error in your code (around line ${line}).`,
        cause: 'There\'s a typo or invalid syntax in your source code — a missing bracket, comma, or semicolon.',
        fix: 'Check the file and line number in the error output. Look for missing brackets, commas, or mismatched quotes.',
        suggestedCommands: [],
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'network-timeout',
    match: (_, output) => /ETIMEDOUT|network timeout|EAI_AGAIN|ECONNREFUSED|ENOTFOUND/i.test(output),
    result: () => ({
      summary: 'A network request failed — couldn\'t reach the server.',
      cause: 'This could be a DNS issue, firewall block, the server being down, or no internet connection.',
      fix: 'Check your internet connection. If behind a proxy or VPN, make sure it\'s configured correctly.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'auth-401',
    match: (_, output, exitCode) => exitCode !== 0 && /\b401\b|unauthorized/i.test(output),
    result: () => ({
      summary: 'Authentication failed (401 Unauthorized).',
      cause: 'Your API key, token, or login credentials are missing, expired, or incorrect.',
      fix: 'Check your API key or login credentials. Make sure environment variables are set correctly.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'auth-403',
    match: (_, output, exitCode) => exitCode !== 0 && /\b403\b|forbidden/i.test(output),
    result: () => ({
      summary: 'Access denied (403 Forbidden).',
      cause: 'You don\'t have permission to access this resource, even though you\'re authenticated.',
      fix: 'Check that your account has the right permissions or role for this action.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'cors',
    match: (_, output) => /CORS|cross-origin|Access-Control-Allow-Origin/i.test(output),
    result: () => ({
      summary: 'Cross-origin request blocked (CORS error).',
      cause: 'Your browser or client tried to access a different domain, and the server didn\'t allow it.',
      fix: 'Configure CORS on your backend server to allow requests from your frontend\'s origin.',
      learnMoreUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'git-push-rejected',
    match: (cmd, output) => /^git\s+push/i.test(cmd) && /rejected|non-fast-forward/i.test(output),
    result: () => ({
      summary: 'Git push was rejected — the remote has changes you don\'t have.',
      cause: 'Someone else pushed to this branch, or you need to pull first.',
      fix: 'Run `git pull --rebase` to get the latest changes, then push again.',
      suggestedCommands: ['git pull --rebase', 'git push'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'git-merge-conflict',
    match: (cmd, output) => /^git\s+(merge|pull|rebase)/i.test(cmd) && /conflict|CONFLICT/i.test(output),
    result: () => ({
      summary: 'Merge conflict — some files have conflicting changes.',
      cause: 'Both branches changed the same lines in a file, and Git can\'t decide which to keep.',
      fix: 'Open the conflicting files and look for <<<<<<< markers. Choose which version to keep, then run `git add` and commit.',
      suggestedCommands: ['git status', 'git diff --name-only --diff-filter=U'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'python-not-found',
    match: (_, output) => /python.*not found|python.*not recognized/i.test(output),
    result: () => ({
      summary: 'Python is not installed or not in your PATH.',
      cause: 'The system can\'t find the Python executable.',
      fix: 'Install Python from python.org, or if it\'s installed, add it to your system PATH.',
      learnMoreUrl: 'https://www.python.org/downloads/',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'npm-peer-dep',
    match: (_, output) => /npm warn.*peer/i.test(output),
    result: () => ({
      summary: 'Peer dependency warning from npm.',
      cause: 'A package expects a specific version of another package that doesn\'t exactly match what you have.',
      fix: 'Usually safe to ignore. If things break, try `npm install --legacy-peer-deps`.',
      suggestedCommands: ['npm install --legacy-peer-deps'],
      fromCache: false,
      source: 'rule',
    }),
  },

  // ── Additional rules (post-audit additions) ───────────────────────────

  {
    id: 'ts-config-error',
    match: (_, output) => /tsconfig.*error|TS\d{4,5}:/i.test(output),
    result: (_, output) => {
      const tsMatch = output.match(/(TS\d{4,5})/);
      const code = tsMatch?.[1] ?? 'TS????';
      return {
        summary: `TypeScript compilation error (${code}).`,
        cause: 'There\'s a type error or configuration issue in your TypeScript project.',
        fix: 'Check the file and line mentioned in the error. Common fixes: add missing types, fix type mismatches, or install @types packages.',
        suggestedCommands: ['npx tsc --noEmit'],
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'docker-error',
    match: (_, output) => /docker.*error|Cannot connect to the Docker daemon/i.test(output),
    result: () => ({
      summary: 'Docker is not running or encountered an error.',
      cause: 'The Docker daemon isn\'t started, or you don\'t have permission to use it.',
      fix: 'Start Docker Desktop, or on Linux run `sudo systemctl start docker`.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'npm-cache-error',
    match: (_, output) => /npm ERR!.*cache/i.test(output) || /EINTEGRITY/i.test(output),
    result: () => ({
      summary: 'npm cache is corrupted.',
      cause: 'The npm cache has invalid or corrupted data, possibly from an interrupted install.',
      fix: 'Clear the npm cache and try again.',
      suggestedCommands: ['npm cache clean --force', 'npm install'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'vite-webpack-error',
    match: (_, output) => /Module build failed|Failed to compile|Build failed with/i.test(output),
    result: (_, output) => ({
      summary: 'Build/bundler failed to compile your project.',
      cause: 'There\'s an error in your source code that the bundler (Vite/Webpack) caught.',
      fix: 'Check the error output for the specific file and line. It\'s usually a syntax or import error.',
      suggestedCommands: [],
      fromCache: false,
      source: 'rule',
    }),
  },
  
  // ── [NEW] Audit Additions — C# & Ruby ──────────────────────────────
  {
    id: 'dotnet-restore-needed',
    match: (_, output) => /must be restored|run 'dotnet restore'/i.test(output),
    result: () => ({
      summary: 'Project dependencies need restoration.',
      cause: 'The .NET project is missing its local packages or the lockfile is out of date.',
      fix: 'Run `dotnet restore` to download dependencies.',
      suggestedCommands: ['dotnet restore'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'csharp-compiler-error',
    match: (_, output) => /error CS\d{4}:/i.test(output),
    result: (_, output) => {
      const errMatch = output.match(/(CS\d{4})/);
      const code = errMatch?.[1] ?? 'CS????';
      return {
        summary: `C# Compiler Error (${code}).`,
        cause: 'A syntax or type error was found in your C# code.',
        fix: 'Check the file and line number. Verify your namespaces and types.',
        suggestedCommands: ['dotnet build'],
        fromCache: false,
        source: 'rule',
      };
    },
  },
  {
    id: 'ruby-gem-missing',
    match: (_, output) => /Could not find gem|Run `bundle install`/i.test(output),
    result: () => ({
      summary: 'Missing Ruby Gems (dependencies).',
      cause: 'One or more gems required by your project are not installed in your current environment.',
      fix: 'Run `bundle install` to install missing gems.',
      suggestedCommands: ['bundle install'],
      fromCache: false,
      source: 'rule',
    }),
  },
  {
    id: 'rails-pending-migration',
    match: (_, output) => /Migrations are pending|run bin\/rails db:migrate/i.test(output),
    result: () => ({
      summary: 'Pending database migrations.',
      cause: 'There are new database migration files that haven\'t been applied to your database yet.',
      fix: 'Run the database migration command.',
      suggestedCommands: ['bin/rails db:migrate'],
      fromCache: false,
      source: 'rule',
    }),
  },
];

export class RuleEngine {
  check(cmd: string, output: string, exitCode: number, cwd?: string): ErrorExplanation | null {
    // Only process actual errors
    if (exitCode === 0) { return null; }

    for (const rule of rules) {
      try {
        if (rule.match(cmd, output, exitCode)) {
          return rule.result(cmd, output, cwd);
        }
      } catch {
        // A rule failing should never crash the engine
        continue;
      }
    }

    return null;
  }
}
