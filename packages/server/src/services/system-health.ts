import { EventEmitter } from 'events';
import { safetyBackupService, type ConfigSnapshot } from './safety-backup.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: number;
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: unknown;
  }[];
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  lastRecovery?: {
    timestamp: number;
    reason: string;
    snapshotId: string;
  };
}

export interface RecoveryOptions {
  maxConsecutiveFailures: number;
  healthCheckInterval: number;
  autoRecoveryEnabled: boolean;
  notifyOnRecovery: boolean;
}

type HealthCheckFn = () => Promise<{ status: 'pass' | 'warn' | 'fail'; message: string; details?: unknown }>;

export class SystemHealthMonitor extends EventEmitter {
  private healthChecks: Map<string, HealthCheckFn> = new Map();
  private consecutiveFailures: number = 0;
  private lastHealthyTime: number = Date.now();
  private startTime: number = Date.now();
  private monitorInterval: NodeJS.Timeout | null = null;
  private options: RecoveryOptions = {
    maxConsecutiveFailures: 3,
    healthCheckInterval: 60000,
    autoRecoveryEnabled: true,
    notifyOnRecovery: true,
  };
  private lastRecovery: HealthStatus['lastRecovery'] = undefined;
  private getDataFn: (() => Promise<ConfigSnapshot['data']>) | null = null;
  private restoreDataFn: ((data: ConfigSnapshot['data']) => Promise<void>) | null = null;

  constructor() {
    super();
  }

  registerHealthCheck(name: string, checkFn: HealthCheckFn): void {
    this.healthChecks.set(name, checkFn);
    console.log(`[HealthMonitor] Registered health check: ${name}`);
  }

  setGetDataFn(fn: () => Promise<ConfigSnapshot['data']>): void {
    this.getDataFn = fn;
  }

  setRestoreDataFn(fn: (data: ConfigSnapshot['data']) => Promise<void>): void {
    this.restoreDataFn = fn;
  }

  setOptions(options: Partial<RecoveryOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async runHealthChecks(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = [];
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';

    for (const [name, checkFn] of this.healthChecks) {
      try {
        const result = await Promise.race([
          checkFn(),
          new Promise<{ status: 'fail'; message: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          ),
        ]) as { status: 'pass' | 'warn' | 'fail'; message: string; details?: unknown };

        checks.push({
          name,
          status: result.status,
          message: result.message,
          details: result.details,
        });

        if (result.status === 'fail') {
          overallStatus = overallStatus === 'critical' ? 'critical' : 'degraded';
        } else if (result.status === 'warn' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      } catch (error) {
        checks.push({
          name,
          status: 'fail',
          message: `Health check failed: ${(error as Error).message}`,
        });
        overallStatus = 'degraded';
      }
    }

    const failedChecks = checks.filter(c => c.status === 'fail').length;
    if (failedChecks >= 2) {
      overallStatus = 'critical';
    }

    if (overallStatus === 'healthy') {
      this.consecutiveFailures = 0;
      this.lastHealthyTime = Date.now();
    } else {
      this.consecutiveFailures++;
    }

    return {
      status: overallStatus,
      timestamp: Date.now(),
      checks,
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage(),
      lastRecovery: this.lastRecovery,
    };
  }

  async checkAndRecover(): Promise<boolean> {
    const health = await this.runHealthChecks();

    if (health.status === 'critical') {
      console.error('[HealthMonitor] System is in critical state!');
      this.emit('critical', health);

      if (this.options.autoRecoveryEnabled && this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
        console.log('[HealthMonitor] Attempting automatic recovery...');
        return await this.attemptRecovery('Critical system state detected');
      }
    } else if (health.status === 'degraded') {
      console.warn('[HealthMonitor] System is degraded');
      this.emit('degraded', health);
    } else {
      this.emit('healthy', health);
    }

    return health.status === 'healthy';
  }

  private async attemptRecovery(reason: string): Promise<boolean> {
    try {
      if (!this.getDataFn || !this.restoreDataFn) {
        console.error('[HealthMonitor] Recovery functions not configured');
        return false;
      }

      console.log('[HealthMonitor] Creating pre-recovery backup...');
      const currentData = await this.getDataFn();
      await safetyBackupService.createSnapshot('pre-change', `恢复前备份: ${reason}`, currentData);

      console.log('[HealthMonitor] Finding last valid snapshot...');
      const lastValidSnapshot = await safetyBackupService.getLatestValidSnapshot();

      if (!lastValidSnapshot) {
        console.error('[HealthMonitor] No valid snapshot found for recovery');
        return false;
      }

      console.log(`[HealthMonitor] Restoring from snapshot: ${lastValidSnapshot.id}`);
      await this.restoreDataFn(lastValidSnapshot.data);

      this.lastRecovery = {
        timestamp: Date.now(),
        reason,
        snapshotId: lastValidSnapshot.id,
      };

      this.consecutiveFailures = 0;

      console.log('[HealthMonitor] Recovery completed successfully');
      this.emit('recovered', {
        reason,
        snapshotId: lastValidSnapshot.id,
        timestamp: this.lastRecovery.timestamp,
      });

      if (this.options.notifyOnRecovery) {
        this.notifyRecovery(reason, lastValidSnapshot.id);
      }

      return true;
    } catch (error) {
      console.error('[HealthMonitor] Recovery failed:', error);
      this.emit('recovery-failed', error);
      return false;
    }
  }

  private notifyRecovery(reason: string, snapshotId: string): void {
    console.log(`[HealthMonitor] Recovery notification: ${reason} (from ${snapshotId})`);
  }

  startMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    this.monitorInterval = setInterval(async () => {
      await this.checkAndRecover();
    }, this.options.healthCheckInterval);

    console.log(`[HealthMonitor] Started monitoring (interval: ${this.options.healthCheckInterval}ms)`);
  }

  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('[HealthMonitor] Stopped monitoring');
    }
  }

  getStats(): {
    consecutiveFailures: number;
    lastHealthyTime: number;
    uptime: number;
    lastRecovery?: HealthStatus['lastRecovery'];
  } {
    return {
      consecutiveFailures: this.consecutiveFailures,
      lastHealthyTime: this.lastHealthyTime,
      uptime: Date.now() - this.startTime,
      lastRecovery: this.lastRecovery,
    };
  }

  async manualRecovery(reason: string = 'Manual recovery requested'): Promise<boolean> {
    return this.attemptRecovery(reason);
  }
}

export const systemHealthMonitor = new SystemHealthMonitor();
