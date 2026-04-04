/**
 * context-compactor.ts
 * 
 * QilinClaw 上下文自动压缩服务 (Auto-Compact)
 * 
 * 当对话历史的 Token 消耗接近模型的上下文窗口上限时，
 * 本服务自动将早期对话摘要压缩为高密度的 Markdown 摘要，
 * 从而为新的消息腾出空间，避免长对话崩溃。
 * 
 * 设计原则（参考 BCGJ 的 autoCompact/compact 思路，但完全自主实现）：
 * 1. 事前预估（不是事后补救）— 在每轮 Loop 之前检查
 * 2. 分级告警（Warning → Auto-Compact → Blocking）
 * 3. 保留最近 N 轮完整对话（模型需要近期上下文才能连贯推理）
 * 4. 摘要使用调用方指定的模型生成（可以用廉价小模型节省成本）
 * 5. 断路器模式 — 连续压缩失败时停止重试
 */

import { modelsManager } from '../models/manager.js';
import { estimateTokens } from './tool-result-truncator.js';
import type { ChatMessage } from '../types/index.js';

// ── 配置 ──

export interface CompactionConfig {
  /** 模型的总上下文窗口 Token 数。如果不确定，默认 128K */
  contextWindowTokens: number;
  /** 达到此比例开始告警（仅日志） */
  warningThresholdPct: number;    // 默认 0.70
  /** 达到此比例自动触发压缩 */
  autoCompactThresholdPct: number; // 默认 0.80
  /** 达到此比例阻止继续发送（防止 API 413） */
  blockingLimitPct: number;        // 默认 0.92
  /** 压缩时保留最近几轮完整对话不被摘要 */
  preserveRecentTurns: number;     // 默认 6 条消息（约 3 轮 Q&A）
  /** 用于生成摘要的模型 configId（可选，留空则用当前模型） */
  summaryModelConfigId?: string;
  /** 连续压缩失败允许的最大次数 */
  maxConsecutiveFailures: number;  // 默认 3
}

const DEFAULT_CONFIG: CompactionConfig = {
  contextWindowTokens: 128_000,
  warningThresholdPct: 0.70,
  autoCompactThresholdPct: 0.80,
  blockingLimitPct: 0.92,
  preserveRecentTurns: 6,
  maxConsecutiveFailures: 3,
};

// ── 状态追踪 ──

interface CompactionState {
  consecutiveFailures: number;
  lastCompactionTime: number;
  totalCompactions: number;
}

// 每个 conversationId 一个状态
const compactionStates = new Map<string, CompactionState>();

function getState(conversationId: string): CompactionState {
  if (!compactionStates.has(conversationId)) {
    compactionStates.set(conversationId, {
      consecutiveFailures: 0,
      lastCompactionTime: 0,
      totalCompactions: 0,
    });
  }
  return compactionStates.get(conversationId)!;
}

// ── 核心分析 ──

export type CompactionVerdict =
  | { action: 'ok' }                               // 安全，无需操作
  | { action: 'warning'; usagePct: number }         // 告警但不压缩
  | { action: 'compact'; usagePct: number }         // 需要压缩
  | { action: 'blocked'; usagePct: number }         // 超限阻止
  | { action: 'circuit_break' };                     // 断路器触发

/**
 * 评估当前消息列表是否需要压缩。
 * 
 * 纯分析函数，不会修改任何状态。
 */
export function assessCompactionNeed(
  messages: ChatMessage[],
  conversationId: string,
  config: Partial<CompactionConfig> = {},
): CompactionVerdict {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = getState(conversationId);

  // 断路器检查
  if (state.consecutiveFailures >= cfg.maxConsecutiveFailures) {
    console.warn(`[AutoCompact] Circuit breaker active for ${conversationId} (${state.consecutiveFailures} consecutive failures)`);
    return { action: 'circuit_break' };
  }

  // 估算当前 Token 用量
  const totalTokens = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(content);
  }, 0);

  const usagePct = totalTokens / cfg.contextWindowTokens;

  if (usagePct >= cfg.blockingLimitPct) {
    return { action: 'blocked', usagePct };
  }

  if (usagePct >= cfg.autoCompactThresholdPct) {
    return { action: 'compact', usagePct };
  }

  if (usagePct >= cfg.warningThresholdPct) {
    return { action: 'warning', usagePct };
  }

  return { action: 'ok' };
}

// ── 压缩执行 ──

/**
 * 对消息序列执行压缩：将早期消息摘要为一条 system 消息，
 * 保留最近的 N 条完整消息。
 * 
 * @param messages - 当前完整消息列表（含 system prompt）
 * @param conversationId - 会话 ID（用于状态追踪）
 * @param modelConfigId - 模型配置 ID（用于调用 LLM 生成摘要）
 * @param config - 压缩配置
 * @returns 压缩后的新消息列表（原列表不被修改）
 */
