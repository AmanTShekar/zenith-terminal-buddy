import * as vscode from 'vscode';
import {
  AIProviderType, AI_PROVIDERS, ErrorExplanation, CommandEntry, ProjectInfo,
  AI_TIMEOUT_MS, AI_CACHE_MAX,
} from '../types';
import { doubtClearingPrompt, errorExplanationPrompt, chatPrompt } from './prompts';
import { redact as redactSensitiveInfo } from '../core/RedactionUtils';
import { UsageTracker } from '../utils/UsageTracker';

// ─── Shared Types ───────────────────────────────────────────────────────────

export interface AIResponse {
  content: string;
  isStreaming?: boolean;
}

export type StreamCallback = (chunk: string) => void;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ─── AI Client State (Static for lifecycle management) ───────────────
let WORKING_GEMINI_ENDPOINT: string | null = null;
let CACHED_MODELS: Record<string, string[]> = {};
let CURRENT_PROVIDER: string | null = null;
const PROVIDER_KEY_INDEX: Record<string, number> = {};

function safeUrl(raw: string): string {
  if (!raw) { return 'http://localhost'; }
  return raw.includes('://') ? raw : `http://${raw}`;
}

function safeHost(raw: string): string {
  try {
    return new URL(safeUrl(raw)).host;
  } catch {
    return raw || 'AI';
  }
}

