/**
 * SchedulerService — 定时任务调度服务
 * 支持 Agent 通过 set_reminder 工具设置定时提醒，
 * 到期时自动触发 Agent 生成回复并通过 WebSocket 推送给前端。
 */
import { EventEmitter } from 'events';

export interface ScheduledTask {
    id: string;
    agentId: string;
    conversationId: string;
    message: string;
    triggerAt: number;       // Unix timestamp (ms)
    createdAt: number;
    status: 'pending' | 'fired' | 'cancelled';
    repeat?: {
        intervalMs: number;
        remaining: number;     // -1 = infinite
    };
}

class SchedulerService extends EventEmitter {
    private tasks: Map<string, ScheduledTask> = new Map();
    private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private taskIdCounter = 0;

    /**
     * Schedule a new reminder / proactive message.
     */
    addTask(opts: {
        agentId: string;
        conversationId: string;
        message: string;
        delayMs: number;
        repeat?: { intervalMs: number; count: number };
    }): ScheduledTask {
        const id = `sched-${Date.now()}-${++this.taskIdCounter}`;
        const task: ScheduledTask = {
            id,
            agentId: opts.agentId,
            conversationId: opts.conversationId,
            message: opts.message,
            triggerAt: Date.now() + opts.delayMs,
            createdAt: Date.now(),
            status: 'pending',
            repeat: opts.repeat ? { intervalMs: opts.repeat.intervalMs, remaining: opts.repeat.count } : undefined,
        };
        this.tasks.set(id, task);
        this._scheduleTimer(task);
        console.log(`[Scheduler] Task ${id} created: "${opts.message}" in ${Math.round(opts.delayMs / 1000)}s`);
        return task;
    }

    /**
     * Cancel a scheduled task.
     */
    cancelTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'pending') return false;
        task.status = 'cancelled';
        const timer = this.timers.get(taskId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(taskId);
        }
        console.log(`[Scheduler] Task ${taskId} cancelled`);
        return true;
    }

    /**
     * List tasks by agent or conversation.
     */
    getTasksByAgent(agentId: string): ScheduledTask[] {
        return Array.from(this.tasks.values()).filter(t => t.agentId === agentId);
    }

    getTasksByConversation(conversationId: string): ScheduledTask[] {
        return Array.from(this.tasks.values()).filter(t => t.conversationId === conversationId);
    }

    getPendingTasks(): ScheduledTask[] {
        return Array.from(this.tasks.values()).filter(t => t.status === 'pending');
    }

    /**
     * Internal: set a timer to fire the task.
     */
    private _scheduleTimer(task: ScheduledTask): void {
        const delay = Math.max(0, task.triggerAt - Date.now());
        const timer = setTimeout(() => {
            this._fireTask(task);
        }, delay);
        this.timers.set(task.id, timer);
    }

    /**
     * Internal: fire the task — emit event so index.ts can orchestrate the LLM call.
     */
    private _fireTask(task: ScheduledTask): void {
        if (task.status !== 'pending') return;
        task.status = 'fired';
        this.timers.delete(task.id);

        console.log(`[Scheduler] 🔔 Task ${task.id} fired: "${task.message}"`);
        this.emit('task_fired', task);

        // Handle repeating tasks
        if (task.repeat && task.repeat.remaining !== 0) {
            const nextTask: ScheduledTask = {
                ...task,
                id: `sched-${Date.now()}-${++this.taskIdCounter}`,
                triggerAt: Date.now() + task.repeat.intervalMs,
                createdAt: Date.now(),
                status: 'pending',
                repeat: {
                    intervalMs: task.repeat.intervalMs,
                    remaining: task.repeat.remaining > 0 ? task.repeat.remaining - 1 : -1,
                },
            };
            this.tasks.set(nextTask.id, nextTask);
            this._scheduleTimer(nextTask);
            console.log(`[Scheduler] Repeat task ${nextTask.id} scheduled in ${Math.round(task.repeat.intervalMs / 1000)}s`);
        }
    }

    /**
     * Clean up old fired/cancelled tasks (memory hygiene).
     */
    cleanupOldTasks(maxAge: number = 86400000): void {
        const now = Date.now();
        for (const [id, task] of this.tasks.entries()) {
            if (task.status !== 'pending' && now - task.createdAt > maxAge) {
                this.tasks.delete(id);
            }
        }
    }

    /**
     * Stop all timers (for graceful shutdown).
     */
    stopAll(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        console.log(`[Scheduler] All timers stopped`);
    }
}

export const schedulerService = new SchedulerService();

// Periodic cleanup every hour
setInterval(() => {
    schedulerService.cleanupOldTasks();
}, 3600000);
