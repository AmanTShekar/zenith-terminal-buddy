import * as vscode from 'vscode';
import {
  AIProviderType, AI_PROVIDERS, ErrorExplanation, CommandEntry, ProjectInfo, WorkspaceMap,
  AI_RATE_LIMIT_MS, AI_TIMEOUT_MS, AI_CACHE_MAX,
} from '../types';
import { doubtClearingPrompt, errorExplanationPrompt } from './prompts';

// ─── Shared Types ───────────────────────────────────────────────────────────

export interface AIResponse {
  content: string;
  isStreaming?: boolean;
}

export type StreamCallback = (chunk: string) => void;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ─── Provider implementations ───────────────────────────────────────────────

async function* callGeminiStream(apiKey: string, history: ChatMessage[], model?: string): AsyncIterable<string> {
  const activeModel = model || AI_PROVIDERS.gemini.model;
  const encodedKey = encodeURIComponent(apiKey.trim());
  
  const modelVariants = [activeModel, `${activeModel}-latest`, 'gemini-1.5-flash-8b', 'gemini-pro'];
  const versions = ['v1beta', 'v1'];
  
  const endpoints: string[] = [];
  for (const v of versions) {
    for (const m of modelVariants) {
      endpoints.push(`https://generativelanguage.googleapis.com/${v}/models/${m}:streamGenerateContent?alt=sse&key=${encodedKey}`);
    }
  }
  
  let lastError: any;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: history.map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.content }],
          })),
          generationConfig: { maxOutputTokens: 1000, temperature: 0.2 }
        })
      });

      if (!response.ok) {
        if (response.status === 404) continue; // Try next endpoint
        throw new Error(`Gemini Stream Error: ${response.status}`);
      }
      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) yield text;
            } catch (e) {}
          }
        }
      }
      return; // Success, stop trying endpoints
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All Gemini endpoints failed');
}

async function* callOpenAIStream(apiKey: string, history: ChatMessage[], endpoint: string, model: string): AsyncIterable<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: history,
      max_tokens: 500,
      temperature: 0.3,
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(`AI Provider Stream Error: ${res.status}`);
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const data = line.replace('data: ', '').trim();
        if (data === '[DONE]') break;
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices[0]?.delta?.content;
          if (content) yield content;
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* callClaudeStream(apiKey: string, history: ChatMessage[], model?: string): AsyncIterable<string> {
  const config = AI_PROVIDERS.claude;
  const activeModel = model || config.model;
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: activeModel,
      max_tokens: 500,
      messages: history,
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(`Claude Stream Error: ${res.status}`);
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
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
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Callers Maps ───────────────────────────────────────────────────────────

type CallerFunc = (apiKey: string, history: ChatMessage[], model?: string, forceJson?: boolean) => Promise<string>;
type StreamCallerFunc = (apiKey: string, history: ChatMessage[], model?: string) => AsyncIterable<string>;

const STREAM_CALLERS: Record<AIProviderType, StreamCallerFunc> = {
  gemini: callGeminiStream,
  openai: (key, hist, mod) => callOpenAIStream(key, hist, AI_PROVIDERS.openai.endpoint, mod || AI_PROVIDERS.openai.model),
  claude: (key, hist, mod) => callClaudeStream(key, hist, mod),
  groq: (key, hist, mod) => callOpenAIStream(key, hist, AI_PROVIDERS.groq.endpoint, mod || AI_PROVIDERS.groq.model),
};

const CALLERS: Record<AIProviderType, CallerFunc> = {
  gemini: (key, hist, mod, force) => callGemini(key, hist, mod, force),
  openai: (key, hist, mod, force) => callOpenAI(key, hist, mod, force),
  claude: (key, hist, mod, force) => callClaude(key, hist, mod),
  groq: (key, hist, mod, force) => callGroq(key, hist, mod, force),
};

async function callGemini(apiKey: string, history: ChatMessage[], model?: string, forceJson?: boolean): Promise<string> {
  const activeModel = model || AI_PROVIDERS.gemini.model;
  const encodedKey = encodeURIComponent(apiKey.trim());
  
  const modelVariants = [activeModel, `${activeModel}-latest`, 'gemini-1.5-flash-8b', 'gemini-pro'];
  const versions = ['v1beta', 'v1'];
  
  const endpoints: string[] = [];
  for (const v of versions) {
    for (const m of modelVariants) {
      endpoints.push(`https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${encodedKey}`);
    }
  }

  let lastError: any;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: history.map(h => ({
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
        if (response.status === 404) continue;
        throw new Error(`Gemini Error: ${response.status}`);
      }

      const data = await response.json() as any;
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');
      
      // Clean markdown code blocks if present
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


async function callOpenAI(apiKey: string, history: ChatMessage[], model?: string, forceJson = false): Promise<string> {
  const config = AI_PROVIDERS.openai;
  const activeModel = model || config.model;
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: activeModel, messages: history, max_tokens: 500, temperature: 0.3, ...(forceJson ? { response_format: { type: 'json_object' } } : {}) }),
  });
  const data = await res.json() as any;
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callClaude(apiKey: string, history: ChatMessage[], model?: string): Promise<string> {
  const config = AI_PROVIDERS.claude;
  const activeModel = model || config.model;
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: activeModel, max_tokens: 500, messages: history }),
  });
  const data = await res.json() as any;
  return data?.content?.[0]?.text ?? '';
}