export async function compactMessages(
  messages: ChatMessage[],
  conversationId: string,
  modelConfigId: string,
  config: Partial<CompactionConfig> = {},
): Promise<ChatMessage[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = getState(conversationId);

  // 提取 system prompt（第一条消息，始终保留）
  const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
  const conversationMessages = systemMessage ? messages.slice(1) : [...messages];

  // 确定保留区：最后 N 条消息不压缩
  const preserveCount = Math.min(cfg.preserveRecentTurns, conversationMessages.length);
  const messagesToCompress = conversationMessages.slice(0, -preserveCount || conversationMessages.length);
  const messagesToPreserve = preserveCount > 0 ? conversationMessages.slice(-preserveCount) : [];

  if (messagesToCompress.length < 2) {
    // 没有足够的历史可压缩
    console.log(`[AutoCompact] Not enough messages to compress (${messagesToCompress.length})`);
    return messages;
  }

  // 构建压缩请求
  const summaryPrompt = buildSummaryPrompt(messagesToCompress);

  try {
    const useSummaryModel = cfg.summaryModelConfigId || modelConfigId;

    const summaryResponse = await modelsManager.chat({
      messages: [
        {
          role: 'system',
          content: '你是一个上下文压缩助手。你的任务是将一段长对话历史精炼为简洁的 Markdown 摘要，保留所有关键事实、决策、文件路径、错误信息和待办事项。摘要将替换原始对话，帮助 AI 在后续对话中保持连贯性。输出必须是纯文本摘要，不需要任何解释或前缀。',
        },
        {
          role: 'user',
          content: summaryPrompt,
        },
      ],
    }, useSummaryModel);

    if (!summaryResponse.content || summaryResponse.content.trim().length === 0) {
      throw new Error('Summary model returned empty content');
    }

    // 构建压缩后的消息序列
    const compactedMessages: ChatMessage[] = [];

    // 1. 保留原始 system prompt
    if (systemMessage) {
      compactedMessages.push(systemMessage);
    }

    // 2. 插入摘要作为 system 消息
    compactedMessages.push({
      role: 'system',
      content: `[上下文摘要 — 以下是早期对话的精炼版本，原始 ${messagesToCompress.length} 条消息已被压缩]\n\n${summaryResponse.content.trim()}`,
    });

    // 3. 保留最近的完整消息
    compactedMessages.push(...messagesToPreserve);

    // 更新状态
    state.consecutiveFailures = 0;
    state.lastCompactionTime = Date.now();
    state.totalCompactions++;

    const beforeTokens = estimateTokens(messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(''));
    const afterTokens = estimateTokens(compactedMessages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(''));

    console.log(`[AutoCompact] ✅ Compacted conversation ${conversationId}: ${messagesToCompress.length} messages → 1 summary. Tokens: ${beforeTokens} → ${afterTokens} (saved ${Math.round((1 - afterTokens / beforeTokens) * 100)}%)`);

    return compactedMessages;
  } catch (error: any) {
    // 压缩失败，递增断路器计数
    state.consecutiveFailures++;
    console.error(`[AutoCompact] ❌ Compaction failed for ${conversationId} (failure ${state.consecutiveFailures}/${cfg.maxConsecutiveFailures}):`, error.message);

    // 返回原始消息，让对话继续（降级策略：不压缩总比崩溃好）
    return messages;
  }
}

// ── 摘要 Prompt 构建 ──

/**
 * 将待压缩的消息列表转换为摘要请求文本。
 */
function buildSummaryPrompt(messages: ChatMessage[]): string {
  const conversationText = messages.map(m => {
    const role = m.role === 'user' ? '用户' :
                 m.role === 'assistant' ? 'AI' :
                 m.role === 'tool' ? `工具(${m.name || 'unknown'})` : '系统';
    const content = typeof m.content === 'string'
      ? m.content
      : m.content.map((p: any) => p.text || `[${p.type}]`).join(' ');
    // 对工具结果做进一步截断，避免摘要 prompt 本身过大
    const truncatedContent = content.length > 500
      ? content.slice(0, 400) + '...[截断]...' + content.slice(-100)
      : content;
    return `【${role}】${truncatedContent}`;
  }).join('\n\n');

  return `请将以下对话历史压缩为一份简洁的 Markdown 摘要。

要求：
- 保留所有关键事实：提到的文件路径、函数名、配置值、错误信息
- 保留所有决策和结论
- 保留用户提出的任何待办事项或未解决的问题
- 删除重复的工具调用细节和冗余的中间过程
- 摘要长度控制在原文的 20%-30%
- 使用 Markdown 格式（标题、列表、代码块）

对话历史如下：

${conversationText}`;
}

// ── 清理 ──

/**
 * 清除过期的压缩状态跟踪记录（防止内存泄漏）。
 * 建议在会话结束时调用。
 */
export function cleanupCompactionState(conversationId: string): void {
  compactionStates.delete(conversationId);
}
