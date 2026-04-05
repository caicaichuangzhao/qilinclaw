/**
 * qc-harness.ts
 *
 * QilinClaw Runtime Engine (QC-Harness) — Phase 3
 *
 * "Agent 的宿主操作系统"
 * 在工具执行前后注入生命周期钩子，实现：
 * - PreToolUse: 权限审查、参数消毒、智能熔断
 * - PostToolUse: 自动格式化、结果审计、副作用触发
 * - SessionStart/Stop: 环境初始化与清理
 * - 会话级 append-only 日志（Session Journal）
 *
 * 设计原则：
 * 1. 中间件管道模式 — 每个 Hook 可中断或修改执行流
 * 2. 声明式规则引擎 — JSON 配置，非硬编码
 * 3. 零侵入 — 对 agentic-loop-core 只需改一行调用
 * 4. QilinClaw 独有的 GUI Macro Hook 预留
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── 类型定义 ──

/** 生命周期事件类型 */
export type HookEvent =
  | 'SessionStart'
  | 'SessionStop'
  | 'PreToolUse'
  | 'PostToolUse';

/** Hook 类型 */
export type HookType =
  | 'command'       // 执行系统命令
  | 'block'         // 拒绝执行
  | 'transform'     // 修改参数
  | 'audit';        // 记录审计日志

/** 单条 Hook 规则定义 */
export interface HookRule {
  /** 唯一标识 */
  id: string;
  /** 触发时机 */
  event: HookEvent;
  /** Hook 类型 */
  type: HookType;
  /** 匹配的工具名称模式（正则） */
  toolPattern?: string;
  /** 匹配的参数模式（正则，用于匹配 JSON.stringify(args)） */
  argsPattern?: string;
  /** 要执行的命令（仅 command 类型） */
  command?: string;
  /** 拒绝理由（仅 block 类型） */
  blockReason?: string;
  /** 参数变换函数体字符串（仅 transform 类型，安全沙箱内执行） */
  transformExpr?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级 (数字越小越先执行) */
  priority?: number;
  /** 描述说明 */
  description?: string;
}

/** Harness 配置文件结构 */
export interface HarnessConfig {
  version: number;
  hooks: HookRule[];
  /** 安全策略 */
  security: {
    /** 禁止访问的路径模式列表 */
    blockedPaths: string[];
    /** 允许的最大命令执行时间(ms) */
    maxCommandTimeoutMs: number;
    /** 危险命令模式 */
    dangerousCommandPatterns: string[];
  };
  /** 智能熔断配置 */
  circuitBreaker: {
    /** 连续失败次数触发熔断 */
    failureThreshold: number;
    /** 熔断冷却轮数 */
    cooldownRounds: number;
  };
}

/** Hook 执行结果 */
export interface HookResult {
  /** 是否继续执行原工具 */
  continue: boolean;
  /** 如果被阻断，原因 */
  blockReason?: string;
  /** 修改后的参数（如果有 transform hook） */
  updatedArgs?: any;
  /** Hook 执行产生的附加日志 */
  logs: string[];
  /** PostToolUse 追加内容（如 lint 输出） */
  appendOutput?: string;
}

// ── 智能熔断器 ──

interface CircuitState {
  toolName: string;
  consecutiveFailures: number;
  cooldownRoundsRemaining: number;
  lastFailureTime: number;
}

// ── 会话日志 ──

interface JournalEntry {
  timestamp: number;
  event: string;
  toolName?: string;
  args?: any;
  result?: string;
  hookLogs?: string[];
  duration?: number;
}

// ── 默认配置 ──

