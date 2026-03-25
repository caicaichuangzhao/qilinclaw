import Bottleneck from 'bottleneck';
import type { SafetyConfig } from '../types/index.js';

interface RateLimitConfig {
  key: string;
  maxRequests: number;
  windowMs: number;
}

export class RateLimiter {
  private limiters: Map<string, Bottleneck> = new Map();
  private requestCounts: Map<string, number[]> = new Map();
  private config: SafetyConfig;

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

  createLimiter(key: string, options?: Partial<RateLimitConfig>): Bottleneck {
    if (this.limiters.has(key)) {
      return this.limiters.get(key)!;
    }

    const limiter = new Bottleneck({
      minTime: 1000 / (options?.maxRequests || this.config.maxRequestsPerMinute / 60),
      maxConcurrent: this.config.maxConcurrentOperations,
      reservoir: options?.maxRequests || this.config.maxRequestsPerMinute,
      reservoirRefreshAmount: options?.maxRequests || this.config.maxRequestsPerMinute,
      reservoirRefreshInterval: options?.windowMs || 60000,
    });

    this.limiters.set(key, limiter);
    return limiter;
  }

  async checkRateLimit(key: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const windowStart = now - 60000;

    if (!this.requestCounts.has(key)) {
      this.requestCounts.set(key, []);
    }

    const counts = this.requestCounts.get(key)!;
    const recentRequests = counts.filter(time => time > windowStart);
    this.requestCounts.set(key, recentRequests);

    const remaining = Math.max(0, this.config.maxRequestsPerMinute - recentRequests.length);
    const allowed = recentRequests.length < this.config.maxRequestsPerMinute;

    if (allowed) {
      recentRequests.push(now);
    }

    const oldestInWindow = recentRequests[0];
    const resetTime = oldestInWindow ? oldestInWindow + 60000 : now + 60000;

    return { allowed, remaining, resetTime };
  }

  async wrapFunction<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const limiter = this.createLimiter(key);
    return limiter.schedule(fn);
  }

  getLimiter(key: string): Bottleneck | undefined {
    return this.limiters.get(key);
  }

  removeLimiter(key: string): void {
    const limiter = this.limiters.get(key);
    if (limiter) {
      limiter.disconnect();
      this.limiters.delete(key);
    }
    this.requestCounts.delete(key);
  }

  getStatus(key: string): { queued: number; running: number; done: number } {
    const limiter = this.limiters.get(key);
    if (!limiter) {
      return { queued: 0, running: 0, done: 0 };
    }

    const counts = limiter.counts();
    return {
      queued: counts.QUEUED || 0,
      running: counts.RUNNING || 0,
      done: counts.EXECUTING || 0,
    };
  }

  clearAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.disconnect();
    }
    this.limiters.clear();
    this.requestCounts.clear();
  }
}

export const rateLimiter = new RateLimiter();
