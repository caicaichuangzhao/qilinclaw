/**
 * coordinator-service.ts
 *
 * QilinClaw Coordinator 多体协同调度器 — Phase 4
 *
 * 实现主仆式 Agent 编排：
 * - Coordinator Agent 接收大任务 → 分解为子任务
 * - 子 Agent 各自并行执行 → 结果汇总
 * - 最终由 Coordinator 整合输出
 *
 * 设计原则：
 * 1. 复用现有 chatOrchestrator — 子任务通过 generateResponse 执行
 * 2. 轻量级 — 不引入消息队列，使用 Promise.allSettled 并行
 * 3. 容错性 — 子任务失败不阻塞整体，降级为部分结果汇总
 * 4. 可追踪 — 每个子任务有独立的 ID 和状态
 */

import { agentService } from './agent-service.js';

// ── 类型定义 ──

/** 子任务状态 */
export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 单个子任务 */
export interface SubTask {
  id: string;
  /** 子任务描述 */
  description: string;
  /** 分配给哪个 Agent（ID） */
  assignedAgentId?: string;
  /** Agent 名称（用于展示） */
  assignedAgentName?: string;
  /** 优先级（数字越小越先执行） */
  priority: number;
  /** 依赖的其他子任务 ID（必须先完成） */
  dependsOn: string[];
  /** 当前状态 */
  status: SubTaskStatus;
  /** 执行结果 */
  result?: string;
  /** 错误信息 */
  error?: string;
  /** 执行耗时(ms) */
  duration?: number;
}

/** 协同任务 */
export interface CoordinationTask {
  id: string;
  /** 原始大任务描述 */
  originalTask: string;
  /** Coordinator Agent ID */
  coordinatorAgentId: string;
  /** 分解后的子任务列表 */
  subTasks: SubTask[];
  /** 整体状态 */
  status: 'planning' | 'executing' | 'merging' | 'completed' | 'failed';
  /** 最终合并结果 */
  finalResult?: string;
  /** 创建时间 */
  createdAt: number;
  /** 完成时间 */
  completedAt?: number;
}

/** 进度回调 */
export type ProgressCallback = (task: CoordinationTask) => void;

// ── 常量 ──

/** 最大并行子任务数 */
const MAX_PARALLEL_SUBTASKS = 3;

/** 子任务超时(ms) */
const SUBTASK_TIMEOUT_MS = 120_000; // 2 分钟

// ── 核心服务 ──

class CoordinatorService {
  private activeTasks: Map<string, CoordinationTask> = new Map();

