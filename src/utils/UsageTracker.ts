import * as vscode from 'vscode';
import { UsageRecord, AIProviderType, ProviderUsageSummary, AI_PROVIDERS } from '../types';

export class UsageTracker {
  private static readonly storageKey = 'terminalBuddy.usageHistory';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public async logUsage(record: Omit<UsageRecord, 'timestamp' | 'costEstimate' | 'totalTokens'>): Promise<UsageRecord> {
    const config = AI_PROVIDERS[record.provider];
    const costPrompt = (record.promptTokens / 1000) * (config.costPer1kTokens?.prompt || 0);
    const costCompletion = (record.completionTokens / 1000) * (config.costPer1kTokens?.completion || 0);
    
    const fullRecord: UsageRecord = {
      ...record,
      totalTokens: record.promptTokens + record.completionTokens,
      costEstimate: costPrompt + costCompletion,
      timestamp: Date.now()
    };

    const history = await this.getHistory();
    history.push(fullRecord);
    
    // Keep last 1000 records to avoid bloat
    if (history.length > 1000) {
      history.shift();
    }

    await this.context.globalState.update(UsageTracker.storageKey, history);
    return fullRecord;
  }

  public async getHistory(): Promise<UsageRecord[]> {
    return this.context.globalState.get<UsageRecord[]>(UsageTracker.storageKey, []);
  }

  public async getSummary(): Promise<Record<string, ProviderUsageSummary>> {
    const history = await this.getHistory();
    const summary: Record<string, ProviderUsageSummary> = {};

    for (const record of history) {
      if (!summary[record.provider]) {
        summary[record.provider] = { totalTokens: 0, totalCost: 0, requestCount: 0 };
      }
      summary[record.provider].totalTokens += record.totalTokens;
      summary[record.provider].totalCost += record.costEstimate;
      summary[record.provider].requestCount += 1;
    }

    return summary;
  }

  public async clearHistory(): Promise<void> {
    await this.context.globalState.update(UsageTracker.storageKey, []);
  }
}
