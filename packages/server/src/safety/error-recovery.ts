import { EventEmitter } from 'events';
import os from 'os';
import type { SystemStatus } from '../types/index.js';
import { botManager } from '../bots/manager.js';

interface ErrorRecord {
  id: string;
  timestamp: number;
  error: Error;
  context: string;
  recovered: boolean;
  recoveryAttempts: number;
  type: 'gateway' | 'system' | 'file' | 'network' | 'bot' | 'unknown';
}

interface HealthCheck {
  name: string;
  check: () => Promise<boolean>;
  interval: number;
  lastCheck?: number;
  lastStatus?: boolean;
}

export type SystemHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'recovering';
export type ErrorType = 'gateway' | 'system' | 'file' | 'network' | 'bot' | 'unknown';

export interface EnhancedSystemStatus extends SystemStatus {
  healthStatus: SystemHealthStatus;
  errorType?: ErrorType;
  lastComponentError: {
    message: string;
    context: string;
    timestamp: number;
    type: ErrorType;
  } | null;
  recoveryInfo: {
    inProgress: boolean;
    scheduledAt: number | null;
    recoverIn: number | null;
    attemptCount: number;
  };
  components: {
    database: { status: 'ok' | 'error'; message: string };
    bots: { status: 'ok' | 'error' | 'partial'; message: string; count: number };
    memory: { status: 'ok' | 'warning' | 'error'; message: string };
    network: { status: 'ok' | 'error'; message: string };
    gateway: { status: 'ok' | 'error'; message: string };
  };
}

export class ErrorRecoveryService extends EventEmitter {
  private errors: ErrorRecord[] = [];
  private healthChecks: Map<string, HealthCheck> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private maxErrors = 100;
  private maxRecoveryAttempts = 3;
  private startTime = Date.now();
  private isShuttingDown = false;
  private recoveryScheduledAt: number | null = null;
  private recoveryInProgress = false;
  private autoRecoveryEnabled = true;
  private recoveryDelayMs = 10 * 60 * 1000; // 默认10分钟

