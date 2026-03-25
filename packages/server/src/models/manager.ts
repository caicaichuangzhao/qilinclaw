import Bottleneck from 'bottleneck';
import type { LLMConfig, ChatRequest, ChatResponse, StreamChunk } from '../types/index.js';
import { createLLMAdapter, type LLMAdapter } from './adapter.js';

export class LLMManager {
  private configs: Map<string, LLMConfig> = new Map();
  private adapters: Map<string, LLMAdapter> = new Map();
  private limiters: Map<string, Bottleneck> = new Map();
  private defaultConfigId: string | null = null;

  constructor() {
    this.loadConfigs();
  }

  private loadConfigs(): void {
    // TODO: Load from database
  }

  addConfig(config: LLMConfig): void {
    this.configs.set(config.id, config);
    const adapter = createLLMAdapter(config);
    this.adapters.set(config.id, adapter);

    const limiter = new Bottleneck({
      minTime: 100,
      maxConcurrent: 5,
      reservoir: 60,
      reservoirRefreshAmount: 60,
      reservoirRefreshInterval: 60 * 1000,
    });
    this.limiters.set(config.id, limiter);

    if (!this.defaultConfigId) {
      // 优先选择有 API 密钥的配置作为默认
      const allConfigs = Array.from(this.configs.values());
      const preferredConfig = allConfigs.find(config =>
        config.apiKey &&
        config.apiKey.trim() !== ''
      );
      this.defaultConfigId = preferredConfig ? preferredConfig.id : config.id;
    }
  }

  removeConfig(id: string): void {
    this.configs.delete(id);
    this.adapters.delete(id);
    this.limiters.delete(id);
    if (this.defaultConfigId === id) {
      // 优先选择有 API 密钥的配置作为默认
      const allConfigs = Array.from(this.configs.values());
      const preferredConfig = allConfigs.find(config =>
        config.apiKey &&
        config.apiKey.trim() !== ''
      );
      this.defaultConfigId = preferredConfig ? preferredConfig.id : this.configs.keys().next().value || null;
    }
  }

  getConfig(id: string): LLMConfig | undefined {
    return this.configs.get(id);
  }

  getAllConfigs(): LLMConfig[] {
    return Array.from(this.configs.values());
  }

  setDefault(id: string): void {
    if (this.configs.has(id)) {
      this.defaultConfigId = id;
    }
  }

  getDefaultConfig(): LLMConfig | undefined {
    return this.defaultConfigId ? this.configs.get(this.defaultConfigId) : undefined;
  }

  async chat(request: ChatRequest, configId?: string): Promise<ChatResponse> {
    const id = configId || this.defaultConfigId;
    if (!id) {
      throw new Error('No LLM configuration available');
    }

    const adapter = this.adapters.get(id);
    const limiter = this.limiters.get(id);

    if (!adapter) {
      throw new Error(`LLM configuration not found: ${id}`);
    }

    if (limiter) {
      return limiter.schedule(() => adapter.chat(request));
    }

    return adapter.chat(request);
  }

  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: StreamChunk) => void,
    configId?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const id = configId || this.defaultConfigId;
    if (!id) {
      throw new Error('No LLM configuration available');
    }

    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`LLM configuration not found: ${id}`);
    }

    return adapter.chatStream(request, onChunk, signal);
  }

  async checkAvailability(id: string): Promise<boolean> {
    const adapter = this.adapters.get(id);
    if (!adapter) return false;
    return adapter.isAvailable();
  }

  async getAvailableModels(id: string): Promise<string[]> {
    const adapter = this.adapters.get(id);
    if (!adapter) return [];
    return adapter.getModels();
  }

  updateConfig(id: string, updates: Partial<LLMConfig>): void {
    const config = this.configs.get(id);
    if (!config) return;

    const newConfig = { ...config, ...updates };

    // Remove old adapter and create new one with updated config
    this.adapters.delete(id);
    const adapter = createLLMAdapter(newConfig);
    this.adapters.set(id, adapter);

    // Update config
    this.configs.set(id, newConfig);

    console.log(`[LLMManager] Updated config: ${newConfig.name} (${newConfig.model})`);
  }
}

export const modelsManager = new LLMManager();