const DEFAULT_CONFIG: HarnessConfig = {
  version: 1,
  hooks: [
    // 内置安全规则 1: 阻止危险的 rm -rf / del /s 类命令
    {
      id: 'builtin-block-rm-rf',
      event: 'PreToolUse',
      type: 'block',
      toolPattern: '^exec_cmd$',
      argsPattern: '(rm\\s+-rf\\s+[/~]|del\\s+/s\\s+/q\\s+[A-Z]:\\\\|format\\s+[A-Z]:)',
      blockReason: '🛡️ [QC-Harness] 危险操作被拦截：检测到高危系统命令，已自动阻止执行。',
      enabled: true,
      priority: 0,
      description: '阻止 rm -rf /, del /s /q, format 等毁灭性命令',
    },
    // 内置安全规则 2: 阻止访问系统敏感路径
    {
      id: 'builtin-block-sensitive-paths',
      event: 'PreToolUse',
      type: 'block',
      toolPattern: '^(write_file|edit_file|delete_file)$',
      argsPattern: '(\\\\Windows\\\\System32|/etc/passwd|/etc/shadow|\\.ssh/|id_rsa)',
      blockReason: '🛡️ [QC-Harness] 路径越权被拦截：禁止操作系统敏感路径或密钥文件。',
      enabled: true,
      priority: 0,
      description: '阻止对 System32、SSH 密钥等敏感路径的写入/删除',
    },
    // 内置规则 3: 写文件后自动审计日志
    {
      id: 'builtin-audit-file-writes',
      event: 'PostToolUse',
      type: 'audit',
      toolPattern: '^(write_file|edit_file|delete_file)$',
      enabled: true,
      priority: 10,
      description: '记录所有文件修改操作到会话日志',
    },
  ],
  security: {
    blockedPaths: [
      'C:\\Windows\\System32',
      '/etc/',
      '~/.ssh/',
    ],
    maxCommandTimeoutMs: 30000,
    dangerousCommandPatterns: [
      'rm\\s+-rf\\s+/',
      'del\\s+/s\\s+/q',
      'format\\s+[A-Z]:',
      'mkfs\\.',
      ':(){:|:&};:',
    ],
  },
  circuitBreaker: {
    failureThreshold: 3,
    cooldownRounds: 5,
  },
};

// ── 核心服务 ──

class QCHarness {
  private config: HarnessConfig = DEFAULT_CONFIG;
  private circuitStates: Map<string, CircuitState> = new Map();
  private journalPath: string | null = null;
  private sessionId: string | null = null;

  /**
   * 初始化 Harness，加载项目级配置。
   */
  initialize(workspacePath?: string): void {
    // 尝试加载项目级配置
    if (workspacePath) {
      const configPath = join(workspacePath, '.qilin', 'harness.json');
      if (existsSync(configPath)) {
        try {
          const userConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<HarnessConfig>;
          this.config = this.mergeConfig(DEFAULT_CONFIG, userConfig);
          console.log(`[QC-Harness] Loaded project config from ${configPath}`);
        } catch (err) {
          console.error('[QC-Harness] Failed to parse project config, using defaults:', err);
        }
      }
    }
  }

  /**
   * 开始一个新会话。
   * 触发 SessionStart hooks，初始化日志文件。
   */
  async startSession(sessionId: string, agentId?: string, workDir?: string): Promise<HookResult> {
    this.sessionId = sessionId;

    // 初始化 Session Journal
    const journalDir = join(workDir || process.cwd(), '.qilin', 'journals');
    try {
      mkdirSync(journalDir, { recursive: true });
      this.journalPath = join(journalDir, `${sessionId}.jsonl`);
    } catch {
      this.journalPath = null;
    }

    this.writeJournal({
      timestamp: Date.now(),
      event: 'SessionStart',
    });

    // 运行 SessionStart hooks
    return this.runHooks('SessionStart', undefined, undefined, undefined);
  }

  /**
   * 结束当前会话。
   * 触发 SessionStop hooks，flush 日志。
   */
  async stopSession(): Promise<HookResult> {
    const result = await this.runHooks('SessionStop', undefined, undefined, undefined);

    this.writeJournal({
      timestamp: Date.now(),
      event: 'SessionStop',
    });

    this.sessionId = null;
    this.journalPath = null;
    return result;
  }

