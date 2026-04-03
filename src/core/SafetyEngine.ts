import * as vscode from 'vscode';
import { AIClient } from '../ai/AIClient';
import { ProjectType } from '../types';
import { securityAuditPrompt } from '../ai/prompts';

export interface SafetyReport {
  isDangerous: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  explanation: string;
  fixCommand?: string; // Optional safer alternative
  requiresConfirmation?: boolean; // If true, Buddy should intercept
}

// Commands too trivial to warrant an AI safety check — saves API quota
const TRIVIAL_COMMANDS = new Set([
  'ls', 'la', 'll', 'dir', 'cls', 'clear', 'pwd', 'cd', 'echo', 'cat', 'type',
  'git status', 'git log', 'git diff', 'git branch', 'git fetch',
  'npm run', 'yarn', 'node --version', 'npm --version', 'python --version'
]);

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; level: 'high' | 'medium'; msg: string }> = [
  {
    pattern: /rm\s+-(?:rf|fr|r)\s+(?:\/|\*|~\/)/i,
    level: 'high',
    msg: 'Recursively deleting root, home, or all files is extremely dangerous.',
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;:/, // Fork bomb
    level: 'high',
    msg: 'This is a fork bomb designed to crash your system.',
  },
  {
    pattern: /mkfs\.[a-z0-9]+\s+\/dev\/[a-z0-9]+/i,
    level: 'high',
    msg: 'Formatting a drive partition will lead to complete data loss.',
  },
  {
    pattern: />\s*\/dev\/[a-z0-9]+/i,
    level: 'high',
    msg: 'Overwriting a device node directly can corrupt your hardware/filesystem.',
  },
  {
    pattern: /(?:curl|wget)\s+.*\s*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|python|perl|php)/i,
    level: 'medium',
    msg: 'Piping remote scripts directly to a shell is a high-security risk (unverified execution).',
  },
  {
    pattern: /git\s+(?:reset\s+--hard|clean\s+-fd)/i,
    level: 'medium',
    msg: 'This will permanently discard all uncommited changes and untracked files.',
  },
  {
    pattern: /chmod\s+777\s+/i,
    level: 'medium',
    msg: 'Setting permissions to 777 (world-writable) is a significant security risk.',
  },
  {
    pattern: /(?:base64\s+-d|xxd\s+-r)/i,
    level: 'medium',
    msg: 'This command decodes obfuscated data, which is often used to hide malicious scripts.',
  },
];

export class SafetyEngine {
  constructor(private readonly aiClient: AIClient) {}

  public async audit(cmd: string, cwd: string, projectType: ProjectType): Promise<SafetyReport> {
    const trimmedCmd = cmd.trim();
    const baseCmd = trimmedCmd.split(/\s+/).slice(0, 2).join(' ');

    // 0. Fast-exit for trivial commands — never waste API quota on these
    if (TRIVIAL_COMMANDS.has(trimmedCmd) || TRIVIAL_COMMANDS.has(baseCmd) || trimmedCmd.length < 4) {
      return { isDangerous: false, riskLevel: 'none', explanation: 'Trivial command — no audit needed.' };
    }

    // 1. Regex-based pattern matching (Fast Path)
    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(trimmedCmd)) {
        return {
          isDangerous: true,
          riskLevel: rule.level,
          explanation: rule.msg,
          requiresConfirmation: rule.level === 'high',
        };
      }
    }

    // 2. AI-based deep audit for complex commands: contain pipes, backticks, redirects, or are >50 chars
    const isComplexCmd = /[|`;&>\\]/.test(trimmedCmd) || trimmedCmd.length > 50;
    if (isComplexCmd) {
      try {
        const prompt = securityAuditPrompt(trimmedCmd, cwd, projectType);
        const res = await this.aiClient.callRaw(prompt);
        if (res) {
          // 🛡️ Security: Extract and validate AI JSON response
          let parsed;
          try {
            const cleaned = res.replace(/^```json/m, '').replace(/```$/m, '').trim();
            parsed = JSON.parse(cleaned);
          } catch {
            // Robust extraction: try to find the largest bracketed block
            const start = res.indexOf('{');
            const end = res.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              try {
                parsed = JSON.parse(res.substring(start, end + 1));
              } catch (e2) { /* last resort failed */ }
            }
          }

          if (parsed && (typeof parsed.isDangerous === 'boolean' || typeof parsed.riskLevel === 'string')) {
            const validLevels = new Set(['none', 'low', 'medium', 'high']);
            const aiReport: SafetyReport = {
              isDangerous: !!parsed.isDangerous,
              riskLevel: validLevels.has(parsed.riskLevel) ? parsed.riskLevel : 'medium',
              explanation: typeof parsed.explanation === 'string' && parsed.explanation.length < 500
                ? parsed.explanation
                : 'Potential risk detected by AI.',
              requiresConfirmation: !!parsed.requiresConfirmation,
            };
            if (aiReport.isDangerous) { return aiReport; }
          }
        }
      } catch (e) {
        console.warn('[Terminal Buddy] Safety AI check failed:', e);
      }
    }

    // 3. Fallback: Lower-level flags
    const containsForce = /--(?:force|overwrite)\b/.test(trimmedCmd) || /\s-f\b/.test(trimmedCmd);
    const containsSudo = trimmedCmd.toLowerCase().startsWith('sudo ');

    if (containsSudo || containsForce) {
      return {
        isDangerous: true,
        riskLevel: containsSudo ? 'medium' : 'low',
        explanation: containsSudo 
          ? 'You are running this with elevated privileges (sudo). Use extreme caution.' 
          : 'You are using a force/overwrite flag, which may lead to data loss.',
        requiresConfirmation: containsSudo, // Sudo always needs double check if safety is on
      };
    }

    return {
      isDangerous: false,
      riskLevel: 'none',
      explanation: 'No immediate security risks detected.',
    };
  }
}
