/**
 * agentic-loop-core.ts
 * 
 * QilinClaw Agentic Loop 核心逻辑模块
 * 
 * 从原 chat-orchestrator.ts 中提取出的共享执行逻辑。
 * 将 stream 和 non-stream 两条路径中完全重复的代码
 * 沉淀为可被两者共同调用的纯函数/工具集。
 * 
 * 设计原则：
 * 1. 所有函数都是无副作用的纯业务逻辑（除了必须的 I/O）
 * 2. 不直接依赖 express 的 req/res —— 通过回调接口解耦
 * 3. 可独立测试
 */

import { skillEngine, globalApprovalManager } from './skill-engine.js';
import { mcpService } from './mcp-service.js';
import { agentService } from './agent-service.js';
import { executeAgentTool } from './tools.js';
import { contextMemory } from './context-memory.js';
import { agentMemoryManager } from './agent-memory.js';
import { usageTracker } from './usage-tracker.js';
import { truncateToolResult } from './tool-result-truncator.js';
import { taxonomyMemory } from './taxonomy-memory.js';
import { qcHarness } from './qc-harness.js';
import type { ChatMessage, ToolCall } from '../types/index.js';

// ── 常量 ──

const GUI_SCREENSHOT_MARKER = '[GUI_SCREENSHOT]';
const SEND_FILE_MARKER = '[SEND_FILE]';

// ── 类型定义 ──

/** 工具执行的上下文环境 */
export interface ToolExecContext {
  agentId?: string;
  conversationId?: string;
  sessionId?: string;
  sandboxEnabled: boolean;
  hardSandboxEnabled: boolean;
  allowedToolNames: Set<string>;
  targetConfigName: string;
  /** 
   * 可选回调：用于在 stream 模式下发送审批请求事件。
   * 如果不提供（non-stream 模式），则跳过需审批的工具。
   */
  onApprovalRequest?: (payload: any) => void;
}

/** 单个工具执行后的结构化结果 */
export interface ToolExecResult {
  /** 推入 LLM messages 的消息列表（可能含 tool + user(vision) 两条） */
  messagesToPush: ChatMessage[];
  /** 本次工具产生的附件（如 send_file） */
  attachments: Array<{ name: string; type: string; dataUrl: string }>;
  /** 用于前端显示的摘要块（工具调用折叠详情） */
  displayBlock: string;
  /** 原始工具返回（用于 SSE 推送） */
  rawResult: string;
}

// ── 工具结果快速构建器（用于 Harness 拦截等提前返回场景） ──

function buildToolExecResult(
  tc: ToolCall,
  toolResult: string,
  attachments: ToolExecResult['attachments'],
): ToolExecResult {
  const truncatedResult = truncateToolResult(tc.function.name, toolResult);
  const messagesToPush: ChatMessage[] = [{
    role: 'tool',
    tool_call_id: tc.id,
    name: tc.function.name,
    content: truncatedResult,
  }];
  const displayBlock = buildDisplayBlock(tc.function.name, toolResult);
  return { messagesToPush, attachments, displayBlock, rawResult: toolResult };
}

// ── 核心工具调度器 ──

/**
 * 执行单个工具调用并返回结构化结果。
 * 
 * 统一了 skill_*、mcp_* 和内置工具三条路由，
 * 以及 GUI 截图标记、文件发送标记和普通结果的后处理。
 * 
 * 这是从 stream/non-stream 双路径中提取出的**完全相同**的逻辑。
 */