  /**
   * 工具执行前置钩子。
   * 
   * 在 dispatchToolCall 之前调用。可以：
   * - 拦截危险操作
   * - 修改参数（消毒）
   * - 检查熔断状态
   */
  async preToolUse(toolName: string, args: any): Promise<HookResult> {
    const logs: string[] = [];

    // 1. 检查熔断状态
    const circuitState = this.circuitStates.get(toolName);
    if (circuitState && circuitState.cooldownRoundsRemaining > 0) {
      circuitState.cooldownRoundsRemaining--;
      const reason = `🔥 [QC-Harness 智能熔断] 工具 "${toolName}" 因连续 ${this.config.circuitBreaker.failureThreshold} 次失败已被暂时冻结，剩余冷却 ${circuitState.cooldownRoundsRemaining} 轮后恢复。`;
      logs.push(reason);
      this.writeJournal({ timestamp: Date.now(), event: 'CircuitBreaker', toolName, hookLogs: logs });
      return { continue: false, blockReason: reason, logs };
    }

    // 2. 执行所有匹配的 PreToolUse hook 规则
    const result = await this.runHooks('PreToolUse', toolName, args, undefined);

    // 记录日志
    this.writeJournal({
      timestamp: Date.now(),
      event: 'PreToolUse',
      toolName,
      args: this.sanitizeArgs(args),
      hookLogs: result.logs,
    });

    return result;
  }

  /**
   * 工具执行后置钩子。
   * 
   * 在 dispatchToolCall 之后调用。可以：
   * - 触发自动命令（如 eslint --fix）
   * - 记录审计日志
   * - 更新熔断计数器
   */
  async postToolUse(toolName: string, args: any, result: string, success: boolean): Promise<HookResult> {
    // 1. 更新熔断计数器
    this.updateCircuitBreaker(toolName, success);

    // 2. 执行所有匹配的 PostToolUse hook 规则
    const hookResult = await this.runHooks('PostToolUse', toolName, args, result);

    // 3. 记录到 Session Journal
    this.writeJournal({
      timestamp: Date.now(),
      event: 'PostToolUse',
      toolName,
      result: result.substring(0, 500), // 截断避免日志过大
      hookLogs: hookResult.logs,
    });

    return hookResult;
  }

  /**
   * 获取当前 Harness 配置（用于前端展示）。
   */
  getConfig(): HarnessConfig {
    return { ...this.config };
  }

  /**
   * 更新 Hook 规则（用于前端配置面板）。
   */
  updateHookRule(ruleId: string, updates: Partial<HookRule>): boolean {
    const idx = this.config.hooks.findIndex(h => h.id === ruleId);
    if (idx < 0) return false;
    Object.assign(this.config.hooks[idx], updates);
    return true;
  }

  /**
   * 添加新的 Hook 规则。
   */
  addHookRule(rule: HookRule): void {
    this.config.hooks.push(rule);
  }

  /**
   * 删除 Hook 规则。
   */
  removeHookRule(ruleId: string): boolean {
    const idx = this.config.hooks.findIndex(h => h.id === ruleId);
    if (idx < 0) return false;
    this.config.hooks.splice(idx, 1);
    return true;
  }

  /**
   * 获取熔断器状态（用于调试/前端展示）。
   */
  getCircuitBreakerStates(): CircuitState[] {
    return Array.from(this.circuitStates.values());
  }

  // ── 核心管道 ──

