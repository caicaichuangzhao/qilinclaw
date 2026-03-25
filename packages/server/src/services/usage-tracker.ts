import fs from 'fs';
import path from 'path';

export interface UsageRecord {
  id: string;
  timestamp: number;
  agentId?: string;
  botId?: string;
  conversationId?: string;
  llmConfigId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
  duration: number;
  success: boolean;
  error?: string;
}

export interface DailyUsage {
  date: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  avgDuration: number;
  models: Record<string, { calls: number; tokens: number }>;
  agents: Record<string, { calls: number; tokens: number }>;
}

export interface UsageStats {
  totalCalls: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgCallsPerDay: number;
  avgTokensPerCall: number;
  period: {
    start: number;
    end: number;
  };
  dailyUsage: DailyUsage[];
  topModels: { model: string; calls: number; tokens: number }[];
  topAgents: { agentId: string; calls: number; tokens: number }[];
}

import { findModel } from '../data/models.js';

function getModelPricing(providerId: string, modelId: string): { input: number; output: number; currency?: string } {
  const info = findModel(modelId);
  if (info && info.pricing) {
    return {
      input: info.pricing.input || 0,
      output: info.pricing.output || 0,
      currency: info.pricing.currency
    };
  }
  return { input: 0, output: 0 };
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private dataPath: string;
  private maxRecords: number = 100000;

  constructor() {
    this.dataPath = path.join(process.cwd(), '.qilin-claw', 'usage-records.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        this.records = data.records || [];
        console.log(`[UsageTracker] Loaded ${this.records.length} usage records`);
      }
    } catch (error) {
      console.error('[UsageTracker] Failed to load from disk:', error);
      this.records = [];
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify({ records: this.records }, null, 2));
    } catch (error) {
      console.error('[UsageTracker] Failed to save to disk:', error);
    }
  }

  private calculateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const pricing = getModelPricing(provider, model);
    return (inputTokens * pricing.input / 1000) + (outputTokens * pricing.output / 1000);
  }

  recordUsage(params: {
    agentId?: string;
    botId?: string;
    conversationId?: string;
    llmConfigId: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    duration: number;
    success: boolean;
    error?: string;
  }): UsageRecord {
    const record: UsageRecord = {
      id: `usage-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      ...params,
      totalTokens: params.inputTokens + params.outputTokens,
      cost: this.calculateCost(params.provider, params.model, params.inputTokens, params.outputTokens),
    };

    this.records.push(record);

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    this.saveToDisk();

    console.log(`[UsageTracker] Recorded: ${params.model} - ${record.totalTokens} tokens - $${(record.cost || 0).toFixed(4)}`);

    return record;
  }

  getStats(startDate?: number, endDate?: number): UsageStats {
    const now = Date.now();
    const start = startDate || now - 30 * 24 * 60 * 60 * 1000;
    const end = endDate || now;

    const filteredRecords = this.records.filter(r => r.timestamp >= start && r.timestamp <= end);

    const dailyUsageMap = new Map<string, DailyUsage>();

    for (const record of filteredRecords) {
      const date = new Date(record.timestamp).toISOString().split('T')[0];

      if (!dailyUsageMap.has(date)) {
        dailyUsageMap.set(date, {
          date,
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          avgDuration: 0,
          models: {},
          agents: {},
        });
      }

      const daily = dailyUsageMap.get(date)!;
      daily.totalCalls++;
      if (record.success) daily.successCalls++;
      else daily.failedCalls++;
      daily.totalInputTokens += record.inputTokens;
      daily.totalOutputTokens += record.outputTokens;
      daily.totalTokens += record.totalTokens;
      daily.totalCost += record.cost || 0;
      daily.avgDuration = (daily.avgDuration * (daily.totalCalls - 1) + record.duration) / daily.totalCalls;

      if (!daily.models[record.model]) {
        daily.models[record.model] = { calls: 0, tokens: 0 };
      }
      daily.models[record.model].calls++;
      daily.models[record.model].tokens += record.totalTokens;

      if (record.agentId) {
        if (!daily.agents[record.agentId]) {
          daily.agents[record.agentId] = { calls: 0, tokens: 0 };
        }
        daily.agents[record.agentId].calls++;
        daily.agents[record.agentId].tokens += record.totalTokens;
      }
    }

    const modelStats = new Map<string, { calls: number; tokens: number }>();
    const agentStats = new Map<string, { calls: number; tokens: number }>();

    for (const record of filteredRecords) {
      if (!modelStats.has(record.model)) {
        modelStats.set(record.model, { calls: 0, tokens: 0 });
      }
      modelStats.get(record.model)!.calls++;
      modelStats.get(record.model)!.tokens += record.totalTokens;

      if (record.agentId) {
        if (!agentStats.has(record.agentId)) {
          agentStats.set(record.agentId, { calls: 0, tokens: 0 });
        }
        agentStats.get(record.agentId)!.calls++;
        agentStats.get(record.agentId)!.tokens += record.totalTokens;
      }
    }

    const topModels = Array.from(modelStats.entries())
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    const topAgents = Array.from(agentStats.entries())
      .map(([agentId, stats]) => ({ agentId, ...stats }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    const totalCalls = filteredRecords.length;
    const totalTokens = filteredRecords.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalInputTokens = filteredRecords.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = filteredRecords.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalCost = filteredRecords.reduce((sum, r) => sum + (r.cost || 0), 0);

    const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)));

    return {
      totalCalls,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      avgCallsPerDay: totalCalls / days,
      avgTokensPerCall: totalCalls > 0 ? totalTokens / totalCalls : 0,
      period: { start, end },
      dailyUsage: Array.from(dailyUsageMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      topModels,
      topAgents,
    };
  }

  getRecentRecords(limit: number = 100): UsageRecord[] {
    return this.records.slice(-limit).reverse();
  }

  clearOldRecords(olderThanDays: number = 90): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const originalLength = this.records.length;
    this.records = this.records.filter(r => r.timestamp >= cutoff);
    const removed = originalLength - this.records.length;
    if (removed > 0) {
      this.saveToDisk();
      console.log(`[UsageTracker] Cleared ${removed} old records`);
    }
    return removed;
  }
}

export const usageTracker = new UsageTracker();
