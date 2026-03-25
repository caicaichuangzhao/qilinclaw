type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogConfig {
  level: LogLevel;
  includeTimestamp: boolean;
  includePrefix: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private config: LogConfig = {
    level: 'info',
    includeTimestamp: true,
    includePrefix: true,
  };

  private prefixes: Record<string, string> = {
    SystemSafety: '[SystemSafety]',
    SmartMemory: '[SmartMemory]',
    AgentMemory: '[AgentMemory]',
    UsageTracker: '[UsageTracker]',
    HealthCheck: '[HealthCheck]',
    Feishu: '[Feishu]',
    Bot: '[Bot]',
    LLM: '[LLM]',
    MCP: '[MCP]',
    Skill: '[Skill]',
    VectorStore: '[VectorStore]',
    Knowledge: '[Knowledge]',
    Diagnostic: '[Diagnostic]',
    ErrorRecovery: '[ErrorRecovery]',
  };

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  private formatMessage(prefix: string, ...args: unknown[]): unknown[] {
    const parts: unknown[] = [];
    
    if (this.config.includeTimestamp) {
      parts.push(new Date().toISOString());
    }
    
    if (this.config.includePrefix && prefix) {
      parts.push(prefix);
    }
    
    return [...parts, ...args];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  debug(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(...this.formatMessage(prefix, ...args));
    }
  }

  info(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(...this.formatMessage(prefix, ...args));
    }
  }

  warn(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage(prefix, ...args));
    }
  }

  error(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(...this.formatMessage(prefix, ...args));
    }
  }

  log(prefix: string, ...args: unknown[]): void {
    this.info(prefix, ...args);
  }

  getPrefix(name: string): string {
    return this.prefixes[name] || `[${name}]`;
  }
}

export const logger = new Logger();
export type { LogLevel };