async function callGroq(apiKey: string, history: ChatMessage[], model?: string, forceJson = false): Promise<string> {
  const config = AI_PROVIDERS.groq;
  const activeModel = model || config.model;
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: activeModel, messages: history, max_tokens: 500, temperature: 0.3, ...(forceJson ? { response_format: { type: 'json_object' } } : {}) }),
  });
  const data = await res.json() as any;
  return data?.choices?.[0]?.message?.content ?? '';
}


// ─── AIClient ───────────────────────────────────────────────────────────────

export class AIClient {
  private context: vscode.ExtensionContext;
  private cache = new Map<string, ErrorExplanation>();
  private lastCallAt = 0;
  public lastError: string | null = null;
  
  // Persist conversation per-workspace to provide memory context
  private sessionHistory: Map<string, ChatMessage[]> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // ── Fetch Available Models ───────────────────────────────────────────
  async fetchAvailableModels(provider: AIProviderType): Promise<string[]> {
    if (provider !== 'gemini') {
      const defaults: Record<string, string[]> = {
        openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        claude: ['claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307'],
        groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant']
      };
      return defaults[provider] || [];
    }

    const auth = await this.getApiKey('gemini');
    if (!auth) return ['gemini-1.5-flash'];

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(auth.key.trim())}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Model Discover Error: ${res.status}`);
      const data = await res.json() as any;
      
      const ids = (data.models || [])
        .map((m: any) => m.name.replace('models/', ''))
        .filter((id: string) => !id.includes('embedding') && !id.includes('vision') && !id.includes('aqa'));
      
      return ids.sort((a: string, b: string) => {
        const score = (s: string) => (s.includes('flash') ? 2 : s.includes('lite') ? 1 : 0);
        return score(b) - score(a);
      });
    } catch (e) {
      console.warn('[Terminal Buddy] Gemini Auto-discovery failed:', e);
      return ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];
    }
  }

  public async getApiKey(provider?: AIProviderType): Promise<{ provider: AIProviderType; key: string } | null> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const activeProvider = provider || config.get<AIProviderType>('aiProvider', 'gemini');
    
    const globalKey = await this.context.secrets.get('terminalBuddy.apiKey');
    if (globalKey) {
      return { key: globalKey, provider: activeProvider };
    }

    const legacyKey = await this.context.secrets.get(`terminalBuddy.${activeProvider}ApiKey`);
    if (legacyKey) {
      return { key: legacyKey, provider: activeProvider };
    }

    const configKey = config.get<string>(`${activeProvider}ApiKey`);
    if (configKey) {
      return { key: configKey, provider: activeProvider };
    }

    return null;
  }

  async validateKey(provider: AIProviderType, key: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.lastError = null;
      const caller = CALLERS[provider];
      
      let modelToTry: string | undefined;
      if (provider === 'gemini') {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key.trim())}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json() as any;
            const flashModel = (data.models || []).find((m: any) => m.name.includes('flash') || m.name.includes('lite'));
            if (flashModel) {
              modelToTry = flashModel.name.replace('models/', '');
            }
          }
        } catch (e) { /* fallback */ }
      }

      await caller(key, [{ role: 'user', content: 'Respond with "ok".' }], modelToTry);
      return { success: true };
    } catch (err: any) {
      this.lastError = err.message || String(err);
      console.warn(`[Terminal Buddy] API key validation failed for ${provider}:`, err);
      return { success: false, error: this.lastError || undefined };
    }
  }

  async hasKey(provider: AIProviderType): Promise<boolean> {
    const auth = await this.getApiKey(provider);
    return !!auth;
  }

  async setApiKey(key: string): Promise<void> {
    await this.context.secrets.store('terminalBuddy.apiKey', key);
    this.lastCallAt = 0;
  }

  async explain(entry: CommandEntry, projectInfo?: ProjectInfo): Promise<ErrorExplanation | null> {
    if (!entry.errorOutput) { return null; }

    const now = Date.now();
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const cooldown = config.get<number>('aiCooldownMs', 1000); // Default to 1s
    
    if (now - this.lastCallAt < cooldown) {
      return null;
    }

    const cacheKey = this.makeCacheKey(entry.cmd, entry.errorOutput);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const provider = config.get<AIProviderType>('aiProvider', 'gemini');
    const auth = await this.getApiKey(provider);
    
    if (!auth) { return null; }

    try {
      this.lastCallAt = now;
      const selectedModel = config.get<string>('selectedModel');
      const models = await this.fetchAvailableModels(provider);
      const modelToUse = selectedModel || models[0];

      const prompt = errorExplanationPrompt(
        entry.cmd,
        entry.cwd,
        projectInfo?.type ?? 'unknown',
        projectInfo?.topLevelFiles ?? [],
        entry.errorOutput,
      );

      const wsId = entry.project || 'global';
      this.sessionHistory.set(wsId, [{ role: 'user', content: prompt }]);

      const caller = CALLERS[auth.provider];
      const raw = await caller(auth.key, this.sessionHistory.get(wsId)!, modelToUse, true);

      if (!this.sessionHistory.has(wsId)) { this.sessionHistory.set(wsId, []); }
      this.sessionHistory.get(wsId)!.push({ role: 'assistant', content: raw });

      const explanation = this.parseExplanation(raw);
      if (explanation) {
        if (this.cache.size >= AI_CACHE_MAX) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey) { this.cache.delete(firstKey); }
        }
        this.cache.set(cacheKey, explanation);
      }

      return explanation;

    } catch (err: any) {
      console.error('[Terminal Buddy] AI explain call failed:', err);
      return null;
    }
  }

  async callRaw(prompt: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const auth = await this.getApiKey();
    if (!auth) return null;

    try {
      const caller = CALLERS[auth.provider];
      const selectedModel = config.get<string>('selectedModel');
      const modelToUse = (selectedModel && selectedModel.trim()) || (await this.fetchAvailableModels(auth.provider))[0];
      return await caller(auth.key, [{ role: 'user', content: prompt }], modelToUse, false);
    } catch (err) {
      console.error('[Terminal Buddy] callRaw failed:', err);
      return null;
    }
  }

  async searchHistory(query: string, log: CommandEntry[]): Promise<CommandEntry[] | null> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const auth = await this.getApiKey();
    if (!auth) return null;

    const seen = new Set<string>();
    const uniqueLogs = log.filter(l => {
        if (seen.has(l.cmd)) return false;
        seen.add(l.cmd);
        return true;
    }).slice(0, 50);

    const system = `You are a terminal history search assistant. 
    Target query: "${query}"
    Below is the user's terminal history. Reply ONLY with a comma-separated list of IDs (e.g. "id1,id2") that are most relevant to the query. 
    If none are relevant, reply "NONE".`;

    const user = uniqueLogs.map(l => `ID: ${l.id} | CMD: ${l.cmd} | CWD: ${l.cwd}`).join('\n');

    try {
      const caller = CALLERS[auth.provider];
      const res = await caller(auth.key, [{ role: 'user', content: system + '\n\n' + user }], undefined, false);
      
      if (!res || res.trim() === 'NONE') return null;

      const ids = res.split(',').map((s: string) => s.trim());
      return log.filter(l => ids.includes(l.id));
    } catch (e) {
      console.warn('[Terminal Buddy] History search failed:', e);
      return null;
    }
  }

  async *askDoubtStream(cmd: string, errorOutput: string, question: string): AsyncIterable<string> {
    const now = Date.now();
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const cooldown = config.get<number>('aiCooldownMs', 4000);

    if (now - this.lastCallAt < cooldown) {
       yield 'Wait a moment before asking another question (Rate Limited)...';
       return;
    }

    const auth = await this.getApiKey();
    if (!auth) {
      yield 'AI is not configured. Please run "Terminal Buddy: Set AI API Key".';
      return;
    }

    this.lastCallAt = now;

    try {
      const prompt = doubtClearingPrompt(cmd, errorOutput, question);
      const wsId = vscode.workspace.workspaceFolders?.[0]?.name || 'global';
      const selectedModel = config.get<string>('selectedModel');
      const modelToUse = (selectedModel && selectedModel.trim()) || (await this.fetchAvailableModels(auth.provider))[0];
      
      await this.summarizeHistory(wsId, auth);
      const history = this.sessionHistory.get(wsId) || [];
      
      if (history.length === 0) {
         history.push({ role: 'user', content: `Original Error Context:\nCmd: ${cmd}\nError: ${errorOutput}\n` });
      }
      history.push({ role: 'user', content: prompt });
      this.sessionHistory.set(wsId, history);

      const caller = STREAM_CALLERS[auth.provider];
      let fullAnswer = '';
      
      for await (const chunk of caller(auth.key, history, modelToUse)) {
        fullAnswer += chunk;
        yield chunk;
      }
      
      this.sessionHistory.get(wsId)!.push({ role: 'assistant', content: fullAnswer });
    } catch (err: any) {
      console.error('[Terminal Buddy] Chat stream failed:', err);
      yield `ERROR: I couldn't reach the AI. Details: ${err.message || 'Network issue'}.`;
    }
  }

  public async askDoubt(
    cmd: string, 
    output: string, 
    question: string,
    onChunk?: StreamCallback
  ): Promise<string | null> {
    const auth = await this.getApiKey();
    if (!auth) return null;

    const wsId = vscode.workspace.workspaceFolders?.[0]?.name || 'global';
    const history = this.sessionHistory.get(wsId) || [];
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const selectedModel = config.get<string>('selectedModel');
    const modelToUse = (selectedModel && selectedModel.trim()) || undefined;
    
    const prompt = `You are Terminal Buddy's expert shell assistant.
Context:
Command: ${cmd}
Output: ${output}

Question: ${question}

Provide a concise, helpful answer (max 4 sentences). If you suggest a command, wrap it in backticks.`;

    history.push({ role: 'user', content: prompt });

    if (onChunk) {
       const caller = STREAM_CALLERS[auth.provider];
       let full = '';
       for await (const chunk of caller(auth.key, history, modelToUse)) {
         full += chunk;
         onChunk(chunk);
       }
       history.push({ role: 'assistant', content: full });
       return full;
    }

    const res = await CALLERS[auth.provider](auth.key, history, modelToUse);
    history.push({ role: 'assistant', content: res });
    return res;
  }

  private async summarizeHistory(wsId: string, auth: { provider: AIProviderType, key: string }) {
    const history = this.sessionHistory.get(wsId);
    if (!history || history.length <= 10) return;

    try {
      const summaryPrompt = "Please concisely summarize the terminal issue we are debugging progress made so far. Keep it strictly under 150 words.";
      const caller = CALLERS[auth.provider];
      const tempHistory = [...history, { role: 'user' as const, content: summaryPrompt }];
      const summary = await caller(auth.key, tempHistory, undefined, false);
      
      this.sessionHistory.set(wsId, [
        { role: 'user', content: 'PREVIOUS CONTEXT:\n' + summary },
        { role: 'assistant', content: 'Understood.' }
      ]);
    } catch (e) {}
  }

  private parseExplanation(raw: string): ErrorExplanation | null {
    try {
      const cleaned = raw.replace(/^```json/m, '').replace(/```$/m, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { throw new Error('No JSON object found'); }
        parsed = JSON.parse(jsonMatch[0]);
      }

      return {
        summary: parsed.summary ?? raw.slice(0, 100),
        cause: parsed.cause ?? '',
        fix: parsed.fix ?? '',
        suggestedCommands: Array.isArray(parsed.suggestedCommands)
          ? parsed.suggestedCommands.filter((s: any) => typeof s === 'string').slice(0, 2)
          : [],
        fromCache: false,
        source: 'ai',
      };
    } catch (err: any) {
      console.warn('[Terminal Buddy] parseExplanation failed:', err.message);
      return {
        summary: raw.trim() || "Buddy is puzzled by this one. Try asking specifically in chat!",
        cause: '',
        fix: '',
        suggestedCommands: [],
        fromCache: false,
        source: 'ai',
      };
    }
  }

  async generateCommand(prompt: string, context?: WorkspaceMap): Promise<string | null> {
    const auth = await this.getApiKey();
    if (!auth) return null;

    const system = `You are a terminal expert. Convert the user's natural language request into a single, valid shell command.
    Context (Project info): ${JSON.stringify(context || {})}
    Reply ONLY with the command. No explanations.`;

    try {
      const config = vscode.workspace.getConfiguration('terminalBuddy');
      const selectedModel = config.get<string>('selectedModel');
      const modelToUse = (selectedModel && selectedModel.trim()) || (await this.fetchAvailableModels(auth.provider))[0];
      
      const res = await CALLERS[auth.provider](auth.key, [{ role: 'user', content: system + '\n\nRequest: ' + prompt }], modelToUse, false);
      return res.trim().replace(/^`+|`+$/g, '');
    } catch (e) {
      console.warn('[Terminal Buddy] Command generation failed:', e);
      return null;
    }
  }

  private makeCacheKey(cmd: string, errorOutput: string): string {
    const firstLine = errorOutput.split('\n')[0] ?? '';
    return `${cmd}::${firstLine}`.slice(0, 200);
  }
}
