/**
 * taxonomy-memory.ts
 *
 * QilinClaw 4-层分类记忆模型 (Phase 2)
 *
 * 取代 agent-memory.ts 中基于正则的扁平记忆提取，
 * 引入结构化的 4 层分类体系，让 Agent 拥有真正有组织的长期记忆。
 *
 * 4 层分类体系：
 * ┌──────────────┬──────────────────────────────────────┐
 * │ User         │ 用户身份、偏好、习惯                  │
 * │ Feedback     │ 用户反馈、纠正、赞扬                  │
 * │ Project      │ 项目事实、文件结构、技术栈            │
 * │ Reference    │ 参考知识、URL、代码模式                │
 * └──────────────┴──────────────────────────────────────┘
 *
 * 设计原则：
 * 1. 每层有独立的存储文件（结构化 JSON，非扁平文本）
 * 2. 提取使用 LLM（可选降级到正则）
 * 3. 查询时按相关性排序，注入 system prompt 的尾部
 * 4. 支持后台静默提取（不阻塞对话流）
 * 5. 自动去重和合并冲突记忆
 */

import { modelsManager } from '../models/manager.js';
import { agentMemoryManager } from './agent-memory.js';

// ── 类型定义 ──

/** 记忆条目的 4 种分类 */
export type MemoryTier = 'user' | 'feedback' | 'project' | 'reference';

/** 单条记忆条目 */
export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  /** 简短标签（如 "用户姓名"、"技术栈偏好"） */
  label: string;
  /** 记忆内容 */
  content: string;
  /** 信息来源描述 */
  source: string;
  /** 重要性 1-10 */
  importance: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后确认/更新时间 */
  updatedAt: number;
  /** 被引用次数（用于衰减排序） */
  hitCount: number;
}

/** 完整的分层记忆库 */
export interface TaxonomyMemoryStore {
  version: number;
  agentId: string;
  entries: MemoryEntry[];
  lastExtraction: number;
}

// ── 分类器 ──

/** 每层的关键词模式和描述 */
const TIER_DEFINITIONS: Record<MemoryTier, { description: string; keywords: RegExp[] }> = {
  user: {
    description: '用户个人信息：姓名、职业、公司、偏好、习惯、联系方式、使用风格',
    keywords: [
      /我叫|我是|我的名字|name is|my name/i,
      /我喜欢|我爱好|i like|i love|偏好|preference/i,
      /我的工作|职业|job|profession|我是做/i,
      /我的公司|company|工作单位/i,
      /我的(?:邮箱|电话|微信|QQ)/i,
      /我.*(?:习惯|风格|方式)/i,
    ],
  },
  feedback: {
    description: '用户反馈：纠正、赞扬、不满、建议、行为偏好（如"不要这样做"、"以后请用..."）',
    keywords: [
      /不要|别|禁止|不许|不准|停止/i,
      /以后|下次|每次|总是|请.*(?:用|使用)/i,
      /做得好|很好|不错|赞|棒|完美|perfect|good/i,
      /太慢|太长|太复杂|不满意|不对|错了|wrong/i,
      /建议|希望|能不能|可不可以|would you|could you/i,
      /记住|记得|remember|不要忘|别忘/i,
    ],
  },
  project: {
    description: '项目事实：文件路径、技术栈、架构决策、配置值、TODO、Bug、部署信息',
    keywords: [
      /文件|路径|目录|package|config|\.ts|\.js|\.vue|\.py/i,
      /技术栈|框架|库|依赖|版本|version/i,
      /架构|设计|模式|pattern|structure/i,
      /部署|deploy|docker|nginx|server/i,
      /TODO|FIXME|BUG|错误|报错|error/i,
      /数据库|API|接口|端口|配置/i,
    ],
  },
  reference: {
    description: '参考知识：URL、外部文档、代码示例、学习笔记、最佳实践',
    keywords: [
      /https?:\/\/[^\s]+/i,
      /参考|参见|详见|see also|reference|refer to/i,
      /文档|documentation|official|官方/i,
      /示例|example|sample|snippet|代码片段/i,
      /最佳实践|best practice|规范|convention/i,
    ],
  },
};

// ── 核心服务 ──