async function* callGeminiStream(apiKey: string, history: ChatMessage[], model?: string): AsyncIterable<string> {
  const trimmedKey = apiKey.trim();
  
  // If we have a working endpoint, use it immediately
  if (WORKING_GEMINI_ENDPOINT) {
    try {
      yield* runGeminiStream(WORKING_GEMINI_ENDPOINT, history, trimmedKey);
      return; 
    } catch (e) {
      WORKING_GEMINI_ENDPOINT = null; // Invalidate cache on failure
    }
  }

  const activeModel = model || AI_PROVIDERS.gemini.model;
  const modelVariants = [activeModel, `${activeModel}-latest`, 'gemini-1.5-flash-8b', 'gemini-pro'];
  const versions = ['v1beta', 'v1'];
  
  const endpoints: string[] = [];
  for (const v of versions) {
    for (const m of modelVariants) {
      endpoints.push(`https://generativelanguage.googleapis.com/${v}/models/${m}:streamGenerateContent?alt=sse`);
    }
  }
  
  // Parallel Probe: Try first 3 endpoints in parallel to find a winner fast
  const probeTasks = endpoints.slice(0, 3).map(async (url) => {
    const res = await fetch(url + `&key=${encodeURIComponent(trimmedKey)}`, {
      method: 'POST',
      headers: { ['Content-Type']: 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
    });
    if (!res.ok) {
      throw new Error('Fail');
    }
    return url;
  });

  try {
    const winner = await Promise.any(probeTasks);
    WORKING_GEMINI_ENDPOINT = winner;
    yield* runGeminiStream(winner, history, trimmedKey);
    return;
  } catch (err: any) {
    // Fallback to sequential for the rest if parallel probing failed
    for (const url of endpoints) {
      try {
        yield* runGeminiStream(url, history, trimmedKey);
        if (WORKING_GEMINI_ENDPOINT) {
          return;
        }
      } catch (seqErr: any) {
        lastProbeError = seqErr;
      }
    }
  }
  const host = new URL(endpoints[0]).host;
  throw new Error(`All Gemini probes failed on ${host}. Last error: ${lastProbeError?.message || 'Unknown'}. Please check your internet or API key.`);
}

let lastProbeError: any;

/** Helper to run the actual stream once URL is decided */
async function* runGeminiStream(url: string, history: ChatMessage[], apiKey: string): AsyncIterable<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 
      ['Content-Type']: 'application/json',
      ['x-goog-api-key']: apiKey 
    },
    body: JSON.stringify({
      contents: history.map((h) => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }],
      })),
      generationConfig: { maxOutputTokens: 1000, temperature: 0.2 }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini Stream Error: ${response.status}`);
  }
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield text;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* callClaudeStream(apiKey: string, history: ChatMessage[], model?: string): AsyncIterable<string> {
  const config = AI_PROVIDERS.claude;
  const activeModel = model || config.model;
  let res;
  try {
    res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
        ['x-api-key']: apiKey,
        ['anthropic-version']: '2023-06-01',
      },
      body: JSON.stringify({
        model: activeModel,
        ['max_tokens']: 500,
        messages: history,
        stream: true,
      }),
    });
  } catch (err: any) {
    throw new Error(`Claude connect failed: ${err.message || 'Check internet'}`);
  }

  if (!res.ok) {
    throw new Error(`Claude Stream Error: ${res.status}`);
  }
  if (!res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.substring(6));
            if (json.type === 'content_block_delta') {
              yield json.delta.text;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function callOpenAICompatible(apiKey: string, history: ChatMessage[], model: string, forceJson = false, endpoint?: string): Promise<string> {
  const targetEndpoint = endpoint || AI_PROVIDERS.openai.endpoint;
  const headers: Record<string, string> = { ['Content-Type']: 'application/json' };
  if (apiKey && apiKey.trim().length > 0 && apiKey !== 'local') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let res;
  try {
    res = await fetch(targetEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: history,
        ['max_tokens']: 1000,
        temperature: 0.3,
        ...(forceJson ? { ['response_format']: { type: 'json_object' } } : {})
      }),
    });
  } catch (err: any) {
    const host = safeHost(targetEndpoint);
    throw new Error(`Connect failed to ${host}. ${err.message || ''}`);
  }

  const data = await res.json() as any;
  if (data.error) {
    throw new Error(data.error.message);
  }

  return data?.choices?.[0]?.message?.content ?? '';
}

async function* callOpenAICompatibleStream(apiKey: string, history: ChatMessage[], model: string, endpoint?: string): AsyncIterable<string> {
  const targetEndpoint = endpoint || AI_PROVIDERS.openai.endpoint;
  const headers: Record<string, string> = { ['Content-Type']: 'application/json' };
  if (apiKey && apiKey.trim().length > 0 && apiKey !== 'local') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let res;
  try {
    res = await fetch(targetEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: history,
        ['max_tokens']: 1000,
        temperature: 0.3,
        stream: true,
      }),
    });
  } catch (err: any) {
    const host = safeHost(targetEndpoint);
    throw new Error(`Connect failed to ${host}. ${err.message || 'Check your internet or local server.'}`);
  }

  if (!res.ok) {
    const host = safeHost(targetEndpoint);
    throw new Error(`AI Provider (${host}) Error: ${res.status}`);
  }
  if (!res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const data = line.replace('data: ', '').trim();
        if (data === '[DONE]') {
          break;
        }
        if (!data) {
          continue;
        }
        try {
          const json = JSON.parse(data);
          const content = json.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Callers Maps ───────────────────────────────────────────────────────────

type CallerFunc = (apiKey: string, history: ChatMessage[], model?: string, forceJson?: boolean, endpoint?: string) => Promise<string>;
type StreamCallerFunc = (apiKey: string, history: ChatMessage[], model?: string, endpoint?: string) => AsyncIterable<string>;

const STREAM_CALLERS: Record<AIProviderType, StreamCallerFunc> = {
  gemini: callGeminiStream,
  openai: (key, hist, mod, ep) => callOpenAICompatibleStream(key, hist, mod || AI_PROVIDERS.openai.model, AI_PROVIDERS.openai.endpoint),
  claude: (key, hist, mod) => callClaudeStream(key, hist, mod),
  groq: (key, hist, mod, ep) => callOpenAICompatibleStream(key, hist, mod || AI_PROVIDERS.groq.model, AI_PROVIDERS.groq.endpoint),
  ollama: (key, hist, mod, ep) => callOpenAICompatibleStream(key, hist, mod || AI_PROVIDERS.ollama.model, ep || AI_PROVIDERS.ollama.endpoint),
  zai: (key, hist, mod, ep) => callOpenAICompatibleStream(key, hist, mod || AI_PROVIDERS.zai.model, AI_PROVIDERS.zai.endpoint),
  minimax: (key, hist, mod, ep) => callMiniMaxStream(key, hist, mod || AI_PROVIDERS.minimax.model),
  custom: (key, hist, mod, ep) => callOpenAICompatibleStream(key, hist, mod || AI_PROVIDERS.custom.model, ep || AI_PROVIDERS.custom.endpoint),
};

const CALLERS: Record<AIProviderType, CallerFunc> = {
  gemini: (key, hist, mod, force) => callGemini(key, hist, mod, force),
  openai: (key, hist, mod, force, ep) => callOpenAICompatible(key, hist, mod || AI_PROVIDERS.openai.model, force, AI_PROVIDERS.openai.endpoint),
  claude: (key, hist, mod, force) => callClaude(key, hist, mod),
  groq: (key, hist, mod, force, ep) => callOpenAICompatible(key, hist, mod || AI_PROVIDERS.groq.model, force, AI_PROVIDERS.groq.endpoint),
  ollama: (key, hist, mod, force, ep) => callOpenAICompatible(key, hist, mod || AI_PROVIDERS.ollama.model, force, ep || AI_PROVIDERS.ollama.endpoint),
  zai: (key, hist, mod, force, ep) => callOpenAICompatible(key, hist, mod || AI_PROVIDERS.zai.model, force, AI_PROVIDERS.zai.endpoint),
  minimax: (key, hist, mod, force) => callMiniMax(key, hist, mod || AI_PROVIDERS.minimax.model),
  custom: (key, hist, mod, force, ep) => callOpenAICompatible(key, hist, mod || AI_PROVIDERS.custom.model, force, ep || AI_PROVIDERS.custom.endpoint),
};

async function callClaude(apiKey: string, history: ChatMessage[], model?: string): Promise<string> {
  const config = AI_PROVIDERS.claude;
  const activeModel = model || config.model;
  let res;
  try {
    res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
        ['x-api-key']: apiKey,
        ['anthropic-version']: '2023-06-01'
      },
      body: JSON.stringify({
        model: activeModel,
        ['max_tokens']: 1000,
        messages: history
      }),
    });
  } catch (err: any) {
    throw new Error(`Claude connect failed: ${err.message || 'Check connection'}`);
  }
  const data = await res.json() as any;
  return data?.content?.[0]?.text ?? '';
}

async function callGemini(apiKey: string, history: ChatMessage[], model?: string, forceJson?: boolean): Promise<string> {
  const activeModel = model || AI_PROVIDERS.gemini.model;
  
  const modelVariants = [activeModel, `${activeModel}-latest`, 'gemini-1.5-flash-8b', 'gemini-pro'];
  const versions = ['v1beta', 'v1'];
  
  const endpoints: string[] = [];
  for (const v of versions) {
    for (const m of modelVariants) {
      endpoints.push(`https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent`);
    }
  }

  let lastError: any;
  for (const url of endpoints) {
    try {
      const response = await fetch(url + `?key=${encodeURIComponent(apiKey.trim())}`, {
        method: 'POST',
        headers: { 
          ['Content-Type']: 'application/json'
        },
        body: JSON.stringify({
          contents: history.map((h) => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.content }],
          })),
          generationConfig: { 
            maxOutputTokens: 1000, 
            temperature: 0.2, 
            ...(forceJson ? { responseMimeType: 'application/json' } : {})
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          continue;
        }
        throw new Error(`Gemini Error: ${response.status}`);
      }

      const data = await response.json() as any;
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Empty Gemini response');
      }
      
      if (forceJson) {
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      }
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All Gemini endpoints failed');
}

/** MiniMax Caller */
async function callMiniMax(apiKey: string, history: ChatMessage[], model: string): Promise<string> {
  const url = AI_PROVIDERS.minimax.endpoint;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ['Content-Type']: 'application/json',
      ['Authorization']: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: history.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    })
  });
  if (!res.ok) {
    throw new Error(`MiniMax Error: ${res.status}`);
  }
  const data = await res.json() as any;
  return data?.choices?.[0]?.message?.content || '';
}

/** MiniMax Stream Helper */
async function* callMiniMaxStream(apiKey: string, history: ChatMessage[], model: string): AsyncIterable<string> {
  const url = AI_PROVIDERS.minimax.endpoint;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ['Content-Type']: 'application/json',
      ['Authorization']: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: history.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })),
      stream: true
    })
  });
  
  if (!res.ok) {
    throw new Error(`MiniMax Stream Error: ${res.status}`);
  }
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.substring(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── AIClient ───────────────────────────────────────────────────────────────

export class AIClient {
  private context: vscode.ExtensionContext;
  private usageTracker: UsageTracker;
  private cache = new Map<string, ErrorExplanation>();
  public lastError: string | null = null;
  
  private sessionHistory = new Map<string, ChatMessage[]>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.usageTracker = new UsageTracker(context);
    this.syncProvider();
  }

  private syncProvider() {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const provider = config.get<string>('aiProvider', 'gemini');
    if (CURRENT_PROVIDER !== provider) {
      this.resetCaches();
      CURRENT_PROVIDER = provider;
    }
  }

  public resetCaches() {
    WORKING_GEMINI_ENDPOINT = null;
    CACHED_MODELS = {};
    this.cache.clear();
  }

  public getActiveModelName(): string {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const provider = config.get<AIProviderType>('aiProvider', 'gemini');
    const selectedModel = config.get<string>('selectedModel');
    
    if (selectedModel && selectedModel.trim()) {
      return selectedModel.split('/').pop() || selectedModel;
    }

    const labels: Record<string, string> = {
      gemini: 'Flash',
      openai: 'GPT-4o',
      claude: 'Claude-3',
      groq: 'Llama-3',
      ollama: 'Ollama',
      custom: 'Local AI'
    };
    return labels[provider] || 'AI';
  }

  async fetchAvailableModels(provider: AIProviderType): Promise<string[]> {
    if (CACHED_MODELS[provider]) {
      return CACHED_MODELS[provider];
    }

    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const customEndpoint = config.get<string>('customEndpoint');

    if (provider === 'ollama') {
      try {
        const base = customEndpoint ? customEndpoint.split('/v1')[0] : 'http://localhost:11434';
        const res = await fetch(`${base}/api/tags`);
        if (res.ok) {
          const data = await res.json() as any;
          return (data.models || []).map((m: any) => m.name);
        }
      } catch (e) {
        // Fallback
      }
      return ['llama3', 'mistral'];
    }

    if (provider === 'custom') {
      try {
        const base = customEndpoint ? customEndpoint.split('/chat/completions')[0] : '';
        if (base) {
          const res = await fetch(`${base}/models`);
          if (res.ok) {
            const data = await res.json() as any;
            return (data.data || []).map((m: any) => m.id);
          }
        }
      } catch (e) {
        // Fallback
      }
      return ['custom-model'];
    }

    if (provider !== 'gemini') {
      const defaults: Record<string, string[]> = {
        openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        claude: ['claude-3-5-sonnet-latest', 'claude-3-haiku-latest'],
        groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
      };
      return defaults[provider] || [];
    }

    const auth = await this.getApiKey('gemini');
    if (!auth) {
      return ['gemini-1.5-flash'];
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(auth.key.trim())}`;
      const res = await fetch(url);
      const data = await res.json() as any;
      const ids = (data.models || [])
        .map((m: any) => m.name.replace('models/', ''))
        .filter((id: string) => !id.includes('embedding') && !id.includes('vision'));
      CACHED_MODELS[provider] = ids;
      return ids;
    } catch (e) {
      return ['gemini-1.5-flash'];
    }
  }

  public async getApiKey(provider?: AIProviderType): Promise<{ provider: AIProviderType; key: string } | null> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const activeProvider = provider || config.get<AIProviderType>('aiProvider', 'gemini');
    
    if (activeProvider === 'ollama') {
      return { key: 'local', provider: 'ollama' };
    }
    const endpoint = config.get<string>('customEndpoint', '');
    if (activeProvider === 'custom' && (endpoint.includes('localhost') || endpoint.includes('127.0.0.1'))) {
      return { key: 'local', provider: 'custom' };
    }

    let rawKeys: string | undefined;
    const providerSecret = await this.context.secrets.get(`terminalBuddy.apiKey.${activeProvider}`);
    if (providerSecret) {
      rawKeys = providerSecret;
    } else {
      rawKeys = await this.context.secrets.get('terminalBuddy.apiKey');
    }

    if (!rawKeys) {
      return null;
    }

    // 🔄 Support multiple keys separated by comma
    const keys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (keys.length === 0) {
      return null;
    }

    // Rotate keys
    const index = PROVIDER_KEY_INDEX[activeProvider] || 0;
    const selectedKey = keys[index % keys.length];
    
    // Increment for next time
    PROVIDER_KEY_INDEX[activeProvider] = (index + 1) % keys.length;

    return { key: selectedKey, provider: activeProvider };
  }

  public static detectProviderFromKey(key: string): AIProviderType | null {
    const k = key.trim();
    if (k.startsWith('sk-ant-')) { return 'claude'; }
    if (k.startsWith('gsk_')) { return 'groq'; }
    if (k.startsWith('sk-')) { return 'openai'; }
    if (k.length > 30 && (k.startsWith('AIza') || /^[A-Za-z0-9_-]+$/.test(k))) { return 'gemini'; }
    return null;
  }

  /** Returns a map of provider -> true if an API key or local config exists */
  public async getAllAuthConfigured(): Promise<Record<string, boolean>> {
    const providers: AIProviderType[] = ['gemini', 'openai', 'claude', 'groq', 'ollama', 'zai', 'minimax', 'custom'];
    const results: Record<string, boolean> = {};
    
    for (const p of providers) {
      const auth = await this.getApiKey(p);
      results[p] = !!auth;
    }
    return results;
  }

  public async getUsageSummary() {
    return this.usageTracker.getSummary();
  }

  public async clearUsageHistory() {
    return this.usageTracker.clearHistory();
  }

  async setApiKey(provider: AIProviderType, key: string): Promise<void> {
    await this.context.secrets.store(`terminalBuddy.apiKey.${provider}`, key);
    // Also update global cache to ensure immediate validation works
    if (vscode.workspace.getConfiguration('terminalBuddy').get('aiProvider') === provider) {
       this.resetCaches();
    }
  }

  async validateKey(provider: AIProviderType, key: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.lastError = null;
      const caller = CALLERS[provider];
      const endpoint = vscode.workspace.getConfiguration('terminalBuddy').get<string>('customEndpoint');
      
      // If local, just ensure it's reachable
      if (key === 'local') {
          const res = await fetch(endpoint || 'http://localhost:11434');
          return { success: res.ok || res.status === 404 }; // 404 is fine as long as server is alive
      }

      await caller(key, [{ role: 'user', content: 'ping' }], undefined, false, endpoint);
      return { success: true };
    } catch (err: any) {
      if (err.message?.includes('fetch')) {
         const raw = vscode.workspace.getConfiguration('terminalBuddy').get<string>('customEndpoint') || 'http://localhost';
         this.lastError = `Failed to reach ${safeHost(raw)}`;
      } else {
         this.lastError = err.message || String(err);
      }
      return { success: false, error: this.lastError || undefined };
    }
  }

  async explain(entry: CommandEntry, projectInfo?: ProjectInfo): Promise<ErrorExplanation | null> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const provider = config.get<AIProviderType>('aiProvider', 'gemini');
    const auth = await this.getApiKey(provider);
    
    if (!auth) {
      return null;
    }

    try {
      const selectedModel = config.get<string>('selectedModel');
      const models = await this.fetchAvailableModels(provider);
      const modelToUse = selectedModel || models[0];

      const cleanError = redactSensitiveInfo(entry.errorOutput || 'N/A');
      const prompt = errorExplanationPrompt(
        entry.cmd,
        entry.cwd || 'unknown',
        (projectInfo?.type as any) ?? 'unknown',
        projectInfo?.topLevelFiles ?? [],
        cleanError,
        ''
      );

      const wsId = entry.project || 'global';
      this.sessionHistory.set(wsId, [{ role: 'user', content: prompt }]);

      const caller = CALLERS[auth.provider];
      const endpoint = config.get<string>('customEndpoint');
      const raw = await caller(auth.key, this.sessionHistory.get(wsId)!, modelToUse, true, endpoint);

      // Track usage
      this.trackUsage(auth.provider, modelToUse, prompt, raw);

      const explanation = this.parseExplanation(raw);
      return explanation;
    } catch (err) {
      return null;
    }
  }

  async callRaw(prompt: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const auth = await this.getApiKey();
    if (!auth) {
      return null;
    }

    try {
      const selectedModel = config.get<string>('selectedModel');
      const caller = CALLERS[auth.provider];
      const endpoint = config.get<string>('customEndpoint');
      const models = await this.fetchAvailableModels(auth.provider);
      const modelToUse = selectedModel || models[0];
      const res = await caller(auth.key, [{ role: 'user', content: prompt }], modelToUse, false, endpoint);
      
      this.trackUsage(auth.provider, modelToUse, prompt, res);
      return res;
    } catch (err) {
      return null;
    }
  }

  private trackUsage(provider: AIProviderType, model: string, prompt: string, completion: string) {
    // Rough estimate: 1 token per 4 chars
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil(completion.length / 4);
    this.usageTracker.logUsage({ provider, model, promptTokens, completionTokens }).catch(console.error);
  }

  async *askDoubtStream(cmd: string, errorOutput: string, question: string): AsyncIterable<string> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const auth = await this.getApiKey();
    if (!auth) {
      return;
    }

    try {
      const prompt = doubtClearingPrompt(cmd, errorOutput, question);
      const wsId = 'global';
      const selectedModel = config.get<string>('selectedModel');
      const models = await this.fetchAvailableModels(auth.provider);
      const modelToUse = selectedModel || models[0];
      
      const history = [{ role: 'user' as const, content: prompt }];
      const caller = STREAM_CALLERS[auth.provider];
      const endpoint = config.get<string>('customEndpoint');
      
      let fullResponse = '';
      for await (const chunk of caller(auth.key, history, modelToUse, endpoint)) {
        fullResponse += chunk;
        yield chunk;
      }
      this.trackUsage(auth.provider, modelToUse, prompt, fullResponse);
    } catch (err: any) {
      yield `❌ AI Error: ${err?.message || String(err)}`;
    }
  }

  async *chatStream(question: string, projectType: string, cwd: string, files: string[], terminals: any[] = []): AsyncIterable<string> {
    if (typeof fetch === 'undefined') {
      yield "❌ Error: 'fetch' is not available in this environment. Please update VS Code to the latest version.";
      return;
    }
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const auth = await this.getApiKey();
    if (!auth) {
      yield "❌ AI Offline: Please configure an API key in Terminal Buddy Settings or the Dashboard (Settings tab).";
      return;
    }

    try {
      const prompt = chatPrompt(question, projectType, cwd, files, terminals);
      const selectedModel = config.get<string>('selectedModel');
      const models = await this.fetchAvailableModels(auth.provider);
      const modelToUse = selectedModel || models[0];

      const history = [{ role: 'user' as const, content: prompt }];
      const caller = STREAM_CALLERS[auth.provider];
      const endpoint = config.get<string>('customEndpoint');

      let fullResponse = '';
      for await (const chunk of caller(auth.key, history, modelToUse, endpoint)) {
        fullResponse += chunk;
        yield chunk;
      }
      this.trackUsage(auth.provider, modelToUse, prompt, fullResponse);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[Terminal Buddy] Chat Stream Error:', err);
      yield `❌ AI Error: ${msg}`;
    }
  }

  async resolvePathQuery(query: string, workspaceMap: any, wsPath: string): Promise<string | null> {
    const projects = workspaceMap.projects.map((p: any) => `${p.name} at ${p.path}`).join('\n');
    const prompt = `Given this workspace structure:\n${projects}\n\nClient wants to move to: "${query}"\nIdentify the full absolute path of the most relevant project or subdirectory within the workspace: ${wsPath}.\nReturn ONLY the absolute path, no other text.`;
    
    const result = await this.callRaw(prompt);
    if (result) {
      return result.trim().replace(/^Paths?: /, '').replace(/['"]/g, '');
    }
    return null;
  }

  async describeTerminal(name: string, history: string): Promise<string> {
    const prompt = `Describe the purpose of this VS Code terminal based on its recent history:\nTerminal Name: ${name}\nHistory:\n${history}\n\nRespond with a 2-4 word description (e.g. "React Dev Server", "Git Operations", "Idle Shell").`;
    const result = await this.callRaw(prompt);
    return result?.trim() || 'Active Terminal';
  }

  private parseExplanation(raw: string): ErrorExplanation | null {
    try {
      const json = JSON.parse(raw);
      return {
        summary: json.summary || 'No summary',
        cause: json.cause || 'Unknown',
        fix: json.fix || 'No fix suggested',
        suggestedCommands: json.suggestedCommands || [],
        fromCache: false,
        source: 'ai'
      };
    } catch {
      return {
        summary: raw,
        cause: 'Unknown',
        fix: 'See summary',
        fromCache: false,
        source: 'ai'
      };
    }
  }

  private makeCacheKey(cmd: string, output: string): string {
    return `${cmd}:${output.slice(0, 100)}`;
  }
}