export async function dispatchToolCall(
  tc: ToolCall,
  ctx: ToolExecContext,
): Promise<ToolExecResult> {
  let toolResult = '';
  const attachments: ToolExecResult['attachments'] = [];

  try {
    let args = JSON.parse(tc.function.arguments);

    // ── QC-Harness: PreToolUse 钩子 ──
    // 可拦截危险操作、修改参数、检查熔断状态
    try {
      const preResult = await qcHarness.preToolUse(tc.function.name, args);
      if (!preResult.continue) {
        // 被 Harness 拦截 → 直接返回拦截信息，不执行真实工具
        toolResult = preResult.blockReason || '[QC-Harness] 操作被安全策略拦截。';
        return buildToolExecResult(tc, toolResult, attachments);
      }
      // 如果 Hook 修改了参数，使用修改后的版本
      if (preResult.updatedArgs) args = preResult.updatedArgs;
    } catch (harnessErr) {
      // Harness 故障不应阻塞主流程
      console.error('[QC-Harness] PreToolUse hook error (non-fatal):', harnessErr);
    }

    // ── Route 1: Skill 技能调用 ──
    if (tc.function.name.startsWith('skill_')) {
      toolResult = await executeSkillTool(tc.function.name, args, ctx);
    }
    // ── Route 2: MCP 服务器工具调用 ──
    else if (tc.function.name.startsWith('mcp_')) {
      toolResult = await executeMCPTool(tc.function.name, args);
    }
    // ── Route 3: 内置系统工具 ──
    else {
      toolResult = await executeBuiltinTool(tc, args, ctx);
    }

    // ── QC-Harness: PostToolUse 钩子 ──
    // 可触发自动命令（如 eslint --fix）、记录审计日志
    try {
      const isSuccess = !toolResult.includes('Tool execution failed') && !toolResult.includes('[Permission Denied]');
      const postResult = await qcHarness.postToolUse(tc.function.name, args, toolResult, isSuccess);
      // 如果 PostToolUse Hook 产生了附加输出（如自动格式化结果），追加到工具结果
      if (postResult.appendOutput) {
        toolResult += postResult.appendOutput;
      }
    } catch (harnessErr) {
      console.error('[QC-Harness] PostToolUse hook error (non-fatal):', harnessErr);
    }
  } catch (err: any) {
    toolResult = `Tool execution failed: ${err.message}`;
  }

  // ── 后处理：把原始结果转换为结构化的 messages ──
  const messagesToPush: ChatMessage[] = [];

  if (toolResult.includes(GUI_SCREENSHOT_MARKER)) {
    const markerIdx = toolResult.indexOf(GUI_SCREENSHOT_MARKER);
    const textPart = toolResult.substring(0, markerIdx).trim();
    const dataUrl = toolResult.substring(markerIdx + GUI_SCREENSHOT_MARKER.length).trim();

    // Step 1: 文本部分作为 tool 角色
    messagesToPush.push({
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.function.name,
      content: textPart || '[OK] Screenshot captured.',
    });

    // Step 2: 截图注入为 user vision 消息（让大模型"看到"截图）
    messagesToPush.push({
      role: 'user',
      content: [
        { type: 'text', text: '[截图结果] 这是刚刚截取的当前屏幕截图，请根据此图分析并继续你的操作：' },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
      ] as any,
    });
  } else if (toolResult.includes(SEND_FILE_MARKER)) {
    const markerIdx = toolResult.indexOf(SEND_FILE_MARKER);
    const textPart = toolResult.substring(0, markerIdx).trim();
    const nlIdx = toolResult.indexOf('\n', markerIdx);
    const dataPart = toolResult.substring(markerIdx + SEND_FILE_MARKER.length, nlIdx !== -1 ? nlIdx : toolResult.length).trim();
    const [fileUrl, fileName, mimeType] = dataPart.split('|');

    attachments.push({ name: fileName, type: mimeType, dataUrl: fileUrl });

    messagesToPush.push({
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.function.name,
      content: textPart || '[OK] File sent.',
    });
  } else {
    // ── Micro-Compact：截断过大的普通工具返回 ──
    const truncatedResult = truncateToolResult(tc.function.name, toolResult);
    messagesToPush.push({
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.function.name,
      content: truncatedResult,
    });
  }

  // ── 构建前端展示折叠块 ──
  const displayBlock = buildDisplayBlock(tc.function.name, toolResult);

  return { messagesToPush, attachments, displayBlock, rawResult: toolResult };
}

// ── 私有路由分发 ──

async function executeSkillTool(
  toolName: string,
  args: any,
  ctx: ToolExecContext,
): Promise<string> {
  for (const s of skillEngine.getEnabledSkills()) {
    for (const a of s.actions) {
      if (`skill_${s.id}_${a.id}`.replace(/-/g, '_') === toolName) {
        const execRes = await skillEngine.executeSkill({
          skill: s,
          action: a,
          parameters: args,
          message: '',
          agentId: ctx.agentId,
          agentName: ctx.targetConfigName,
          sandboxEnabled: ctx.sandboxEnabled,
          hardSandboxEnabled: ctx.hardSandboxEnabled,
          onApprovalRequested: ctx.onApprovalRequest
            ? (request: any) => ctx.onApprovalRequest!(request)
            : undefined,
        });
        return execRes.success
          ? (execRes.output || JSON.stringify(execRes.data))
          : `Skill Failed: ${execRes.error}`;
      }
    }
  }
  return `Skill ${toolName} not found`;
}

async function executeMCPTool(toolName: string, args: any): Promise<string> {
  for (const s of mcpService.getEnabledServers()) {
    const tools = mcpService.getAllTools().get(s.id) || [];
    for (const mT of tools) {
      if (`mcp_${s.id}_${mT.name}`.replace(/-/g, '_') === toolName) {
        const execRes = await mcpService.callTool(s.id, mT.name, args);
        return typeof execRes === 'string' ? execRes : JSON.stringify(execRes, null, 2);
      }
    }
  }
  return `MCP Server / Tool ${toolName} not found`;
}

