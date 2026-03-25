import { vectorStore, type VectorEntry, type SearchResult } from './vector-store.js';
import { embeddingService } from './embedding-service.js';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface ContextConfig {
  maxTokens: number;
  recentMessageCount: number;
  relevantMessageCount: number;
  summaryThreshold: number;
  similarityThreshold: number;
}

export interface ContextResult {
  messages: Message[];
  tokenCount: number;
  usedMemory: boolean;
  relevantContexts: SearchResult[];
}

export class ContextMemory {
  private configPath: string;
  private config: ContextConfig = {
    maxTokens: 8192,
    recentMessageCount: 12,
    relevantMessageCount: 10,
    summaryThreshold: 30,
    similarityThreshold: 0.5,
  };

  private conversationSummaries: Map<string, string[]> = new Map();

  constructor() {
    const fs = require('fs');
    const path = require('path');
    this.configPath = path.join(process.cwd(), '.qilin-claw', 'context-memory-config.json');
    this.loadConfigFromDisk();
  }

  private loadConfigFromDisk(): void {
    const fs = require('fs');
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const savedConfig = JSON.parse(data);
        this.config = { ...this.config, ...savedConfig };
      }
    } catch (error) {
      console.error('[ContextMemory] Failed to load config from disk:', error);
    }
  }

  private saveConfigToDisk(): void {
    const fs = require('fs');
    const path = require('path');
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.error('[ContextMemory] Failed to save config to disk:', error);
    }
  }

  setConfig(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfigToDisk();
  }

  getConfig(): ContextConfig {
    return { ...this.config };
  }

  estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }

  async addMessage(
    conversationId: string,
    message: Message
  ): Promise<void> {
    try {
      const timestamp = message.timestamp || Date.now();
      const tokenCount = this.estimateTokens(message.content);

      console.log(`[ContextMemory] Adding message to conversation ${conversationId}, role: ${message.role}, content length: ${message.content.length}`);

      const embedding = await embeddingService.generateEmbedding(message.content);
      console.log(`[ContextMemory] Generated embedding, dimension: ${embedding.embedding.length}`);

      await vectorStore.addEntry(message.content, embedding.embedding, {
        role: message.role,
        timestamp,
        conversationId,
        tokenCount,
      });
      console.log(`[ContextMemory] Message saved to vector store`);

      const entries = await vectorStore.getConversationEntries(conversationId);
      if (entries.length >= this.config.summaryThreshold) {
        await this.createSummary(conversationId);
      }
    } catch (error) {
      console.error('[ContextMemory] Failed to add message:', error);
    }
  }

  async addMessages(
    conversationId: string,
    messages: Message[]
  ): Promise<void> {
    for (const message of messages) {
      await this.addMessage(conversationId, message);
    }
  }

  private async createSummary(conversationId: string): Promise<void> {
    const entries = await vectorStore.getConversationEntries(conversationId);
    if (entries.length < 10) return;

    const oldestEntries = entries.slice(0, Math.floor(entries.length / 2));

    const summaryText = this.generateSimpleSummary(oldestEntries);

    const summaryEmbedding = await embeddingService.generateEmbedding(summaryText);

    await vectorStore.addSummary(
      conversationId,
      summaryText,
      summaryEmbedding.embedding,
      oldestEntries.length,
      oldestEntries[0].metadata.timestamp,
      oldestEntries[oldestEntries.length - 1].metadata.timestamp
    );

    if (!this.conversationSummaries.has(conversationId)) {
      this.conversationSummaries.set(conversationId, []);
    }
    this.conversationSummaries.get(conversationId)!.push(summaryText);
  }

  private generateSimpleSummary(entries: VectorEntry[]): string {
    const userMessages = entries.filter(e => e.metadata.role === 'user');
    const assistantMessages = entries.filter(e => e.metadata.role === 'assistant');

    const topics = this.extractTopics(entries);

    return `对话摘要：讨论了${topics.join('、')}等内容。` +
      `共${userMessages.length}个用户提问，${assistantMessages.length}个回答。`;
  }

  private extractTopics(entries: VectorEntry[]): string[] {
    const allWords = entries
      .map(e => e.content)
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2);

    const wordFreq = new Map<string, number>();
    for (const word of allWords) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    const stopWords = new Set(['的', '是', '在', '了', '和', '有', '我', '你', '他', '她', '它', 'the', 'a', 'an', 'is', 'are', 'was', 'were']);

    return Array.from(wordFreq.entries())
      .filter(([word]) => !stopWords.has(word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  async getContext(
    conversationId: string,
    currentMessage: string,
    recentMessages: Message[] = []
  ): Promise<ContextResult> {
    const result: ContextResult = {
      messages: [],
      tokenCount: 0,
      usedMemory: false,
      relevantContexts: [],
    };

    const recentLimited = recentMessages.slice(-this.config.recentMessageCount);

    for (const msg of recentLimited) {
      const tokens = this.estimateTokens(msg.content);
      if (result.tokenCount + tokens > this.config.maxTokens) break;

      result.messages.push(msg);
      result.tokenCount += tokens;
    }

    if (currentMessage.trim()) {
      const currentEmbedding = await embeddingService.generateEmbedding(currentMessage);

      const relevantResults = await vectorStore.searchSimilar(currentEmbedding.embedding, {
        conversationId,
        limit: this.config.relevantMessageCount,
        threshold: this.config.similarityThreshold,
      });

      const relevantMessages: Message[] = [];
      let relevantTokens = 0;

      for (const searchResult of relevantResults) {
        const entry = searchResult.entry;
        const tokens = entry.metadata.tokenCount;

        if (result.tokenCount + relevantTokens + tokens > this.config.maxTokens) break;

        const isDuplicate = result.messages.some(
          m => m.content === entry.content && m.role === entry.metadata.role
        );

        if (!isDuplicate) {
          relevantMessages.push({
            role: entry.metadata.role,
            content: entry.content,
            timestamp: entry.metadata.timestamp,
          });
          relevantTokens += tokens;
          result.relevantContexts.push(searchResult);
        }
      }

      if (relevantMessages.length > 0) {
        result.messages = [...relevantMessages, ...result.messages];
        result.tokenCount += relevantTokens;
        result.usedMemory = true;
      }
    }

    const summaries = await vectorStore.getConversationSummaries(conversationId);
    if (summaries.length > 0 && result.messages.length < 3) {
      const latestSummary = summaries[summaries.length - 1];
      const summaryTokens = this.estimateTokens(latestSummary.summary);

      if (result.tokenCount + summaryTokens <= this.config.maxTokens) {
        result.messages.unshift({
          role: 'system',
          content: `[历史对话摘要] ${latestSummary.summary}`,
          timestamp: latestSummary.createdAt,
        });
        result.tokenCount += summaryTokens;
        result.usedMemory = true;
      }
    }

    return result;
  }

  async getGlobalContext(
    currentMessage: string,
    recentMessages: Message[] = [],
    excludeConversationId?: string
  ): Promise<ContextResult> {
    const result: ContextResult = {
      messages: [],
      tokenCount: 0,
      usedMemory: false,
      relevantContexts: [],
    };

    const recentLimited = recentMessages.slice(-this.config.recentMessageCount);

    for (const msg of recentLimited) {
      const tokens = this.estimateTokens(msg.content);
      if (result.tokenCount + tokens > this.config.maxTokens) break;

      result.messages.push(msg);
      result.tokenCount += tokens;
    }

    if (currentMessage.trim()) {
      const currentEmbedding = await embeddingService.generateEmbedding(currentMessage);

      const allResults = await vectorStore.searchSimilar(currentEmbedding.embedding, {
        limit: this.config.relevantMessageCount * 2,
        threshold: this.config.similarityThreshold,
      });

      const relevantMessages: Message[] = [];
      let relevantTokens = 0;

      for (const searchResult of allResults) {
        if (excludeConversationId && searchResult.entry.metadata.conversationId === excludeConversationId) {
          continue;
        }

        const entry = searchResult.entry;
        const tokens = entry.metadata.tokenCount;

        if (result.tokenCount + relevantTokens + tokens > this.config.maxTokens) break;

        const isDuplicate = result.messages.some(
          m => m.content === entry.content && m.role === entry.metadata.role
        );

        if (!isDuplicate) {
          relevantMessages.push({
            role: entry.metadata.role,
            content: entry.content,
            timestamp: entry.metadata.timestamp,
          });
          relevantTokens += tokens;
          result.relevantContexts.push(searchResult);
        }

        if (relevantMessages.length >= this.config.relevantMessageCount) break;
      }

      if (relevantMessages.length > 0) {
        result.messages = [...relevantMessages, ...result.messages];
        result.tokenCount += relevantTokens;
        result.usedMemory = true;
      }
    }

    return result;
  }

  async getContextFromConversations(
    query: string,
    conversationIds: string[],
    maxTokens: number = 2000
  ): Promise<string> {
    const embedding = await embeddingService.generateEmbedding(query);
    const allResults: SearchResult[] = [];

    for (const convId of conversationIds) {
      const results = await vectorStore.searchSimilar(embedding.embedding, {
        conversationId: convId,
        limit: 5,
        threshold: 0.6,
      });
      allResults.push(...results);
    }

    allResults.sort((a, b) => b.similarity - a.similarity);

    let context = '';
    let tokenCount = 0;

    for (const result of allResults) {
      const entry = result.entry;
      const text = `[${entry.metadata.role === 'user' ? '用户' : '助手'}]: ${entry.content}\n\n`;
      const tokens = this.estimateTokens(text);

      if (tokenCount + tokens > maxTokens) break;

      context += text;
      tokenCount += tokens;
    }

    return context;
  }

  async searchAcrossConversations(
    query: string,
    limit: number = 10,
    threshold?: number
  ): Promise<SearchResult[]> {
    const embedding = await embeddingService.generateEmbedding(query);
    return vectorStore.searchSimilar(embedding.embedding, { limit, threshold, queryText: query });
  }

  async getConversationStats(conversationId: string): Promise<{
    messageCount: number;
    summaryCount: number;
    oldestMessage?: number;
    newestMessage?: number;
  }> {
    const entries = await vectorStore.getConversationEntries(conversationId);
    const summaries = await vectorStore.getConversationSummaries(conversationId);

    return {
      messageCount: entries.length,
      summaryCount: summaries.length,
      oldestMessage: entries[0]?.metadata.timestamp,
      newestMessage: entries[entries.length - 1]?.metadata.timestamp,
    };
  }

  async clearConversation(conversationId: string): Promise<void> {
    await vectorStore.deleteConversation(conversationId);
    this.conversationSummaries.delete(conversationId);
  }

  async clearAll(): Promise<void> {
    await vectorStore.clear();
    this.conversationSummaries.clear();
  }

  async exportConversation(conversationId: string): Promise<{
    entries: VectorEntry[];
    summaries: string[];
  }> {
    const entries = await vectorStore.getConversationEntries(conversationId);
    const summaries = this.conversationSummaries.get(conversationId) || [];

    return { entries, summaries };
  }

  async getStats(): Promise<{
    vectorStore: Awaited<ReturnType<typeof vectorStore.getStats>>;
    embeddingCache: ReturnType<typeof embeddingService.getCacheStats>;
    conversationCount: number;
  }> {
    return {
      vectorStore: await vectorStore.getStats(),
      embeddingCache: embeddingService.getCacheStats(),
      conversationCount: this.conversationSummaries.size,
    };
  }
}

export const contextMemory = new ContextMemory();