class TaxonomyMemoryService {
  /**
   * 从对话中提取记忆条目（后台异步，不阻塞对话流）。
   *
   * 优先使用 LLM 结构化提取，降级到正则模式匹配。
   */
  async extractFromConversation(
    agentId: string,
    userMessage: string,
    assistantMessage: string,
    modelConfigId?: string,
  ): Promise<MemoryEntry[]> {
    const extracted: MemoryEntry[] = [];

    try {
      // 优先尝试 LLM 结构化提取
      if (modelConfigId) {
        const llmEntries = await this.llmExtract(agentId, userMessage, assistantMessage, modelConfigId);
        if (llmEntries.length > 0) {
          extracted.push(...llmEntries);
        }
      }
    } catch (err) {
      console.warn('[TaxonomyMemory] LLM extraction failed, falling back to regex:', (err as Error).message);
    }

    // 如果 LLM 没有提取到，降级到正则
    if (extracted.length === 0) {
      const regexEntries = this.regexExtract(agentId, userMessage, assistantMessage);
      extracted.push(...regexEntries);
    }

    // 持久化提取的记忆
    if (extracted.length > 0) {
      await this.persistEntries(agentId, extracted);
    }

    return extracted;
  }

  /**
   * 查询与当前对话相关的记忆条目。
   * 用于在构建 system prompt 时注入长期记忆。
   */
  async queryRelevantMemories(
    agentId: string,
    context: string,
    maxEntries: number = 10,
  ): Promise<MemoryEntry[]> {
    const store = await this.loadStore(agentId);
    if (!store || store.entries.length === 0) return [];

    // 按重要性 × 活跃度排序
    const scored = store.entries.map(entry => {
      // 基础分 = importance
      let score = entry.importance;

      // 活跃度加分：最近28天内更新过的记忆得分更高
      const daysSinceUpdate = (Date.now() - entry.updatedAt) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 1) score += 3;
      else if (daysSinceUpdate < 7) score += 2;
      else if (daysSinceUpdate < 28) score += 1;

      // 命中次数加分（但衰减，防止旧记忆永远置顶）
      score += Math.min(entry.hitCount * 0.5, 3);

      // 关键词匹配加分
      const contextLower = context.toLowerCase();
      const contentLower = entry.content.toLowerCase();
      const words = contentLower.split(/\s+/).filter(w => w.length > 2);
      const matchCount = words.filter(w => contextLower.includes(w)).length;
      score += Math.min(matchCount * 0.5, 3);

      return { entry, score };
    });

    // 按分数降序排列，取前 N
    scored.sort((a, b) => b.score - a.score);
    const topEntries = scored.slice(0, maxEntries).map(s => s.entry);

    // 更新命中次数
    for (const entry of topEntries) {
      entry.hitCount++;
    }

    // 异步保存命中计数（不阻塞）
    this.saveStore(agentId, store).catch(() => {});