  /**
   * 执行一个需要多 Agent 协同的大任务。
   *
   * 工作流：
   * 1. Coordinator 分解任务 → 生成子任务列表
   * 2. 按依赖关系分批并行执行子任务
   * 3. 收集所有结果 → Coordinator 汇总整合
   *
   * @param coordinatorAgentId 主协调 Agent 的 ID
   * @param task               任务描述
   * @param onProgress         进度回调
   * @returns 最终合并结果
   */
  async orchestrate(
    coordinatorAgentId: string,
    task: string,
    onProgress?: ProgressCallback,
  ): Promise<CoordinationTask> {
    const taskId = `coord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const coordTask: CoordinationTask = {
      id: taskId,
      originalTask: task,
      coordinatorAgentId,
      subTasks: [],
      status: 'planning',
      createdAt: Date.now(),
    };

    this.activeTasks.set(taskId, coordTask);
    onProgress?.(coordTask);

    try {
      // ── Phase 1: 任务分解 ──
      console.log(`[Coordinator] ${taskId}: 开始任务分解...`);
      coordTask.subTasks = await this.decomposeTask(coordinatorAgentId, task);
      onProgress?.(coordTask);

      if (coordTask.subTasks.length === 0) {
        // 如果没有子任务（任务太简单），直接让 Coordinator 执行
        coordTask.status = 'executing';
        const directResult = await this.executeDirectly(coordinatorAgentId, task);
        coordTask.finalResult = directResult;
        coordTask.status = 'completed';
        coordTask.completedAt = Date.now();
        onProgress?.(coordTask);
        return coordTask;
      }

      console.log(`[Coordinator] ${taskId}: 分解为 ${coordTask.subTasks.length} 个子任务`);

      // ── Phase 2: 并行执行 ──
      coordTask.status = 'executing';
      onProgress?.(coordTask);
      await this.executeSubTasks(coordTask, onProgress);

      // ── Phase 3: 结果汇总 ──
      coordTask.status = 'merging';
      onProgress?.(coordTask);
      coordTask.finalResult = await this.mergeResults(coordinatorAgentId, coordTask);

      coordTask.status = 'completed';
      coordTask.completedAt = Date.now();
      console.log(`[Coordinator] ${taskId}: 任务完成, 耗时 ${coordTask.completedAt - coordTask.createdAt}ms`);
    } catch (err: any) {
      coordTask.status = 'failed';
      coordTask.finalResult = `协同任务执行失败: ${err.message}`;
      console.error(`[Coordinator] ${taskId}: 任务失败:`, err);
    }

    onProgress?.(coordTask);
    return coordTask;
  }

  /**
   * 获取当前活跃的协同任务列表（用于前端展示）。
   */
  getActiveTasks(): CoordinationTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * 获取指定任务详情。
   */
  getTask(taskId: string): CoordinationTask | undefined {
    return this.activeTasks.get(taskId);
  }

  // ── 内部方法 ──

  /**
   * 使用 Coordinator Agent 分解大任务为子任务列表。
   */
  private async decomposeTask(agentId: string, task: string): Promise<SubTask[]> {
    const { chatOrchestrator } = await import('./chat-orchestrator.js');

    // 获取可用的 Worker Agent 列表
    const allAgents = agentService.getAllAgents();
    const workerAgents = allAgents
      .filter(a => a.id !== agentId)
      .map(a => `- ${a.name} (ID: ${a.id}): ${a.systemPrompt?.substring(0, 100) || '通用助手'}`);;

    const decomposePrompt = `你是一个任务分解协调者。请将以下大任务分解为可并行执行的子任务。

大任务: ${task}

可用的执行 Agent:
${workerAgents.length > 0 ? workerAgents.join('\n') : '- 无其他可用 Agent（将由你自己执行）'}

规则:
1. 如果任务足够简单，不需要分解，返回空数组 []
2. 每个子任务应该是独立可执行的
3. 如果子任务之间有依赖关系，用 dependsOn 指定
4. 优先级数字越小越优先（0 = 最高）

严格按以下 JSON 格式返回（不要有其他文字）:
[{"description":"子任务描述","assignedAgentId":"agent-id或空","priority":0,"dependsOn":[]}]`;

    const result = await chatOrchestrator.generateResponse({
      messages: [
        { role: 'system', content: '你是一个任务分解助手。只输出 JSON 数组，不要任何解释。' },
        { role: 'user', content: decomposePrompt },
      ],
      configId: this.getAgentConfigId(agentId),
    });

    const text = result.content || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const rawTasks = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(rawTasks)) return [];

      const now = Date.now();
      return rawTasks.map((t: any, i: number) => ({
        id: `sub-${now}-${i}`,
        description: String(t.description || ''),
        assignedAgentId: t.assignedAgentId || agentId,
        assignedAgentName: this.getAgentName(t.assignedAgentId || agentId),
        priority: Number(t.priority) || i,
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
        status: 'pending' as SubTaskStatus,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 按依赖关系分批并行执行子任务。
   */
  private async executeSubTasks(
    coordTask: CoordinationTask,
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const { subTasks } = coordTask;
    const completed = new Set<string>();

    // 按优先级排序
    subTasks.sort((a, b) => a.priority - b.priority);

    while (completed.size < subTasks.length) {
      // 找出当前可执行的子任务（依赖已完成 + 状态为 pending）
      const ready = subTasks.filter(t =>
        t.status === 'pending' &&
        t.dependsOn.every(dep => completed.has(dep))
      );

      if (ready.length === 0) {
        // 死锁检测：所有剩余任务都在等待未完成的依赖
        const remaining = subTasks.filter(t => t.status === 'pending');
        if (remaining.length > 0) {
          console.error('[Coordinator] 检测到依赖死锁，强制执行剩余任务');
          for (const t of remaining) {
            t.dependsOn = [];
          }
          continue;
        }
        break;
      }

      // 限制并行数
      const batch = ready.slice(0, MAX_PARALLEL_SUBTASKS);

      console.log(`[Coordinator] 执行批次: ${batch.map(t => t.id).join(', ')}`);

      // 并行执行当前批次
      const results = await Promise.allSettled(
        batch.map(subTask => this.executeSingleSubTask(subTask, coordTask))
      );

      // 处理结果
      for (let i = 0; i < batch.length; i++) {
        const subTask = batch[i];
        const result = results[i];

        if (result.status === 'fulfilled') {
          subTask.status = 'completed';
          subTask.result = result.value;
          completed.add(subTask.id);
        } else {
          subTask.status = 'failed';
          subTask.error = result.reason?.message || '未知错误';
          completed.add(subTask.id); // 失败也标记为已完成，避免阻塞
        }

        onProgress?.(coordTask);
      }
    }
  }

  /**
   * 执行单个子任务（带超时保护）。
   */
  private async executeSingleSubTask(
    subTask: SubTask,
    coordTask: CoordinationTask,
  ): Promise<string> {
    subTask.status = 'running';
    const startTime = Date.now();
    const agentId = subTask.assignedAgentId || coordTask.coordinatorAgentId;

    console.log(`[Coordinator] 子任务 ${subTask.id} 开始执行: "${subTask.description.substring(0, 50)}..." (Agent: ${subTask.assignedAgentName})`);

    try {
      const { chatOrchestrator } = await import('./chat-orchestrator.js');

      // 添加超时保护
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`子任务超时 (${SUBTASK_TIMEOUT_MS / 1000}s)`)), SUBTASK_TIMEOUT_MS)
      );

      const execPromise = chatOrchestrator.generateResponse({
        messages: [
          {
            role: 'user',
            content: `[协同任务] 你正在执行一个大任务的子部分。\n\n大任务背景: ${coordTask.originalTask.substring(0, 200)}\n\n你的子任务: ${subTask.description}\n\n请专注完成你的子任务，输出简洁的结果。`,
          },
        ],
        configId: this.getAgentConfigId(agentId),
        agentId,
      });

      const result = await Promise.race([execPromise, timeoutPromise]);
      subTask.duration = Date.now() - startTime;

      console.log(`[Coordinator] 子任务 ${subTask.id} 完成, 耗时 ${subTask.duration}ms`);
      return result.content || '';
    } catch (err: any) {
      subTask.duration = Date.now() - startTime;
      throw err;
    }
  }

  /**
   * 直接由 Coordinator 执行简单任务（不分解）。
   */
  private async executeDirectly(agentId: string, task: string): Promise<string> {
    const { chatOrchestrator } = await import('./chat-orchestrator.js');

    const result = await chatOrchestrator.generateResponse({
      messages: [{ role: 'user', content: task }],
      configId: this.getAgentConfigId(agentId),
      agentId,
    });

    return result.content || '';
  }

  /**
   * 由 Coordinator Agent 合并所有子任务结果。
   */
  private async mergeResults(
    agentId: string,
    coordTask: CoordinationTask,
  ): Promise<string> {
    const { chatOrchestrator } = await import('./chat-orchestrator.js');

    const subTaskSummaries = coordTask.subTasks.map((t, i) => {
      const statusEmoji = t.status === 'completed' ? '✅' : '❌';
      const result = t.status === 'completed'
        ? t.result?.substring(0, 500) || '(空)'
        : `失败: ${t.error}`;
      return `### 子任务 ${i + 1}: ${t.description}\n${statusEmoji} 状态: ${t.status}\n执行者: ${t.assignedAgentName}\n结果:\n${result}`;
    }).join('\n\n---\n\n');

    const mergePrompt = `你是一个大任务的总协调者。各个子任务的执行者已经完成了他们的工作。

原始任务: ${coordTask.originalTask}

各子任务结果:
${subTaskSummaries}

请根据上述所有子任务的结果，整合出一份完整、连贯的最终回复。
如果某些子任务失败了，请在最终回复中说明缺失的部分。`;

    const result = await chatOrchestrator.generateResponse({
      messages: [
        { role: 'user', content: mergePrompt },
      ],
      configId: this.getAgentConfigId(agentId),
      agentId,
    });

    return result.content || '';
  }

  // ── 辅助工具 ──

  private getAgentConfigId(agentId: string): string {
    const agent = agentService.getAgent(agentId);
    return agent?.defaultModel || '';
  }

  private getAgentName(agentId: string): string {
    const agent = agentService.getAgent(agentId);
    return agent?.name || agentId;
  }
}

export const coordinatorService = new CoordinatorService();
