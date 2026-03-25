import type { SafetyConfig } from '../types/index.js';
import { logger } from './logger.js';

export interface HealthStatus {
  healthy: boolean;
  lastCheck: number;
  issues: string[];
  recovered: boolean;
  recoveryAttempts: number;
}

export class HealthCheckService {
  private config: SafetyConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private status: HealthStatus = {
    healthy: true,
    lastCheck: Date.now(),
    issues: [],
    recovered: false,
    recoveryAttempts: 0,
  };
  private onRecoveryCallback?: () => Promise<void>;

  constructor(config: Partial<SafetyConfig> = {}) {
    this.config = {
      maxRequestsPerMinute: config.maxRequestsPerMinute || 60,
      maxRequestsPerHour: config.maxRequestsPerHour || 1000,
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024,
      maxConcurrentOperations: config.maxConcurrentOperations || 5,
      enableAutoBackup: config.enableAutoBackup ?? true,
      maxBackupsPerFile: config.maxBackupsPerFile || 10,
      autoRecoveryEnabled: config.autoRecoveryEnabled ?? true,
      healthCheckInterval: config.healthCheckInterval || 30000,
      recoveryDelay: config.recoveryDelay || 600000,
      enableProxy: config.enableProxy ?? false,
      proxyUrl: config.proxyUrl || 'http://127.0.0.1:7890',
    };
  }

  updateConfig(config: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.config.autoRecoveryEnabled && !this.checkInterval) {
      this.start();
    } else if (!this.config.autoRecoveryEnabled && this.checkInterval) {
      this.stop();
    }
  }

  start(): void {
    if (this.checkInterval) return;

    logger.info('[HealthCheck]', `Starting health check service (interval: ${this.config.healthCheckInterval}ms)`);
    this.checkInterval = setInterval(() => {
      this.performCheck();
    }, this.config.healthCheckInterval);

    this.performCheck();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('[HealthCheck]', 'Health check service stopped');
    }
  }

  private async performCheck(): Promise<void> {
    const issues: string[] = [];

    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
      const memoryUsagePercent = (heapUsedMB / heapTotalMB) * 100;

      if (memoryUsagePercent > 90) {
        issues.push(`内存使用率过高: ${memoryUsagePercent.toFixed(1)}%`);
      }

      if (heapUsedMB > 1500) {
        issues.push(`堆内存使用过高: ${heapUsedMB.toFixed(0)}MB`);
      }

      const os = require('os');
      const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];
      if (loadAvg[0] > 4) {
        issues.push(`系统负载过高: ${loadAvg[0].toFixed(2)}`);
      }

      if (global.gc) {
        const beforeGC = memUsage.heapUsed;
        global.gc();
        const afterGC = process.memoryUsage().heapUsed;
        const freed = (beforeGC - afterGC) / 1024 / 1024;
        if (freed > 10) {
          logger.debug('[HealthCheck]', `GC freed ${freed.toFixed(0)}MB`);
        }
      }

    } catch (error) {
      issues.push(`健康检查错误: ${(error as Error).message}`);
    }

    const wasHealthy = this.status.healthy;
    this.status = {
      healthy: issues.length === 0,
      lastCheck: Date.now(),
      issues,
      recovered: false,
      recoveryAttempts: this.status.recoveryAttempts,
    };

    if (!this.status.healthy && this.config.autoRecoveryEnabled) {
      await this.attemptRecovery();
    }

    if (!wasHealthy && this.status.healthy) {
      this.status.recovered = true;
      logger.info('[HealthCheck]', 'System recovered');
    }

    if (issues.length > 0) {
      logger.warn('[HealthCheck]', 'Issues detected:', issues);
    }
  }

  private async attemptRecovery(): Promise<void> {
    this.status.recoveryAttempts++;
    console.log(`[HealthCheck] Attempting recovery (attempt #${this.status.recoveryAttempts})`);

    try {
      if (global.gc) {
        global.gc();
        console.log('[HealthCheck] Forced garbage collection');
      }

      if (this.onRecoveryCallback) {
        await this.onRecoveryCallback();
      }

    } catch (error) {
      logger.error('[HealthCheck]', 'Recovery failed:', error);
    }
  }

  onRecovery(callback: () => Promise<void>): void {
    this.onRecoveryCallback = callback;
  }

  getStatus(): HealthStatus {
    return { ...this.status };
  }

  forceCheck(): Promise<HealthStatus> {
    return new Promise((resolve) => {
      this.performCheck().then(() => {
        resolve(this.getStatus());
      });
    });
  }
}

export const healthCheckService = new HealthCheckService();