async function executeBuiltinTool(
  tc: ToolCall,
  args: any,
  ctx: ToolExecContext,
): Promise<string> {
  const builtInTools = new Set(['send_message', 'set_reminder', 'cancel_reminder', 'list_reminders']);
  const dangerousTools = new Set(['exec_cmd', 'write_file', 'edit_file', 'delete_file']);

  // 权限检查
  if (ctx.agentId && ctx.allowedToolNames.size > 0
      && !ctx.allowedToolNames.has(tc.function.name)
      && !builtInTools.has(tc.function.name)) {
    return `[Permission Denied] Tool "${tc.function.name}" is not enabled for this agent.`;
  }

  // 危险工具审批
  let needsApproval = false;
  const pm = ctx.agentId ? (agentService.getAgent(ctx.agentId)?.permissionMode || 'normal') : 'normal';

  if (dangerousTools.has(tc.function.name)) {
    if (pm === 'normal' || pm === 'custom') needsApproval = true;
    else if (pm === 'auto-edit' && tc.function.name === 'exec_cmd') needsApproval = true;
  }

  if (needsApproval && ctx.agentId && ctx.onApprovalRequest) {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    console.log(`[Server] High risk built-in tool intercepted: ${tc.function.name}. Requesting approval: ${executionId}`);

    ctx.onApprovalRequest({
      type: 'skill_approval_required',
      executionId,
      skillName: '内置工具',
      actionName: tc.function.name,
      parameters: args,
      agentName: ctx.targetConfigName,
    });

    const approved = await globalApprovalManager.createApproval(executionId);
    if (!approved) {
      return `❌ Execute Cancelled: User rejected the execution of ${tc.function.name}`;
    }
  }

  return await executeAgentTool(tc.function.name, args, {
    sandboxEnabled: ctx.sandboxEnabled,
    hardSandboxEnabled: ctx.hardSandboxEnabled,
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    conversationId: ctx.conversationId,
  });
}

// ── 循环检测 ──

export interface LoopDetector {
  lastSignatures: string[];
  repeatCount: number;
}

/**
 * 检测工具调用是否进入死循环。
 * @returns `null` 表示安全, 字符串表示应终止循环并返回该警告消息。
 */
export function detectToolLoop(
  toolCalls: ToolCall[],
  detector: LoopDetector,
  maxRepeats: number,
): string | null {
  const currentSigs = toolCalls.map(tc => `${tc.function.name}(${tc.function.arguments})`).sort();
  const currentKey = currentSigs.join('|');

  if (currentKey === detector.lastSignatures.join('|')) {
    detector.repeatCount++;
    if (detector.repeatCount >= maxRepeats) {
      return `\n\n> [系统预警] 助手尝试连续 ${maxRepeats} 次调用重复的工具未成功（特征: ${currentKey}），为防止死循环，系统已强行终止操作。请检查之前的错误信息或更换操作方式。`;
    }
  } else {
    detector.repeatCount = 0;
    detector.lastSignatures = currentSigs;
  }

  return null;
}

// ── 行为审计拦截器 ──

/**
 * 检测 LLM 是否在未调用工具的情况下声称完成了操作（说谎行为）。
 * 
 * 这是 QilinClaw 的独有核心安全机制，必须在任何重构中保留。
 * 
 * @returns 如果检测到说谎行为，返回注入的纠偏消息; 否则返回 null。
 */
