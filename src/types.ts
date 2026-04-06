// ─── Terminal Buddy — Shared Types ───────────────────────────────────────────

export type ProjectType = 'react' | 'nextjs' | 'vue' | 'angular' | 'svelte' | 'node' | 'python' | 'rust' | 'go' | 'java' | 'cpp' | 'c' | 'csharp' | 'ruby' | 'unknown';
export type CommandStatus = 'ok' | 'error' | 'warning' | 'running';
export type CommandTag = 'test' | 'build' | 'git' | 'install' | 'run' | 'agent' | 'other';
export type PetMood = 'happy' | 'worried' | 'sleeping' | 'excited' | 'scared' | 'neutral';
export type PetType = 'cat' | 'dog' | 'robot' | 'ghost';
export type AIProviderType = 'gemini' | 'openai' | 'claude' | 'groq' | 'ollama' | 'zai' | 'minimax' | 'custom';

// ─── Command History ─────────────────────────────────────────────────────────

export interface CommandEntry {
  id: string;
  cmd: string;
  cwd: string;
  project: string;
  status: CommandStatus;
  exitCode: number | null;
  tag: CommandTag;
  timestamp: number;
  isAgentRun: boolean;      // Re-enabled for filtering
  errorOutput?: string;
  agentSessionId?: string;
  durationMs?: number;
  terminalId?: string;
  terminalName?: string;
}

// ─── Active Commands ─────────────────────────────────────────────────────────

export interface ActiveCommand {
  id: string;
  cmd: string;
  cwd: string;
  startTime: number;
  terminalId: string;
  terminalName: string;
}

// ─── Project Scanning ────────────────────────────────────────────────────────

export interface ProjectInfo {
  path: string;
  name: string;
  type: ProjectType;
  confidence: number;         // 0–1
  scripts: Record<string, string>;
  hasDotEnv: boolean;
  hasDotEnvExample: boolean;
  hasNodeModules: boolean;
  hasGit: boolean;
  detectedTools: string[];    // e.g. ['docker', 'prisma', 'typescript']
  topLevelFiles: string[];    // Top-level files injected for context
  venv?: {
    exists: boolean;
    path: string;
    isActive: boolean;
    activateCmd: string;
  };
  entryPoints?: {
    label: string;
    path: string;
    cmd: string;
  }[];
}

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
}

export interface WorkspaceMap {
  rootPath: string;
  projects: ProjectInfo[];
  fileTree?: FileNode;
  scannedAt: number;
}

// ─── Git ─────────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  isDetached: boolean;
  isMainOrMaster: boolean;
  uncommittedCount: number;
  uncommittedFiles: { status: string, path: string }[];
  aheadCount: number;
  behindCount: number;
  hasConflicts: boolean;
  lastCommitMessage: string;
  lastCommitTime: string;
  remoteUrl?: string;
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  cmd: string;
  label: string;
  reason: string;
  dir: string;
  priority: number;
  category: 'fix' | 'workflow' | 'git' | 'setup';
}

// ─── Error Explanation ───────────────────────────────────────────────────────

export interface ErrorExplanation {
  summary: string;
  cause: string;
  fix: string;
  learnMoreUrl?: string;
  suggestedCommands?: string[];
  fromCache: boolean;
  source: 'rule' | 'ai';
}

// ─── Pet ─────────────────────────────────────────────────────────────────────

export interface PetState {
  type: PetType;
  name: string;
  mood: PetMood;
  xp: number;
  level: number;
  errorsFixed: number;
  lastActiveAt: number;
}

// ─── AI Provider ─────────────────────────────────────────────────────────────

export interface AIProviderConfig {
  type: AIProviderType;
  name: string;
  model: string;
  endpoint: string;
  requiresPayment: boolean;
  description: string;
  costPer1kTokens?: {
    prompt: number;
    completion: number;
  };
}

