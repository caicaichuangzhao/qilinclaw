/**
 * fault-tolerance.ts
 *
 * QilinClaw 容错与自动重试引擎 — Phase 4
 *
 * 解决两个核心问题：
 * 1. finish_reason == 'length' 时模型输出被截断 → 自动续写
 * 2. 429/5xx 等临时性错误 → 指数退避重试
 *
 * 设计原则：
 * 1. 对调用方透明 — 包裹 modelsManager.chat/chatStream，返回完整结果
 * 2. 可配置上限 — 防止无限重试浪费 Token
 * 3. 日志可追踪 — 每次重试/续写都有清晰日志
 */

import type { ChatMessage } from '../types/index.js';

// ── 配置 ──

export interface FaultToleranceConfig {
  /** 最大自动续写次数（防止 length 无限循环） */
  maxContinuations: number;
  /** 最大重试次数（针对 429/5xx） */
  maxRetries: number;
  /** 初始退避延迟(ms) */
  initialBackoffMs: number;
  /** 退避最大延迟(ms) */
  maxBackoffMs: number;
  /** 退避乘数（指数增长） */
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: FaultToleranceConfig = {
  maxContinuations: 3,
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
};

// ── 类型 ──

/** 包含 finishReason 的 LLM 响应 */
export interface LLMResponseWithReason {
  content: string;
  finishReason?: string;
  tool_calls?: any[];
  [key: string]: any;
}

/** chatFn 的标准签名 — 由调用方传入 modelsManager.chat */
export type ChatFunction = (messages: ChatMessage[], configId: string) => Promise<LLMResponseWithReason>;

// ── 核心功能 ──

/**
 * 自动续写：当 finish_reason == 'length' 时，注入续写指令让模型继续输出。
 *
 * @param chatFn   实际的 LLM 调用函数（modelsManager.chat 的包装）
 * @param messages 当前消息列表
 * @param configId 模型配置 ID
 * @param config   容错配置
 * @returns 合并后的完整响应
 */
export async function chatWithContinuation(
  chatFn: ChatFunction,
  messages: ChatMessage[],
  configId: string,
  config: FaultToleranceConfig = DEFAULT_CONFIG,
): Promise<LLMResponseWithReason> {
  let fullContent = '';
  let continuation = 0;
  let currentMessages = [...messages];
  let lastResponse: LLMResponseWithReason;

  while (true) {
    lastResponse = await chatFn(currentMessages, configId);

    fullContent += lastResponse.content || '';

    // 如果有工具调用，不做续写（交给 agentic loop 处理）
    if (lastResponse.tool_calls && lastResponse.tool_calls.length > 0) {
      lastResponse.content = fullContent;
      return lastResponse;
    }

    // 检查是否因长度截断
    if (lastResponse.finishReason === 'length' && continuation < config.maxContinuations) {
      continuation++;
      console.log(`[FaultTolerance] 模型输出被截断 (finish_reason=length), 自动续写第 ${continuation}/${config.maxContinuations} 次`);

      // 注入续写指令
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: fullContent },
        {
          role: 'user',
          content: '[系统自动续写] 你的回复在中途被截断了。请从上次被打断的精确位置继续你的回复，不要重复已输出的内容，也不要添加额外的开场白。直接接着写。',
        },
      ];
    } else {
      // 正常结束 or 达到续写上限
      if (continuation > 0 && lastResponse.finishReason === 'length') {
        console.warn(`[FaultTolerance] 达到最大续写次数 ${config.maxContinuations}，强制返回已有内容`);
      }
      lastResponse.content = fullContent;
      return lastResponse;
    }
  }
}

/**
 * 指数退避重试：对 429/5xx 等临时性错误自动重试。
 *
 * @param fn       要重试的异步函数
 * @param config   容错配置
 * @returns 函数执行结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: FaultToleranceConfig = DEFAULT_CONFIG,
): Promise<T> {
  let lastError: Error | null = null;
  let delay = config.initialBackoffMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || '';

      // 判断是否为可重试错误
      const isRetryable =
        errMsg.includes('429') ||
        errMsg.includes('速率限制') ||
        errMsg.includes('rate limit') ||
        errMsg.includes('500') ||
        errMsg.includes('502') ||
        errMsg.includes('503') ||
        errMsg.includes('服务器内部错误') ||
        errMsg.includes('网关错误') ||
        errMsg.includes('服务不可用') ||
        errMsg.includes('ECONNRESET') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('fetch failed');

      if (!isRetryable || attempt >= config.maxRetries) {
        throw err; // 不可重试 or 已达上限
      }

      // 指数退避 + 添加随机抖动（防止雪崩）
      const jitter = Math.random() * delay * 0.3;
      const actualDelay = Math.min(delay + jitter, config.maxBackoffMs);

      console.warn(
        `[FaultTolerance] 第 ${attempt + 1}/${config.maxRetries} 次重试, ` +
        `等待 ${Math.round(actualDelay)}ms, 原因: ${errMsg.substring(0, 100)}`
      );

      await sleep(actualDelay);
      delay *= config.backoffMultiplier;
    }
  }

  throw lastError!;
}

/**
 * 组合版本：同时提供重试 + 续写能力。
 * 在 agentic loop 中替代直接的 modelsManager.chat() 调用。
 */
export async function resilientChat(
  chatFn: ChatFunction,
  messages: ChatMessage[],
  configId: string,
  config: FaultToleranceConfig = DEFAULT_CONFIG,
): Promise<LLMResponseWithReason> {
  return withRetry(
    () => chatWithContinuation(chatFn, messages, configId, config),
    config,
  );
}

// ── 工具 ──

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { DEFAULT_CONFIG as defaultFaultToleranceConfig };