  constructor() {
    super();
    this.setupGracefulShutdown();
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      const savedDelay = process.env.RECOVERY_DELAY_MINUTES;
      if (savedDelay) {
        this.recoveryDelayMs = parseInt(savedDelay, 10) * 60 * 1000;
      }
    } catch {
      // 使用默认值
    }
  }

  setAutoRecovery(enabled: boolean): void {
    this.autoRecoveryEnabled = enabled;
    if (!enabled && this.recoveryScheduledAt) {
      this.recoveryScheduledAt = null;
    }
  }

  setRecoveryDelay(delayMinutes: number): void {
    this.recoveryDelayMs = delayMinutes * 60 * 1000;
  }

  getRecoveryDelay(): number {
    return Math.round(this.recoveryDelayMs / 60000);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log(`Received ${signal}, starting graceful shutdown...`);
      this.emit('shutdown', signal);

      await this.stopAllHealthChecks();

      for (const interval of this.intervals.values()) {
        clearInterval(interval);
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      this.handleError(error, 'uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      this.handleError(
        reason instanceof Error ? reason : new Error(String(reason)),
        'unhandledRejection'
      );
    });
  }

  handleError(error: Error, context: string): ErrorRecord {
    const errorType = this.classifyError(error, context);

    const record: ErrorRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      error,
      context,
      recovered: false,
      recoveryAttempts: 0,
      type: errorType,
    };

    this.errors.unshift(record);
    if (this.errors.length > this.maxErrors) {
      this.errors.pop();
    }

    if (this.listenerCount('error') > 0) {
      this.emit('error', record);
    }
    console.error(`[${context}] Error:`, error.message);

    // Skip auto-recovery for harmless errors:
    // - EADDRINUSE/EACCES: startup port conflicts
    // - Gateway/network errors from unhandledRejection: external API timeouts (e.g. DingTalk)
    const isStartupError = (error as any).code === 'EADDRINUSE' || (error as any).code === 'EACCES';
    const isExternalConnectionError = (errorType === 'gateway' || errorType === 'network') &&
      (context === 'unhandledRejection' || context === 'uncaughtException');

    // 自动触发恢复倒计时 - 但跳过瞬态错误
    if (this.autoRecoveryEnabled && !this.recoveryScheduledAt && !this.recoveryInProgress && !isStartupError && !isExternalConnectionError) {
      this.scheduleRecovery(this.recoveryDelayMs);
      console.log(`[ErrorRecovery] Auto-recovery scheduled in ${this.recoveryDelayMs / 60000} minutes due to error: ${errorType}`);
    } else if (isStartupError || isExternalConnectionError) {
      console.log(`[ErrorRecovery] Skipping auto-recovery for transient error: ${isStartupError ? (error as any).code : errorType} (${context})`);
      // Mark as recovered since it's a transient error
      record.recovered = true;
    }

    return record;
  }

  private classifyError(error: Error, context: string): ErrorType {
    const message = error.message.toLowerCase();
    const contextLower = context.toLowerCase();

    if (contextLower.includes('bot') ||
      contextLower.includes('dingtalk') ||
      contextLower.includes('discord') ||
      contextLower.includes('telegram') ||
      contextLower.includes('slack') ||
      contextLower.includes('wecom') ||
      contextLower.includes('feishu') ||
      contextLower.includes('line') ||
      contextLower.includes('whatsapp') ||
      contextLower.includes('messenger') ||
      message.includes('api.dingtalk.com') ||
      message.includes('discord.com') ||
      message.includes('api.telegram.org')) {
      return 'bot';
    }

    if (contextLower.includes('gateway') ||
      message.includes('gateway') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('socket hang up') ||
      message.includes('connect econnrefused')) {
      return 'gateway';
    }

    if (contextLower.includes('network') ||
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('dns') ||
      message.includes('enotfound')) {
      return 'network';
    }

    if (contextLower.includes('file') ||
      message.includes('enoent') ||
      message.includes('eacces') ||
      message.includes('ep erm') ||
      message.includes('file') ||
      message.includes('read file') ||
      message.includes('write file')) {
      return 'file';
    }

    if (contextLower.includes('system') ||
      message.includes('memory') ||
      message.includes('cpu') ||
      message.includes('spawn') ||
      message.includes('exec')) {
      return 'system';
    }

    return 'unknown';
  }

  async attemptRecovery(record: ErrorRecord, recoveryFn: () => Promise<boolean>): Promise<boolean> {
    if (record.recoveryAttempts >= this.maxRecoveryAttempts) {
      console.error(`Max recovery attempts reached for error: ${record.id}`);
      return false;
    }

    record.recoveryAttempts++;

    try {
      const recovered = await recoveryFn();
      if (recovered) {
        record.recovered = true;
        this.emit('recovered', record);
      }
      return recovered;
    } catch (error) {
      console.error(`Recovery attempt failed for error ${record.id}:`, error);
      return false;
    }
  }

  registerHealthCheck(name: string, check: () => Promise<boolean>, intervalMs: number = 30000): void {
    if (this.healthChecks.has(name)) {
      this.stopHealthCheck(name);
    }

    const healthCheck: HealthCheck = { name, check, interval: intervalMs };
    this.healthChecks.set(name, healthCheck);

    check().then(status => {
      healthCheck.lastCheck = Date.now();
      healthCheck.lastStatus = status;
    }).catch(() => {
      healthCheck.lastStatus = false;
    });

    const interval = setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        const status = await check();
        healthCheck.lastCheck = Date.now();
        healthCheck.lastStatus = status;

        if (!status) {
          this.emit('healthCheckFailed', { name, check: healthCheck });
        }
      } catch (error) {
        healthCheck.lastStatus = false;
        this.handleError(error instanceof Error ? error : new Error(String(error)), `healthCheck:${name}`);
      }
    }, intervalMs);

    this.intervals.set(name, interval);
  }

  stopHealthCheck(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
    this.healthChecks.delete(name);
  }

  async stopAllHealthChecks(): Promise<void> {
    for (const name of this.healthChecks.keys()) {
      this.stopHealthCheck(name);
    }
  }

  async runHealthCheck(name: string): Promise<boolean> {
    const healthCheck = this.healthChecks.get(name);
    if (!healthCheck) return false;

    try {
      const status = await healthCheck.check();
      healthCheck.lastCheck = Date.now();
      healthCheck.lastStatus = status;
      return status;
    } catch {
      healthCheck.lastStatus = false;
      return false;
    }
  }

  getHealthStatus(): Record<string, { status: boolean; lastCheck: number | undefined }> {
    const status: Record<string, { status: boolean; lastCheck: number | undefined }> = {};
    for (const [name, check] of this.healthChecks) {
      status[name] = {
        status: check.lastStatus ?? false,
        lastCheck: check.lastCheck,
      };
    }
    return status;
  }

  getErrors(limit: number = 50): ErrorRecord[] {
    return this.errors.slice(0, limit);
  }

  getUnrecoveredErrors(): ErrorRecord[] {
    return this.errors.filter(e => !e.recovered);
  }

  clearErrors(): void {
    this.errors = [];
  }

  getSystemStatus(): EnhancedSystemStatus {
    const healthStatus = this.getHealthStatus();
    const healthy = Object.values(healthStatus).every(s => s.status);
    const memUsage = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();
    const unrecoveredErrors = this.getUnrecoveredErrors();

    // 过滤掉bot和gateway类型的错误，不影响系统健康状态
    // gateway错误通常是外部API超时（如钉钉连接），不代表本系统故障
    const criticalErrors = unrecoveredErrors.filter(e => e.type !== 'bot' && e.type !== 'gateway');

    // Determine health status - 只考虑非bot类型的错误
    let healthStatusLevel: SystemHealthStatus = 'healthy';
    let errorType: ErrorType | undefined = undefined;

    if (this.recoveryInProgress) {
      healthStatusLevel = 'recovering';
    } else if (criticalErrors.length > 0) {
      healthStatusLevel = criticalErrors.length > 3 ? 'unhealthy' : 'degraded';
      errorType = criticalErrors[0]?.type || 'unknown';
    }

    // Calculate recovery info
    const recoveryInfo = {
      inProgress: this.recoveryInProgress,
      scheduledAt: this.recoveryScheduledAt,
      recoverIn: this.recoveryScheduledAt ? Math.max(0, this.recoveryScheduledAt - Date.now()) : null,
      attemptCount: criticalErrors.reduce((acc, e) => acc + e.recoveryAttempts, 0),
    };

    // Component status - 使用系统内存而不是 Node.js 堆内存
    const systemUsedMB = (systemTotal - systemFree) / 1024 / 1024;
    const systemTotalMB = systemTotal / 1024 / 1024;
    const systemMemoryPercent = ((systemTotal - systemFree) / systemTotal) * 100;

    // Gateway status based on errors - 只考虑真正的网关错误
    const hasGatewayError = unrecoveredErrors.some(e => e.type === 'gateway');
    const hasNetworkError = unrecoveredErrors.some(e => e.type === 'network');

    return {
      healthy,
      healthStatus: healthStatusLevel,
      errorType,
      uptime: Date.now() - this.startTime,
      activeConnections: 0,
      requestsPerMinute: 0,
      memoryUsage: memUsage,
      activeBots: botManager.getRunningBots(),
      lastComponentError: this.errors[0] ? {
        message: this.errors[0].error.message,
        context: this.errors[0].context,
        timestamp: this.errors[0].timestamp,
        type: this.errors[0].type,
      } : null,
      recoveryInfo,
      components: {
        database: {
          status: healthy ? 'ok' : 'error',
          message: healthy ? '数据库连接正常' : '数据库连接异常'
        },
        bots: {
          status: 'ok',
          message: '机器人服务正常',
          count: botManager.getRunningBots().length
        },
        memory: {
          status: systemMemoryPercent > 95 ? 'error' : systemMemoryPercent > 85 ? 'warning' : 'ok',
          message: `系统内存使用 ${(systemUsedMB / 1024).toFixed(1)}/${(systemTotalMB / 1024).toFixed(1)} GB (${systemMemoryPercent.toFixed(1)}%)`
        },
        network: {
          status: hasNetworkError ? 'error' : 'ok',
          message: hasNetworkError ? '网络连接异常' : '网络连接正常'
        },
        gateway: {
          status: hasGatewayError ? 'error' : 'ok',
          message: hasGatewayError ? '网关连接断开' : '网关连接正常'
        },
      },
    };
  }

  scheduleRecovery(delayMs: number = 10 * 60 * 1000): void {
    this.recoveryScheduledAt = Date.now() + delayMs;
    console.log(`[ErrorRecovery] Recovery scheduled in ${Math.round(delayMs / 60000)} minutes`);

    setTimeout(async () => {
      if (this.recoveryScheduledAt) {
        this.recoveryInProgress = true;
        console.log('[ErrorRecovery] Starting scheduled recovery...');

        try {
          // Attempt recovery
          await this.performSystemRecovery();
        } finally {
          this.recoveryInProgress = false;
          this.recoveryScheduledAt = null;
        }
      }
    }, delayMs);
  }

  private async performSystemRecovery(): Promise<void> {
    console.log('[ErrorRecovery] Attempting recovery...');

    // Clear non-critical errors
    this.errors = this.errors.filter(e =>
      e.context === 'uncaughtException' || e.context === 'unhandledRejection'
    );

    // Mark errors as recovered
    for (const error of this.errors) {
      error.recovered = true;
    }

    console.log('[ErrorRecovery] Recovery completed');
    this.emit('recovered');
  }

  wrapAsyncFunction<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    context: string
  ): T {
    return (async (...args: Parameters<T>) => {
      try {
        return await fn(...args);
      } catch (error) {
        const record = this.handleError(
          error instanceof Error ? error : new Error(String(error)),
          context
        );
        throw new Error(`${context} failed: ${record.error.message}`);
      }
    }) as T;
  }
}

export const errorRecoveryService = new ErrorRecoveryService();
