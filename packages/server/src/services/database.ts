import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import type { LLMConfig, BotConfig, SafetyConfig } from '../types/index.js';

export class DatabaseService {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = '.qilin-claw/claw.db') {
    this.dbPath = path.resolve(process.cwd(), dbPath);
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS llm_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        base_url TEXT,
        model TEXT NOT NULL,
        max_tokens INTEGER DEFAULT 4096,
        temperature REAL DEFAULT 0.7,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS bot_configs (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        config TEXT NOT NULL,
        llm_config_id TEXT,
        agent_id TEXT,
        system_prompt TEXT,
        allowed_channels TEXT,
        allowed_users TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS safety_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        max_requests_per_minute INTEGER DEFAULT 60,
        max_requests_per_hour INTEGER DEFAULT 1000,
        max_file_size INTEGER DEFAULT 10485760,
        max_concurrent_operations INTEGER DEFAULT 5,
        enable_auto_backup INTEGER DEFAULT 1,
        max_backups_per_file INTEGER DEFAULT 10,
        auto_recovery_enabled INTEGER DEFAULT 1,
        health_check_interval INTEGER DEFAULT 30000,
        recovery_delay INTEGER DEFAULT 600000,
        enable_proxy INTEGER DEFAULT 0,
        proxy_url TEXT DEFAULT 'http://127.0.0.1:7890'
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT,
        messages TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_conversations_platform_channel 
        ON conversations(platform, channel_id)
    `);

    const result = this.db.exec('SELECT 1 FROM safety_config WHERE id = 1');
    if (result.length === 0) {
      this.db.run(`INSERT INTO safety_config (id) VALUES (1)`);
    }

    // Migration: Add agent_id column if not exists
    try {
      this.db.run(`ALTER TABLE bot_configs ADD COLUMN agent_id TEXT`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: Add recovery_delay column to safety_config
    try {
      this.db.run(`ALTER TABLE safety_config ADD COLUMN recovery_delay INTEGER DEFAULT 600000`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: Add proxy columns to safety_config
    try {
      this.db.run(`ALTER TABLE safety_config ADD COLUMN enable_proxy INTEGER DEFAULT 0`);
      this.db.run(`ALTER TABLE safety_config ADD COLUMN proxy_url TEXT DEFAULT 'http://127.0.0.1:7890'`);
    } catch {
      // Columns already exist, ignore
    }

    this.save();
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  saveLLMConfig(config: LLMConfig): void {
    if (!this.db) return;

    this.db.run(`
      INSERT OR REPLACE INTO llm_configs 
      (id, name, provider, api_key, base_url, model, max_tokens, temperature, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `, [
      config.id,
      config.name,
      config.provider,
      config.apiKey || '',
      config.baseUrl || null,
      config.model,
      config.maxTokens || 4096,
      config.temperature || 0.7,
      config.enabled ? 1 : 0
    ]);

    this.save();
  }

  getLLMConfig(id: string): LLMConfig | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM llm_configs WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToLLMConfig(result[0], 0);
  }

  getAllLLMConfigs(): LLMConfig[] {
    if (!this.db) return [];

    const result = this.db.exec('SELECT * FROM llm_configs ORDER BY created_at DESC');
    if (result.length === 0) return [];

    return result[0].values.map((_, index) => this.rowToLLMConfig(result[0], index));
  }

  deleteLLMConfig(id: string): void {
    if (!this.db) return;
    this.db.run('DELETE FROM llm_configs WHERE id = ?', [id]);
    this.save();
  }

  private rowToLLMConfig(result: { columns: string[]; values: unknown[][] }, index: number): LLMConfig {
    const row = result.values[index];
    const cols = result.columns;
    const get = (name: string) => row[cols.indexOf(name)];

    return {
      id: get('id') as string,
      name: get('name') as string,
      provider: get('provider') as LLMConfig['provider'],
      apiKey: get('api_key') as string,
      baseUrl: get('base_url') as string | undefined,
      model: get('model') as string,
      maxTokens: get('max_tokens') as number,
      temperature: get('temperature') as number,
      enabled: get('enabled') === 1,
    };
  }

  saveBotConfig(config: BotConfig): void {
    if (!this.db) return;

    this.db.run(`
      INSERT OR REPLACE INTO bot_configs 
      (id, platform, name, enabled, config, llm_config_id, agent_id, system_prompt, allowed_channels, allowed_users, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `, [
      config.id,
      config.platform,
      config.name,
      config.enabled ? 1 : 0,
      JSON.stringify(config.config),
      config.llmConfigId || null,
      config.agentId || null,
      config.systemPrompt || null,
      config.allowedChannels ? JSON.stringify(config.allowedChannels) : null,
      config.allowedUsers ? JSON.stringify(config.allowedUsers) : null
    ]);

    this.save();
  }

  getBotConfig(id: string): BotConfig | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM bot_configs WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToBotConfig(result[0], 0);
  }

  getAllBotConfigs(): BotConfig[] {
    if (!this.db) return [];

    const result = this.db.exec('SELECT * FROM bot_configs ORDER BY created_at DESC');
    console.log(`[Database] Found ${result.length > 0 ? result[0].values.length : 0} bots in database`);
    if (result.length === 0) return [];

    return result[0].values.map((_, index) => this.rowToBotConfig(result[0], index));
  }

  deleteBotConfig(id: string): void {
    if (!this.db) return;
    this.db.run('DELETE FROM bot_configs WHERE id = ?', [id]);
    this.save();
  }

  private rowToBotConfig(result: { columns: string[]; values: unknown[][] }, index: number): BotConfig {
    const row = result.values[index];
    const cols = result.columns;
    const get = (name: string) => row[cols.indexOf(name)];

    return {
      id: get('id') as string,
      platform: get('platform') as BotConfig['platform'],
      name: get('name') as string,
      enabled: get('enabled') === 1,
      config: JSON.parse(get('config') as string),
      llmConfigId: get('llm_config_id') as string,
      agentId: get('agent_id') as string | undefined,
      systemPrompt: get('system_prompt') as string | undefined,
      allowedChannels: get('allowed_channels') ? JSON.parse(get('allowed_channels') as string) : undefined,
      allowedUsers: get('allowed_users') ? JSON.parse(get('allowed_users') as string) : undefined,
    };
  }

  getSafetyConfig(): SafetyConfig {
    if (!this.db) {
      return this.getDefaultSafetyConfig();
    }

    const result = this.db.exec('SELECT * FROM safety_config WHERE id = 1');
    if (result.length === 0 || result[0].values.length === 0) {
      return this.getDefaultSafetyConfig();
    }

    const row = result[0].values[0];
    const cols = result[0].columns;
    const get = (name: string) => row[cols.indexOf(name)];

    return {
      maxRequestsPerMinute: get('max_requests_per_minute') as number,
      maxRequestsPerHour: get('max_requests_per_hour') as number,
      maxFileSize: get('max_file_size') as number,
      maxConcurrentOperations: get('max_concurrent_operations') as number,
      enableAutoBackup: get('enable_auto_backup') === 1,
      maxBackupsPerFile: get('max_backups_per_file') as number,
      autoRecoveryEnabled: get('auto_recovery_enabled') === 1,
      healthCheckInterval: get('health_check_interval') as number,
      recoveryDelay: (get('recovery_delay') as number) || 10 * 60 * 1000,
      enableProxy: get('enable_proxy') === 1,
      proxyUrl: get('proxy_url') as string || 'http://127.0.0.1:7890',
    };
  }

  updateSafetyConfig(config: Partial<SafetyConfig>): void {
    if (!this.db) return;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (config.maxRequestsPerMinute !== undefined) {
      updates.push('max_requests_per_minute = ?');
      values.push(config.maxRequestsPerMinute);
    }
    if (config.maxRequestsPerHour !== undefined) {
      updates.push('max_requests_per_hour = ?');
      values.push(config.maxRequestsPerHour);
    }
    if (config.maxFileSize !== undefined) {
      updates.push('max_file_size = ?');
      values.push(config.maxFileSize);
    }
    if (config.maxConcurrentOperations !== undefined) {
      updates.push('max_concurrent_operations = ?');
      values.push(config.maxConcurrentOperations);
    }
    if (config.enableAutoBackup !== undefined) {
      updates.push('enable_auto_backup = ?');
      values.push(config.enableAutoBackup ? 1 : 0);
    }
    if (config.maxBackupsPerFile !== undefined) {
      updates.push('max_backups_per_file = ?');
      values.push(config.maxBackupsPerFile);
    }
    if (config.autoRecoveryEnabled !== undefined) {
      updates.push('auto_recovery_enabled = ?');
      values.push(config.autoRecoveryEnabled ? 1 : 0);
    }
    if (config.healthCheckInterval !== undefined) {
      updates.push('health_check_interval = ?');
      values.push(config.healthCheckInterval);
    }
    if (config.recoveryDelay !== undefined) {
      updates.push('recovery_delay = ?');
      values.push(config.recoveryDelay);
    }
    if (config.enableProxy !== undefined) {
      updates.push('enable_proxy = ?');
      values.push(config.enableProxy ? 1 : 0);
    }
    if (config.proxyUrl !== undefined) {
      updates.push('proxy_url = ?');
      values.push(config.proxyUrl);
    }

    if (updates.length > 0) {
      this.db.run(`UPDATE safety_config SET ${updates.join(', ')} WHERE id = 1`, values as any[]);
      this.save();
    }
  }

  private getDefaultSafetyConfig(): SafetyConfig {
    return {
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
      maxFileSize: 10 * 1024 * 1024,
      maxConcurrentOperations: 5,
      enableAutoBackup: true,
      maxBackupsPerFile: 10,
      autoRecoveryEnabled: true,
      healthCheckInterval: 60000, // 1分钟
      recoveryDelay: 10 * 60 * 1000, // 10分钟
      enableProxy: false,
      proxyUrl: 'http://127.0.0.1:7890',
    };
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}

export const databaseService = new DatabaseService();
