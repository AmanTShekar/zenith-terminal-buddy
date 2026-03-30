import { Suggestion } from '../types';

const GLOBAL_TOOLS: Record<string, string> = {
  'nodemon': 'npm install -g nodemon',
  'ts-node': 'npm install -g ts-node',
  'tsx': 'npm install -g tsx',
  'tsc': 'npm install -g typescript',
  'prettier': 'npm install -g prettier',
  'eslint': 'npm install -g eslint',
  'http-server': 'npm install -g http-server',
  'serve': 'npm install -g serve',
  'pm2': 'npm install -g pm2',
  'concurrently': 'npm install -g concurrently',
  'vercel': 'npm install -g vercel',
  'netlify': 'npm install -g netlify-cli',
  'prisma': 'npx prisma',
  'vite': 'npm install -g vite',
  'next': 'npm install -g next',
  'create-react-app': 'npx create-react-app',
};

function generateId(): string {
  return `dep-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

export class DependencyDetector {
  check(cmd: string, output: string): Suggestion | null {
    // Cannot find module 'X' → npm install X
    const npmModuleMatch = output.match(/Cannot find module ['"]([^'"]+)['"]/);
    if (npmModuleMatch) {
      const mod = npmModuleMatch[1];
      if (!mod.startsWith('.') && !mod.startsWith('/')) {
        // It's a package, not a local file
        const packageName = mod.startsWith('@') ? mod : mod.split('/')[0];
        return {
          id: generateId(),
          cmd: `npm install ${packageName}`,
          label: `Install missing package: ${packageName}`,
          reason: `The module "${packageName}" was not found. Installing it should fix the error.`,
          dir: '.',
          priority: 100,
          category: 'fix',
        };
      }
    }

    // No module named 'X' → pip install X
    const pythonModuleMatch = output.match(/No module named ['"]?([^\s'"]+)/);
    if (pythonModuleMatch) {
      const mod = pythonModuleMatch[1];
      return {
        id: generateId(),
        cmd: `pip install ${mod}`,
        label: `Install missing Python module: ${mod}`,
        reason: `Python couldn't find "${mod}". Installing it should fix the error.`,
        dir: '.',
        priority: 100,
        category: 'fix',
      };
    }

    // command not found: X → check global tools map
    const cmdNotFoundMatch = output.match(/(?:command not found|is not recognized)[:\s]*['"]?(\S+)/i)
      ?? cmd.match(/^(\S+)/);
    if (cmdNotFoundMatch && /command not found|is not recognized/i.test(output)) {
      const tool = cmdNotFoundMatch[1].replace(/['"]/g, '');
      const installCmd = GLOBAL_TOOLS[tool];
      if (installCmd) {
        return {
          id: generateId(),
          cmd: installCmd,
          label: `Install ${tool}`,
          reason: `"${tool}" is not installed. Run the suggested command to install it.`,
          dir: '.',
          priority: 100,
          category: 'fix',
        };
      }
    }

    // ENOENT: node_modules → npm install
    if (/ENOENT.*node_modules/i.test(output) || /Cannot find module/i.test(output) && /node_modules/i.test(output)) {
      return {
        id: generateId(),
        cmd: 'npm install',
        label: 'Install dependencies',
        reason: 'The node_modules folder appears to be missing or incomplete. Run npm install to set up dependencies.',
        dir: '.',
        priority: 95,
        category: 'fix',
      };
    }

    // .env not found but .env.example exists — this is checked elsewhere via ProjectScanner
    if (/\.env.*not found|ENOENT.*\.env/i.test(output)) {
      return {
        id: generateId(),
        cmd: process.platform === 'win32' ? 'copy .env.example .env' : 'cp .env.example .env',
        label: 'Create .env from example',
        reason: 'The .env file is missing. Copy the example file to get started.',
        dir: '.',
        priority: 90,
        category: 'setup',
      };
    }

    return null;
  }
}
