import cron from 'node-cron';
import { agentService } from './agent-service.js';
import { modelsManager } from '../models/manager.js';
import { gatewayService } from './gateway.js';
import { logger } from './logger.js';

interface CronTask {
  id: string;
  agentId: string;
  schedule: string;
  action: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: Date;
  createdAt: number;
}

class CronService {
  private tasks: Map<string, CronTask> = new Map();
  private scheduledJobs: Map<string, any> = new Map();

  constructor() {
    this.loadTasks();
  }

  private loadTasks(): void {
    console.log('[CronService] Loading scheduled tasks...');
  }

  addTask(agentId: string, schedule: string, action: string): string {
    const id = `cron-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const task: CronTask = {
      id,
      agentId,
      schedule,
      action,
      enabled: true,
      createdAt: Date.now()
    };

    this.tasks.set(id, task);
    this.scheduleTask(task);

    logger.info('Cron task added', { id, agentId, schedule, action });
    console.log(`[CronService] Added task ${id} for agent ${agentId}: ${schedule} - ${action}`);

    return id;
  }

  private scheduleTask(task: CronTask): void {
    if (!task.enabled) return;

    try {
      const job = cron.schedule(task.schedule, async () => {
        console.log(`[CronService] Executing task ${task.id}: ${task.action}`);
        
        task.lastRun = Date.now();
        task.nextRun = this.getNextRun(task.schedule);

        await this.executeTask(task);
      }, {
        timezone: 'Asia/Shanghai'
      });

      this.scheduledJobs.set(task.id, job);
      task.nextRun = this.getNextRun(task.schedule);

      console.log(`[CronService] Scheduled task ${task.id}, next run: ${task.nextRun}`);
    } catch (error) {
      console.error(`[CronService] Failed to schedule task ${task.id}:`, error);
      logger.error('Failed to schedule cron task', { id: task.id, error: (error as Error).message });
    }
  }

  private async executeTask(task: CronTask): Promise<void> {
    try {
      const agent = agentService.getAgent(task.agentId);
      if (!agent) {
        console.warn(`[CronService] Agent ${task.agentId} not found for task ${task.id}`);
        return;
      }

      const systemPrompt = `你是「${agent.name}」。定时任务刚刚触发。

任务内容：${task.action}

请执行这个任务，并在完成后使用send_message工具向用户汇报结果。`;

      const response = await modelsManager.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请执行定时任务：${task.action}` }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'send_message',
              description: 'Send a message to the user.',
              parameters: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'The message content.' },
                  type: { type: 'string', enum: ['progress', 'status', 'question', 'result'] }
                },
                required: ['content']
              }
            }
          }
        ]
      }, agent.defaultModel);

      if (response.content) {
        console.log(`[CronService] Task ${task.id} executed: ${response.content}`);
        
        const sessions = gatewayService.getSessionsByAgent(task.agentId);
        if (sessions.length > 0) {
          gatewayService.sendMessage(sessions[0].id, 'status', `⏰ [定时任务] ${task.action}\n\n${response.content}`);
        }
      }

      logger.info('Cron task executed', { id: task.id, agentId: task.agentId, action: task.action });
    } catch (error) {
      console.error(`[CronService] Failed to execute task ${task.id}:`, error);
      logger.error('Failed to execute cron task', { id: task.id, error: (error as Error).message });
    }
  }

  private getNextRun(schedule: string): Date | undefined {
    try {
      return new Date();
    } catch {
      return undefined;
    }
  }

  removeTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    const job = this.scheduledJobs.get(id);
    if (job) {
      job.stop();
      this.scheduledJobs.delete(id);
    }

    this.tasks.delete(id);

    logger.info('Cron task removed', { id });
    console.log(`[CronService] Removed task ${id}`);

    return true;
  }

  enableTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.enabled = true;
    this.scheduleTask(task);

    logger.info('Cron task enabled', { id });
    console.log(`[CronService] Enabled task ${id}`);

    return true;
  }

  disableTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.enabled = false;

    const job = this.scheduledJobs.get(id);
    if (job) {
      job.stop();
      this.scheduledJobs.delete(id);
    }

    logger.info('Cron task disabled', { id });
    console.log(`[CronService] Disabled task ${id}`);

    return true;
  }

  getTask(id: string): CronTask | undefined {
    return this.tasks.get(id);
  }

  getTasksByAgent(agentId: string): CronTask[] {
    return Array.from(this.tasks.values()).filter(t => t.agentId === agentId);
  }

  getAllTasks(): CronTask[] {
    return Array.from(this.tasks.values());
  }

  stopAllTasks(): void {
    for (const [id, job] of this.scheduledJobs.entries()) {
      job.stop();
      console.log(`[CronService] Stopped task ${id}`);
    }
    this.scheduledJobs.clear();
  }
}

export const cronService = new CronService();
