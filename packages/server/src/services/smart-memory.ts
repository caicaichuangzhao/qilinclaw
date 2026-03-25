import { contextMemory, type Message } from './context-memory.js';
import { embeddingService } from './embedding-service.js';
import { vectorStore } from './vector-store.js';
import { modelsManager } from '../models/manager.js';
import { logger } from './logger.js';

export interface KeyInfo {
  type: 'date' | 'task' | 'event' | 'preference' | 'fact' | 'reminder';
  content: string;
  timestamp: number;
  expiresAt?: number;
  metadata?: Record<string, any>;
}

export interface ExperienceMemory {
  id: string;
  summary: string;
  keyInfo: KeyInfo[];
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  importance: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  maxMemoryAge: number;
  compressionThreshold: number;
}

export class SmartMemory {
  private experiences: Map<string, ExperienceMemory> = new Map();
  private keyInfoStore: KeyInfo[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private config: HeartbeatConfig = {
    enabled: true,
    intervalMs: 60 * 60 * 1000,
    maxMemoryAge: 30 * 24 * 60 * 60 * 1000,
    compressionThreshold: 100,
  };
  private defaultLlmConfigId: string | null = null;
  private initialized: boolean = false;

  constructor() {
    this.loadFromDisk();
  }

  setDefaultLlmConfig(id: string): void {
    this.defaultLlmConfigId = id;
  }

  private loadFromDisk(): void {
    const fs = require('fs');
    const path = require('path');
    try {
      const dataPath = path.join(process.cwd(), '.qilin-claw', 'smart-memory.json');

      if (fs.existsSync(dataPath)) {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        this.keyInfoStore = data.keyInfo || [];
        this.experiences = new Map(Object.entries(data.experiences || {}));
        this.initialized = true;
        logger.info('[SmartMemory]', `Loaded ${this.keyInfoStore.length} key info and ${this.experiences.size} experiences`);
      }
    } catch (error) {
      logger.error('[SmartMemory]', 'Failed to load from disk:', error);
    }
  }

  private saveToDisk(): void {
    const fs = require('fs');
    const path = require('path');
    try {
      const dataPath = path.join(process.cwd(), '.qilin-claw', 'smart-memory.json');
      const dir = path.dirname(dataPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(dataPath, JSON.stringify({
        keyInfo: this.keyInfoStore,
        experiences: Object.fromEntries(this.experiences),
      }, null, 2));
    } catch (error) {
      logger.error('[SmartMemory]', 'Failed to save to disk:', error);
    }
  }

  async extractKeyInfo(message: string, role: 'user' | 'assistant'): Promise<KeyInfo[]> {
    const keyInfo: KeyInfo[] = [];
    const now = Date.now();

    const datePatterns = [
      { regex: /(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})[日号]?/g, type: 'date' as const },
      { regex: /(明天|后天|大后天|下周|下个月|明年)/g, type: 'date' as const },
      { regex: /(\d{1,2})[月\-\/](\d{1,2})[日号]?/g, type: 'date' as const },
      { regex: /(周[一二三四五六日]|星期[一二三四五六日])/g, type: 'date' as const },
    ];

    const taskPatterns = [
      { regex: /(需要|要|帮我|请帮我|帮忙)[做写完成整发送](.+?)(?:[，。！]|$)/g, type: 'task' as const },
      { regex: /(任务|工作|事项)[：:]?\s*(.+?)(?:[，。！]|$)/g, type: 'task' as const },
      { regex: /(赶在|在)(.+?)(之前|前)完成(.+?)(?:[，。！]|$)/g, type: 'task' as const },
    ];

    const reminderPatterns = [
      { regex: /(提醒|记得|不要忘记|别忘了)[我]?(.+?)(?:[，。！]|$)/g, type: 'reminder' as const },
      { regex: /(定时|设置|安排)(.+?)(?:[，。！]|$)/g, type: 'reminder' as const },
    ];

    const eventPatterns = [
      { regex: /(会议|约会|见面|面试|考试|活动)[：:]?\s*(.+?)(?:[，。！]|$)/g, type: 'event' as const },
      { regex: /(明天|后天|下周)(.+?)(?:开会|见面|面试|考试)/g, type: 'event' as const },
    ];

    const preferencePatterns = [
      { regex: /(我喜欢|我偏好|我习惯|我通常)(.+?)(?:[，。！]|$)/g, type: 'preference' as const },
      { regex: /(不要|别|不喜欢)(.+?)(?:[，。！]|$)/g, type: 'preference' as const },
    ];

    const allPatterns = [
      ...datePatterns,
      ...taskPatterns,
      ...reminderPatterns,
      ...eventPatterns,
      ...preferencePatterns,
    ];

    for (const { regex, type } of allPatterns) {
      let match;
      while ((match = regex.exec(message)) !== null) {
        const content = match[0];
        if (content.length > 2 && content.length < 200) {
          keyInfo.push({
            type,
            content,
            timestamp: now,
            metadata: {
              originalMessage: message.substring(0, 200),
              role,
            },
          });
        }
      }
    }

    return this.deduplicateKeyInfo(keyInfo);
  }

  private deduplicateKeyInfo(keyInfo: KeyInfo[]): KeyInfo[] {
    const seen = new Set<string>();
    return keyInfo.filter(info => {
      const key = `${info.type}:${info.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async processMessage(message: string, role: 'user' | 'assistant', conversationId?: string): Promise<void> {
    const keyInfo = await this.extractKeyInfo(message, role);

    for (const info of keyInfo) {
      this.keyInfoStore.push(info);
      logger.debug('[SmartMemory]', `Extracted key info: [${info.type}] ${info.content}`);
    }

    if (this.keyInfoStore.length > this.config.compressionThreshold) {
      await this.compressMemories();
    }

    this.saveToDisk();
  }

  async compressMemories(): Promise<void> {
    logger.info('[SmartMemory]', 'Starting memory compression...');

    const now = Date.now();
    const validKeyInfo = this.keyInfoStore.filter(info => {
      if (info.expiresAt && info.expiresAt < now) {
        return false;
      }
      if (now - info.timestamp > this.config.maxMemoryAge) {
        return false;
      }
      return true;
    });

    const groupedByType: Record<string, KeyInfo[]> = {};
    for (const info of validKeyInfo) {
      if (!groupedByType[info.type]) {
        groupedByType[info.type] = [];
      }
      groupedByType[info.type].push(info);
    }

    const compressedInfo: KeyInfo[] = [];
    for (const [type, infos] of Object.entries(groupedByType)) {
      if (infos.length > 10) {
        const recent = infos.slice(-10);
        const summary = await this.createTypeSummary(type, infos.slice(0, -10));
        if (summary) {
          compressedInfo.push({
            type: type as KeyInfo['type'],
            content: summary,
            timestamp: now,
          });
        }
        compressedInfo.push(...recent);
      } else {
        compressedInfo.push(...infos);
      }
    }

    this.keyInfoStore = compressedInfo;
    logger.info('[SmartMemory]', `Compressed ${this.keyInfoStore.length - compressedInfo.length} memories`);

    this.saveToDisk();
  }

  private async createTypeSummary(type: string, infos: KeyInfo[]): Promise<string | null> {
    if (infos.length === 0) return null;

    const contents = infos.map(i => i.content).join('；');
    return `历史${type}记录：${contents.substring(0, 200)}...`;
  }

  getRelevantKeyInfo(query: string, limit: number = 10): KeyInfo[] {
    const now = Date.now();
    const queryLower = query.toLowerCase();

    const relevant = this.keyInfoStore
      .filter(info => {
        if (info.expiresAt && info.expiresAt < now) return false;
        return true;
      })
      .sort((a, b) => {
        const aRelevant = this.calculateRelevance(a, queryLower);
        const bRelevant = this.calculateRelevance(b, queryLower);
        return bRelevant - aRelevant;
      })
      .slice(0, limit);

    return relevant;
  }

  private calculateRelevance(info: KeyInfo, query: string): number {
    let score = 0;

    const infoContent = info.content.toLowerCase();

    const queryWords = query.split(/\s+/);
    for (const word of queryWords) {
      if (infoContent.includes(word)) {
        score += 1;
      }
    }

    const now = Date.now();
    const age = now - info.timestamp;
    const ageInHours = age / (1000 * 60 * 60);
    if (ageInHours < 24) {
      score += 2;
    } else if (ageInHours < 168) {
      score += 1;
    }

    if (info.type === 'task' || info.type === 'reminder') {
      score += 1;
    }

    return score;
  }

  resolveRelativeDate(text: string): { resolved: string; date: Date } | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const relativeDates: Record<string, () => Date> = {
      '今天': () => today,
      '明天': () => new Date(today.getTime() + 24 * 60 * 60 * 1000),
      '后天': () => new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
      '大后天': () => new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000),
      '下周': () => new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000),
      '下个月': () => new Date(today.getFullYear(), today.getMonth() + 1, 1),
      '明年': () => new Date(today.getFullYear() + 1, 0, 1),
    };

    for (const [keyword, getDate] of Object.entries(relativeDates)) {
      if (text.includes(keyword)) {
        const date = getDate();
        const resolved = text.replace(keyword, `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`);
        return { resolved, date };
      }
    }

    return null;
  }

  async createExperienceMemory(
    conversationId: string,
    summary: string,
    keyInfo: KeyInfo[]
  ): Promise<ExperienceMemory> {
    const embedding = await embeddingService.generateEmbedding(summary);

    const experience: ExperienceMemory = {
      id: `exp-${Date.now()}`,
      summary,
      keyInfo,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      importance: keyInfo.length > 0 ? 1 : 0.5,
    };

    this.experiences.set(experience.id, experience);

    await vectorStore.addEntry(summary, embedding.embedding, {
      type: 'experience',
      role: 'system',
      timestamp: Date.now(),
      tokenCount: 0,
      conversationId,
      experienceId: experience.id,
    } as any);

    this.saveToDisk();
    return experience;
  }

  getRelevantExperiences(query: string, limit: number = 5): ExperienceMemory[] {
    const experiences = Array.from(this.experiences.values());

    return experiences
      .sort((a, b) => {
        const scoreA = a.importance * (a.accessCount + 1) / (Date.now() - a.lastAccessed + 1);
        const scoreB = b.importance * (b.accessCount + 1) / (Date.now() - b.lastAccessed + 1);
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      logger.debug('[SmartMemory]', 'Heartbeat: Processing memories...');
      await this.heartbeat();
    }, this.config.intervalMs);

    logger.info('[SmartMemory]', `Heartbeat started with interval ${this.config.intervalMs}ms`);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.info('[SmartMemory]', 'Heartbeat stopped');
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      await this.compressMemories();

      const now = Date.now();
      for (const info of this.keyInfoStore) {
        if (info.type === 'reminder' || info.type === 'task') {
          const resolved = this.resolveRelativeDate(info.content);
          if (resolved) {
            console.log(`即将到来的任务/提醒: ${info.content} -> ${resolved.resolved}`);
          }
        }
      }

      console.log('[SmartMemory] Heartbeat completed');
    } catch (error) {
      logger.error('[SmartMemory]', 'Heartbeat error:', error);
    }
  }

  formatKeyInfoForContext(keyInfo: KeyInfo[]): string {
    if (keyInfo.length === 0) return '';

    const grouped: Record<string, string[]> = {};
    for (const info of keyInfo) {
      if (!grouped[info.type]) {
        grouped[info.type] = [];
      }
      grouped[info.type].push(info.content);
    }

    const parts: string[] = [];

    const typeNames: Record<string, string> = {
      date: '重要日期',
      task: '待办任务',
      event: '事件安排',
      reminder: '提醒事项',
      preference: '用户偏好',
      fact: '关键事实',
    };

    for (const [type, items] of Object.entries(grouped)) {
      const typeName = typeNames[type] || type;
      parts.push(`【${typeName}】\n${items.map(i => `- ${i}`).join('\n')}`);
    }

    return `[用户记忆]\n${parts.join('\n\n')}`;
  }

  getStats(): {
    keyInfoCount: number;
    experienceCount: number;
    oldestMemory?: number;
    newestMemory?: number;
  } {
    const now = Date.now();
    const validKeyInfo = this.keyInfoStore.filter(info => {
      if (info.expiresAt && info.expiresAt < now) return false;
      return true;
    });

    return {
      keyInfoCount: validKeyInfo.length,
      experienceCount: this.experiences.size,
      oldestMemory: validKeyInfo[0]?.timestamp,
      newestMemory: validKeyInfo[validKeyInfo.length - 1]?.timestamp,
    };
  }

  clear(): void {
    this.keyInfoStore = [];
    this.experiences.clear();
    this.saveToDisk();
  }
}

export const smartMemory = new SmartMemory();
