import * as vscode from 'vscode';
import { AIClient } from './AIClient';
import { CommandEntry, ProjectInfo } from '../types';

export interface AgentAction {
  thought: string;
  tool?: string;
  toolInput?: any;
}

export interface FixSuggestion {
  explanation: string;
  diff: string;
}

export class AgentProcedures {
  private ai: AIClient;

  constructor(ai: AIClient) {
    this.ai = ai;
  }

  /**
   * Orchestrates the Agentic Loop to find and suggest a fix for an error.
   */
  public async runAgentFix(
    entry: CommandEntry,
    projectInfo: ProjectInfo | undefined,
    onThought: (thought: string) => void,
    onSuggestion: (suggestion: FixSuggestion) => void
  ): Promise<void> {
    onThought("Analyzing terminal error output...");
    
    const errorLog = entry.errorOutput || "";
    const filesInWorkspace = projectInfo?.topLevelFiles || [];
    
    // Step 1: Initial Analysis & File Discovery
    onThought("Searching for relevant code context...");
    const relevantFiles = await this.discoverRelevantFiles(errorLog, filesInWorkspace);
    
    if (relevantFiles.length === 0) {
      onThought("Could not pinpoint specific files from the error. Broadening search...");
    }

    // Step 2: Read Code & Formulate Fix
    let context = "";
    for (const file of relevantFiles.slice(0, 3)) {
      onThought(`Reading file: ${file.split(/[\\/]/).pop()}...`);
      const content = await this.readSafe(file);
      if (content) {
        context += `\nFILE: ${file}\nCONTENT:\n${content}\n`;
      }
    }

    onThought("Synthesizing a proposed fix...");
    const suggestion = await this.generateFixSuggestion(entry, context);
    
    if (suggestion) {
      onSuggestion(suggestion);
    } else {
      onThought("Buddy is still learning and couldn't generate a confident fix yet.");
    }
  }

  private async discoverRelevantFiles(errorLog: string, knownFiles: string[]): Promise<string[]> {
    // Basic regex to find potential file paths in error logs
    const paths = errorLog.match(/([a-zA-Z]:[\\/]|[\/])?[\w\-. ]+([\\/][\w\-. ]+)*\.\w+/g) || [];
    const uniquePaths = Array.from(new Set(paths)).filter(p => !p.includes('node_modules'));
    
    // Validate paths against workspace
    const validPaths: string[] = [];
    for (const p of uniquePaths) {
      const uri = vscode.Uri.file(p);
      try {
        await vscode.workspace.fs.stat(uri);
        validPaths.push(p);
      } catch {
        // Not a direct path, try searching relative to workspace
        const found = await vscode.workspace.findFiles(`**/${p.split(/[\\/]/).pop()}`, '**/node_modules/**', 1);
        if (found.length > 0) {
          validPaths.push(found[0].fsPath);
        }
      }
    }
    
    return validPaths.length > 0 ? validPaths : knownFiles.slice(0, 5);
  }

  private async readSafe(path: string): Promise<string | null> {
    try {
      const uri = vscode.Uri.file(path);
      const data = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(data).slice(0, 5000); // Limit to 5k chars for prompt safety
    } catch {
      return null;
    }
  }

  private async generateFixSuggestion(entry: CommandEntry, context: string): Promise<FixSuggestion | null> {
    const prompt = `
You are Terminal Buddy, an expert developer agent. 
An error occurred during the command: \`${entry.cmd}\`
Error Output:
\`\`\`
${entry.errorOutput}
\`\`\`

Here is some relevant code context I found:
${context}

Analyze the error and the code. Provide a concise explanation of the cause and a proposed fix in the following JSON format:
{
  "explanation": "Why this happened and what should change.",
  "diff": "A standard diff showing the change (prefix with + and -)."
}
If you are unsure, just provide an explanation without a diff.
`;

    const response = await this.ai.callRaw(prompt);
    if (!response) {
      return null;
    }

    try {
      // Clean up markdown if AI included it
      const cleaned = response.replace(/^```json/m, '').replace(/```$/m, '').trim();
      const jsonObj = JSON.parse(cleaned);
      return {
        explanation: jsonObj.explanation || "No explanation provided.",
        diff: jsonObj.diff || ""
      };
    } catch {
      return {
        explanation: response,
        diff: ""
      };
    }
  }
}