export function auditBehavior(
  responseText: string,
  messages: ChatMessage[],
  loopCount: number,
): ChatMessage[] | null {
  const actionClaimPatterns = [
    // 中文 — "已 + 动作" 假装完成模式
    /已(?:成功)?(?:创建|写入|保存|生成|建立|制作)/,
    /已(?:成功)?(?:删除|移除|清除|清理|销毁)/,
    /已(?:成功)?(?:修改|编辑|更新|替换|改写|重写)/,
    /已(?:成功)?(?:执行|运行|安装|卸载|部署|启动)/,
    /已(?:成功)?(?:打开|访问|浏览|导航|跳转)/,
    /已(?:成功)?(?:搜索|查找|检索)(?:到|了)/,
    /已(?:成功)?(?:下载|上传|发送|提交|推送)/,
    /已(?:为你|帮你|替你|给你).*(?:完成|处理|搞定|做好)/,
    /文件.*(?:已|被).*(?:完成|成功|处理)/,
    /操作(?:已|已经)(?:完成|成功|执行)/,
    // 英文
    /(?:successfully|already)\s+(?:created|written|saved|deleted|removed|modified|edited|executed|installed)/i,
    /(?:I(?:'ve| have))\s+(?:created|written|deleted|removed|modified|edited|executed|installed|opened)/i,
    /(?:file|directory|folder)\s+(?:has been|was)\s+(?:created|deleted|modified|saved)/i,
  ];

  const hasActionClaim = actionClaimPatterns.some(p => p.test(responseText));

  // 检查是否有真实的工具执行记录
  const hasRealToolExecution = messages.some(
    (m: any) => m.role === 'tool' ||
      (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0),
  );

  if (hasActionClaim && !hasRealToolExecution && loopCount <= 2) {
    console.warn(`[BehaviorAudit] Intercepted fake execution at loop ${loopCount}. Text: "${responseText.substring(0, 120)}..."`);

    return [
      { role: 'assistant' as const, content: responseText },
      {
        role: 'user' as const,
        content:
          `[⚠️ 系统行为审计] 你的回复声称已完成了实际操作（如创建文件、删除文件、执行命令等），但系统检测到你没有调用任何工具 function call。\n\n` +
          `你必须：\n` +
          `1. 如果需要执行操作 → 使用 function call 调用工具（如 write_file, delete_file, exec_cmd 等）\n` +
          `2. 如果无法执行 → 诚实告知用户\n` +
          `3. 绝对禁止在文本中假装已完成操作\n\n` +
          `请重新回答用户的请求。`,
      },
    ];
  }

  return null;
}

// ── 对话持久化 ──

/**
 * 将本轮对话结果持久化到数据库和线程中。
 */
export async function persistTurnResult(params: {
  conversationId?: string;
  agentId?: string;
  responseContent: string;
  userContent?: string;
  attachments?: any[];
}): Promise<void> {
  const { conversationId, agentId, responseContent, userContent, attachments } = params;

  if (!responseContent || !conversationId) return;

  // 保存到上下文记忆
  await contextMemory.addMessage(conversationId, {
    role: 'assistant',
    content: responseContent,
  });

  // 更新线程
  const thread = agentService.getThread(conversationId);
  if (thread) {
    agentService.updateThread(conversationId, {
      messages: [...thread.messages, {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: responseContent,
        timestamp: Date.now(),
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      }],
    });
  }

  // 提取关键信息到长期记忆（双轨并行：旧版 + 新版 taxonomy）
  if (agentId && userContent) {
    // 旧版正则提取（兼容层，后续可移除）
    agentMemoryManager.extractKeyInfoFromConversation(
      agentId, userContent, responseContent,
    ).catch(err => console.error('[AgentMemory] Legacy extraction failed:', err));

    // 新版 4 层分类提取（后台静默，fire-and-forget）
    taxonomyMemory.extractFromConversation(
      agentId, userContent, responseContent,
    ).catch(err => console.error('[TaxonomyMemory] Extraction failed:', err));
  }
}

/**
 * 记录本轮 LLM 使用量。
 */
export function recordTurnUsage(params: {
  agentId?: string;
  conversationId?: string;
  configId: string;
  model: string;
  provider: string;
  messages: ChatMessage[];
  responseLength: number;
  duration: number;
  success: boolean;
  error?: string;
}): void {
  const inputTokens = params.messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(content.length / 4);
  }, 0);

  usageTracker.recordUsage({
    agentId: params.agentId,
    conversationId: params.conversationId,
    llmConfigId: params.configId,
    model: params.model,
    provider: params.provider,
    inputTokens,
    outputTokens: Math.ceil(params.responseLength / 4),
    duration: params.duration,
    success: params.success,
    error: params.error,
  });
}

// ── 工具 ──

function buildDisplayBlock(toolName: string, toolResult: string): string {
  try {
    let parsedResult = toolResult;
    if (toolResult.includes(GUI_SCREENSHOT_MARKER)) {
      parsedResult = toolResult.substring(0, toolResult.indexOf(GUI_SCREENSHOT_MARKER)).trim();
    } else if (toolResult.includes(SEND_FILE_MARKER)) {
      parsedResult = toolResult.substring(0, toolResult.indexOf(SEND_FILE_MARKER)).trim();
    }
    const displayResult = parsedResult.substring(0, 800);
    return `\n\n<details><summary>⚙️ 工具调用: <code>${toolName}</code></summary>\n\n\`\`\`\n${displayResult}\n\`\`\`\n\n</details>\n\n`;
  } catch (e) {
    console.error('[Server] Failed to build display block:', e);
    return '';
  }
}