  private async runHooks(
    event: HookEvent,
    toolName?: string,
    args?: any,
    result?: string,
  ): Promise<HookResult> {
    const matchingHooks = this.config.hooks
      .filter(h => h.enabled && h.event === event)
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

    const logs: string[] = [];
    let updatedArgs = args;
    let appendOutput = '';

    for (const hook of matchingHooks) {
      // 检查工具名称匹配
      if (hook.toolPattern && toolName) {
        try {
          const regex = new RegExp(hook.toolPattern, 'i');
          if (!regex.test(toolName)) continue;
        } catch { continue; }
      }

      // 检查参数匹配
      if (hook.argsPattern) {
        try {
          const argsJson = JSON.stringify(updatedArgs || {});
          const regex = new RegExp(hook.argsPattern, 'i');
          if (!regex.test(argsJson)) continue;
        } catch { continue; }
      }

      // 执行 Hook
      switch (hook.type) {
        case 'block': {
          const reason = hook.blockReason || `[QC-Harness] 操作被规则 "${hook.id}" 拦截。`;
          logs.push(`[BLOCKED by ${hook.id}] ${reason}`);
          console.warn(`[QC-Harness] Tool "${toolName}" blocked by rule "${hook.id}": ${reason}`);
          return { continue: false, blockReason: reason, logs };
        }

        case 'command': {
          if (hook.command) {
            try {
              // 安全替换命令中的占位符
              let cmd = hook.command;
              if (updatedArgs?.path) cmd = cmd.replace('{{path}}', updatedArgs.path);
              if (toolName) cmd = cmd.replace('{{tool}}', toolName);

              const timeoutMs = this.config.security.maxCommandTimeoutMs;
              const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
              const output = (stdout || '') + (stderr || '');
              logs.push(`[CMD ${hook.id}] ${cmd} → ${output.substring(0, 200)}`);
              if (output.trim()) appendOutput += `\n[Hook: ${hook.description || hook.id}]\n${output.trim()}\n`;
            } catch (err: any) {
              logs.push(`[CMD ${hook.id} FAILED] ${err.message}`);
            }
          }
          break;
        }

        case 'transform': {
          if (hook.transformExpr && updatedArgs) {
            try {
              // 简单安全的参数变换（不使用 eval，只支持预定义变换）
              if (hook.transformExpr === 'sanitize_path') {
                // 移除路径遍历攻击模式
                if (updatedArgs.path) {
                  updatedArgs.path = updatedArgs.path.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
                }
              }
              logs.push(`[TRANSFORM ${hook.id}] Applied: ${hook.transformExpr}`);
            } catch (err: any) {
              logs.push(`[TRANSFORM ${hook.id} FAILED] ${err.message}`);
            }
          }
          break;
        }

        case 'audit': {
          const auditEntry = `[AUDIT ${hook.id}] Tool: ${toolName}, Args: ${JSON.stringify(this.sanitizeArgs(updatedArgs)).substring(0, 200)}`;
          logs.push(auditEntry);
          break;
        }
      }
    }

    return { continue: true, updatedArgs, logs, appendOutput: appendOutput || undefined };
  }

  // ── 熔断器 ──

  private updateCircuitBreaker(toolName: string, success: boolean): void {
    let state = this.circuitStates.get(toolName);

    if (success) {
      // 成功执行 → 重置计数器
      if (state) {
        state.consecutiveFailures = 0;
        state.cooldownRoundsRemaining = 0;
      }
      return;
    }

    // 失败 → 累加
    if (!state) {
      state = { toolName, consecutiveFailures: 0, cooldownRoundsRemaining: 0, lastFailureTime: 0 };
      this.circuitStates.set(toolName, state);
    }

    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();

    if (state.consecutiveFailures >= this.config.circuitBreaker.failureThreshold) {
      state.cooldownRoundsRemaining = this.config.circuitBreaker.cooldownRounds;
      console.warn(
        `[QC-Harness] 🔥 Circuit breaker TRIPPED for "${toolName}" after ${state.consecutiveFailures} failures. ` +
        `Cooling down for ${state.cooldownRoundsRemaining} rounds.`
      );
    }
  }

  // ── Session Journal ──

  private writeJournal(entry: JournalEntry): void {
    if (!this.journalPath) return;
    try {
      appendFileSync(this.journalPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // 日志写入失败不应影响主流程
    }
  }

  // ── 工具 ──

  private mergeConfig(base: HarnessConfig, override: Partial<HarnessConfig>): HarnessConfig {
    return {
      version: override.version ?? base.version,
      hooks: [
        ...base.hooks, // 内置规则始终保留
        ...(override.hooks || []).filter(h => !base.hooks.some(bh => bh.id === h.id)),
      ],
      security: { ...base.security, ...(override.security || {}) },
      circuitBreaker: { ...base.circuitBreaker, ...(override.circuitBreaker || {}) },
    };
  }

  private sanitizeArgs(args: any): any {
    if (!args) return {};
    const sanitized = { ...args };
    // 移除超大内容字段（避免日志膨胀）
    if (sanitized.content && typeof sanitized.content === 'string' && sanitized.content.length > 200) {
      sanitized.content = sanitized.content.substring(0, 200) + '...[truncated]';
    }
    return sanitized;
  }
}

export const qcHarness = new QCHarness();