export const AI_PROVIDERS: Record<AIProviderType, AIProviderConfig> = {
  gemini: {
    type: 'gemini',
    name: 'Google Gemini',
    model: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent',
    requiresPayment: false,
    description: 'Free at aistudio.google.com',
    costPer1kTokens: { prompt: 0, completion: 0 }
  },
  openai: {
    type: 'openai',
    name: 'OpenAI',
    model: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    requiresPayment: true,
    description: 'Requires API key from platform.openai.com',
    costPer1kTokens: { prompt: 0.00015, completion: 0.0006 } // GPT-4o-mini rates
  },
  claude: {
    type: 'claude',
    name: 'Anthropic Claude',
    model: 'claude-3-5-haiku-latest',
    endpoint: 'https://api.anthropic.com/v1/messages',
    requiresPayment: true,
    description: 'Requires API key from console.anthropic.com',
    costPer1kTokens: { prompt: 0.00025, completion: 0.00125 } // Claude 3.5 Haiku rates
  },
  groq: {
    type: 'groq',
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    requiresPayment: false,
    description: 'Free tier at console.groq.com',
    costPer1kTokens: { prompt: 0, completion: 0 }
  },
  ollama: {
    type: 'ollama',
    name: 'Ollama (Local)',
    model: 'llama3',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    requiresPayment: false,
    description: 'Local Llama models via Ollama',
  },
  custom: {
    type: 'custom',
    name: 'Custom OpenAI-Compatible',
    model: 'custom-model',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    requiresPayment: false,
    description: 'Any OpenAI-compatible API endpoint (LM Studio, LocalAI, etc.)'
  },
  zai: {
    type: 'zai',
    name: 'Z.AI (GLM)',
    model: 'glm-4-flash',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    requiresPayment: true,
    description: 'High performance GLM models from Zhipu AI',
    costPer1kTokens: { prompt: 0.0001, completion: 0.0001 }
  },
  minimax: {
    type: 'minimax',
    name: 'MiniMax',
    model: 'abab6.5s-chat',
    endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    requiresPayment: true,
    description: 'Advanced Chinese LLM provider',
    costPer1kTokens: { prompt: 0.00015, completion: 0.00015 }
  }
};

// ─── Panel Messaging ─────────────────────────────────────────────────────────

export interface PanelMessage {
  type: string;
  payload?: unknown;
}

// ─── Safety Guard ───────────────────────────────────────────────────────────

export interface SafetyReport {
  isDangerous: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  explanation: string;
  fixCommand?: string;
  requiresConfirmation?: boolean;
}

// ─── Usage Tracking ─────────────────────────────────────────────────────────

export interface UsageRecord {
  provider: AIProviderType;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  timestamp: number;
}

export interface ProviderUsageSummary {
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export interface StoredData {
  version: number;
  entries: CommandEntry[];
}

// ─── Vault Persistence ───────────────────────────────────────────────────────

export interface VaultKey {
  id: string;
  name: string;
  envVar: string;
  hasValue?: boolean;
  autoInject?: boolean;
}

export const PRESET_SERVICES: VaultKey[] = [
  { id: 'hf', name: 'Hugging Face', envVar: 'HF_TOKEN' },
  { id: 'gh', name: 'GitHub', envVar: 'GITHUB_TOKEN' },
  { id: 'aws_id', name: 'AWS Access Key ID', envVar: 'AWS_ACCESS_KEY_ID' },
  { id: 'aws_secret', name: 'AWS Secret Access Key', envVar: 'AWS_SECRET_ACCESS_KEY' },
  { id: 'npm', name: 'NPM Automaton Token', envVar: 'NPM_TOKEN' },
  { id: 'openai_legacy', name: 'OpenAI API Key (Global)', envVar: 'OPENAI_API_KEY' }
];

export const STORAGE_VERSION = 1;
export const MAX_ERROR_OUTPUT_LENGTH = 500;
export const MAX_BUFFER_SIZE = 50 * 1024; // 50KB per command output
export const AI_RATE_LIMIT_MS = 0;
export const AI_TIMEOUT_MS = 15000;
export const AI_CACHE_MAX = 100;
export const GIT_TIMEOUT_MS = 3000;
export const GIT_CACHE_TTL_MS = 5000;
export const DEBOUNCE_TERMINAL_MS = 100;
export const DEBOUNCE_UI_MS = 200;
export const SCANNER_DELAY_MS = 500;
export const SCANNER_MAX_DEPTH = 8;