    return topEntries;
  }

  /**
   * 将记忆条目格式化为可注入 system prompt 的文本段。
   */
  formatForSystemPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return '';

    const grouped: Record<MemoryTier, MemoryEntry[]> = {
      user: [], feedback: [], project: [], reference: [],
    };

    for (const m of memories) {
      grouped[m.tier].push(m);
    }

    const sections: string[] = ['<长期记忆>'];

    if (grouped.user.length > 0) {
      sections.push('## 用户信息');
      grouped.user.forEach(m => sections.push(`- [${m.label}] ${m.content}`));
    }

    if (grouped.feedback.length > 0) {
      sections.push('## 用户偏好与反馈');
      grouped.feedback.forEach(m => sections.push(`- ⚠️ ${m.content}`));
    }

    if (grouped.project.length > 0) {
      sections.push('## 项目上下文');
      grouped.project.forEach(m => sections.push(`- ${m.label}: ${m.content}`));
    }

    if (grouped.reference.length > 0) {
      sections.push('## 参考资料');
      grouped.reference.forEach(m => sections.push(`- ${m.content}`));
    }

    sections.push('</长期记忆>');

    return sections.join('\n');
  }

  // ── LLM 结构化提取 ──

  private async llmExtract(
    agentId: string,
    userMsg: string,
    assistantMsg: string,
    modelConfigId: string,
  ): Promise<MemoryEntry[]> {
    const prompt = `分析以下对话片段，提取值得长期记忆的信息。每条信息必须归入以下4个分类之一：

分类说明：
- user: ${TIER_DEFINITIONS.user.description}
- feedback: ${TIER_DEFINITIONS.feedback.description}
- project: ${TIER_DEFINITIONS.project.description}
- reference: ${TIER_DEFINITIONS.reference.description}

对话内容：
用户: ${userMsg.substring(0, 1000)}
助手: ${assistantMsg.substring(0, 1000)}

如果没有值得记忆的信息，返回空数组 []。
如果有，严格按以下 JSON 格式返回（不要有其他文字）：
[{"tier":"user|feedback|project|reference","label":"简短标签","content":"记忆内容","importance":1-10}]`;

    const response = await modelsManager.chat({
      messages: [
        { role: 'system', content: '你是一个记忆提取助手。只输出 JSON 数组，不要任何解释。' },
        { role: 'user', content: prompt },
      ],
    }, modelConfigId);

    const text = (response.content || '').trim();

    // 提取 JSON 数组
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const rawEntries = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(rawEntries)) return [];

      const now = Date.now();
      return rawEntries
        .filter((e: any) => e.tier && e.content && ['user', 'feedback', 'project', 'reference'].includes(e.tier))
        .map((e: any, i: number) => ({
          id: `${agentId}-${now}-${i}`,
          tier: e.tier as MemoryTier,
          label: String(e.label || e.tier).substring(0, 50),
          content: String(e.content).substring(0, 500),
          source: `conversation-${new Date(now).toISOString().split('T')[0]}`,
          importance: Math.min(Math.max(Number(e.importance) || 5, 1), 10),
          createdAt: now,
          updatedAt: now,
          hitCount: 0,
        }));
    } catch {
      return [];
    }
  }

  // ── 正则降级提取 ──

  private regexExtract(
    agentId: string,
    userMsg: string,
    assistantMsg: string,
  ): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const combined = `${userMsg} ${assistantMsg}`;
    const now = Date.now();

    for (const [tier, def] of Object.entries(TIER_DEFINITIONS) as [MemoryTier, typeof TIER_DEFINITIONS[MemoryTier]][]) {
      for (const regex of def.keywords) {
        if (regex.test(combined)) {
          // 找到匹配句子
          const sentences = combined.split(/[。！？.!?\n]/);
          for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length > 5 && regex.test(trimmed)) {
              // 去重：如果已有相同内容的条目则跳过
              if (!entries.some(e => e.content === trimmed.substring(0, 300))) {
                entries.push({
                  id: `${agentId}-${now}-${entries.length}`,
                  tier,
                  label: this.generateLabel(tier, trimmed),
                  content: trimmed.substring(0, 300),
                  source: 'regex-fallback',
                  importance: tier === 'user' ? 8 : tier === 'feedback' ? 9 : 5,
                  createdAt: now,
                  updatedAt: now,
                  hitCount: 0,
                });
              }
              break; // 每个 tier 每次对话最多提取 1 条（避免噪声）
            }
          }
          break; // 每个 tier 匹配到第一个模式就够了
        }
      }
    }

    return entries;
  }

  private generateLabel(tier: MemoryTier, content: string): string {
    const shortContent = content.substring(0, 30);
    switch (tier) {
      case 'user': return '用户信息';
      case 'feedback': return '用户反馈';
      case 'project': return '项目事实';
      case 'reference': return '参考资料';
      default: return shortContent;
    }
  }

  // ── 持久化 ──

  private async loadStore(agentId: string): Promise<TaxonomyMemoryStore | null> {
    try {
      const files = await agentMemoryManager.getAgentMemoryFilesAsync(agentId);
      const taxonomyFile = files.find(f => f.filename === 'taxonomy-memory.json');
      if (!taxonomyFile) return null;

      const content = taxonomyFile.content;
      return JSON.parse(content) as TaxonomyMemoryStore;
    } catch {
      return null;
    }
  }

  private async saveStore(agentId: string, store: TaxonomyMemoryStore): Promise<void> {
    const content = JSON.stringify(store, null, 2);
    const files = await agentMemoryManager.getAgentMemoryFilesAsync(agentId);
    const taxonomyFile = files.find(f => f.filename === 'taxonomy-memory.json');

    if (taxonomyFile) {
      await agentMemoryManager.updateMemoryFileAsync(taxonomyFile.id, content);
    } else {
      await agentMemoryManager.createMemoryFileAsync(agentId, 'taxonomy-memory.json', content, 'knowledge');
    }
  }

  private async persistEntries(agentId: string, newEntries: MemoryEntry[]): Promise<void> {
    let store = await this.loadStore(agentId);
    if (!store) {
      store = {
        version: 1,
        agentId,
        entries: [],
        lastExtraction: Date.now(),
      };
    }

    // 去重合并：如果已存在相似内容，更新而非新增
    for (const newEntry of newEntries) {
      const existingIdx = store.entries.findIndex(e =>
        e.tier === newEntry.tier &&
        this.isSimilar(e.content, newEntry.content)
      );

      if (existingIdx >= 0) {
        // 更新现有条目（保留创建时间，更新内容和时间戳）
        const existing = store.entries[existingIdx];
        existing.content = newEntry.content;
        existing.updatedAt = Date.now();
        existing.hitCount++;
        if (newEntry.importance > existing.importance) {
          existing.importance = newEntry.importance;
        }
        console.log(`[TaxonomyMemory] Updated existing ${existing.tier} entry: "${existing.label}"`);
      } else {
        store.entries.push(newEntry);
        console.log(`[TaxonomyMemory] Added new ${newEntry.tier} entry: "${newEntry.label}"`);
      }
    }

    // 限制总条目数（防止无限增长）
    const MAX_ENTRIES = 200;
    if (store.entries.length > MAX_ENTRIES) {
      // 按重要性和新鲜度排序，淘汰末尾
      store.entries.sort((a, b) => {
        const scoreA = a.importance + Math.min(a.hitCount, 5);
        const scoreB = b.importance + Math.min(b.hitCount, 5);
        return scoreB - scoreA;
      });
      store.entries = store.entries.slice(0, MAX_ENTRIES);
      console.log(`[TaxonomyMemory] Pruned to ${MAX_ENTRIES} entries`);
    }

    store.lastExtraction = Date.now();
    await this.saveStore(agentId, store);
  }

  /**
   * 简单的内容相似度检查（基于关键词重叠率）。
   * 不使用 embedding 以保持轻量。
   */
  private isSimilar(a: string, b: string): boolean {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return false;

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }

    const overlapRatio = overlap / Math.min(wordsA.size, wordsB.size);
    return overlapRatio > 0.6; // 60% 以上关键词重叠视为相似
  }

  // ── 管理 API ──

  /** 获取 Agent 的完整记忆统计 */
  async getStats(agentId: string): Promise<{
    totalEntries: number;
    byTier: Record<MemoryTier, number>;
    lastExtraction: number | null;
  }> {
    const store = await this.loadStore(agentId);
    const byTier: Record<MemoryTier, number> = { user: 0, feedback: 0, project: 0, reference: 0 };

    if (store) {
      for (const e of store.entries) {
        byTier[e.tier]++;
      }
    }

    return {
      totalEntries: store?.entries.length || 0,
      byTier,
      lastExtraction: store?.lastExtraction || null,
    };
  }

  /** 手动添加记忆条目 */
  async addManually(agentId: string, tier: MemoryTier, label: string, content: string, importance: number = 7): Promise<MemoryEntry> {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: `${agentId}-manual-${now}`,
      tier,
      label,
      content,
      source: 'manual',
      importance: Math.min(Math.max(importance, 1), 10),
      createdAt: now,
      updatedAt: now,
      hitCount: 0,
    };

    await this.persistEntries(agentId, [entry]);
    return entry;
  }

  /** 删除指定记忆条目 */
  async deleteEntry(agentId: string, entryId: string): Promise<boolean> {
    const store = await this.loadStore(agentId);
    if (!store) return false;

    const idx = store.entries.findIndex(e => e.id === entryId);
    if (idx < 0) return false;

    store.entries.splice(idx, 1);
    await this.saveStore(agentId, store);
    return true;
  }
}

export const taxonomyMemory = new TaxonomyMemoryService();
