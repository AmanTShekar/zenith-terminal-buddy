import * as fs from 'fs';
import * as path from 'path';

export interface EnvDiffResult {
  hasExample: boolean;
  hasLocal: boolean;
  missingKeys: string[];
}

export class EnvDiffChecker {
  public static check(cwd: string): EnvDiffResult {
    const result: EnvDiffResult = {
      hasExample: false,
      hasLocal: false,
      missingKeys: [],
    };

    if (!cwd) return result;

    const examplePath = path.join(cwd, '.env.example');
    const localPath = path.join(cwd, '.env');

    result.hasExample = fs.existsSync(examplePath);
    result.hasLocal = fs.existsSync(localPath);

    if (result.hasExample && result.hasLocal) {
      try {
        const exampleContent = fs.readFileSync(examplePath, 'utf8');
        const localContent = fs.readFileSync(localPath, 'utf8');

        const extractKeys = (content: string) => {
          return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => line.split('=')[0].trim());
        };

        const exampleKeys = new Set(extractKeys(exampleContent));
        const localKeys = new Set(extractKeys(localContent));

        for (const key of exampleKeys) {
          if (!localKeys.has(key)) {
            result.missingKeys.push(key);
          }
        }
      } catch (err) {
        console.warn('[Terminal Buddy] Failed to parse .env files:', err);
      }
    }

    return result;
  }
}
