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

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; level: 'high' | 'medium'; msg: string }> = [
  {
    pattern: /rm\s+-(?:rf|fr|r)\s+(?:\/|\*|~\/)/i,
    level: 'high',
    msg: 'Recursively deleting root, home, or all files is extremely dangerous.',
  },
  {
    pattern: /:(\(\)\s*{\s*:|:&}\s*;:)/, // Fork bomb
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

    // 2. AI-based deep audit for complex commands
    try {
      // Logic for AI audit (redact before sending)
      // Note: redact function not imported here, but AIClient.callRaw handles it or we should.
      const prompt = securityAuditPrompt(trimmedCmd, cwd, projectType);
      const res = await this.aiClient.callRaw(prompt);
      if (res) {
        const aiReport = JSON.parse(res) as SafetyReport;
        if (aiReport.isDangerous) {
          return aiReport;
        }
      }
    } catch (e) {
      console.warn('[Terminal Buddy] Safety AI check failed:', e);
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
