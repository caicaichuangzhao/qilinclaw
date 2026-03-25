import Database from 'better-sqlite3';
// @ts-ignore — sqlite-vec has no type declarations
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs';

export interface DatabaseConfig {
  path: string;
  verbose?: boolean;
}

const DEFAULT_CONFIG: DatabaseConfig = {
  path: path.resolve(process.cwd(), '.qilin-claw', 'qilin-claw.db'),
  verbose: false,
};

export class DatabaseManager {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;

  private constructor(config: Partial<DatabaseConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static async create(config: Partial<DatabaseConfig> = {}): Promise<DatabaseManager> {
    const manager = new DatabaseManager(config);
    await manager.initializeDatabase();
    return manager;
  }

  private async initializeDatabase(): Promise<void> {
    const dbDir = path.dirname(this.config.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.config.path);
    sqliteVec.load(this.db);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    this.createTables();
  }

  private createTables(): void {
    this.db!.exec(`
      -- Agent记忆配置表
      CREATE TABLE IF NOT EXISTS agent_memory_configs (
        agent_id TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        heartbeat_interval_ms INTEGER DEFAULT 3600000,
        auto_extract INTEGER DEFAULT 1,
        last_heartbeat INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Agent记忆文件表
      CREATE TABLE IF NOT EXISTS agent_memory_files (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        embedding_status TEXT DEFAULT 'pending',
        embedding_error TEXT,
        embedding_updated_at INTEGER,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_memory_files_agent_id ON agent_memory_files(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_files_type ON agent_memory_files(type);

      -- 知识库表
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 知识库文档表
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        knowledge_base_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        content TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT,
        tags TEXT,
        embedding_status TEXT DEFAULT 'pending',
        embedding_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb_id ON knowledge_documents(knowledge_base_id);

      -- 文档分块表
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        start_index INTEGER NOT NULL,
        end_index INTEGER NOT NULL,
        page_number INTEGER,
        section TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id ON document_chunks(document_id);

      -- 对话向量存储表
      CREATE TABLE IF NOT EXISTS vector_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB,
        role TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        conversation_id TEXT NOT NULL,
        token_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_vector_entries_conv_id ON vector_entries(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_vector_entries_timestamp ON vector_entries(timestamp);

      -- 对话摘要表
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding BLOB,
        message_count INTEGER NOT NULL,
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conv_summaries_conv_id ON conversation_summaries(conversation_id);

      -- 对话元数据表
      CREATE TABLE IF NOT EXISTS conversation_metas (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_conv_metas_updated_at ON conversation_metas(updated_at);

      -- Offices
      CREATE TABLE IF NOT EXISTS offices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        leader_id TEXT,
        current_task TEXT,
        agent_configs TEXT,
        agent_roles TEXT,
        bot_channels TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Office Agents Map
      CREATE TABLE IF NOT EXISTS office_agents (
        office_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        PRIMARY KEY (office_id, agent_id),
        FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE CASCADE
      );

      -- Office Messages Table
      CREATE TABLE IF NOT EXISTS office_messages (
        id TEXT PRIMARY KEY,
        office_id TEXT NOT NULL,
        agent_id TEXT, -- NULL if user
        role TEXT NOT NULL, -- user / assistant / system
        content TEXT NOT NULL,
        attachments TEXT, -- JSON string of attachments
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_office_messages_office_id ON office_messages(office_id);
      CREATE INDEX IF NOT EXISTS idx_office_messages_timestamp ON office_messages(timestamp);
      -- Users Table for Local Authentication
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar_url TEXT,
        created_at INTEGER NOT NULL,
        last_login INTEGER NOT NULL
      );
    `);

    // Incremental migrations: add new columns to existing databases
    const officeColumns = this.db!.prepare("PRAGMA table_info(offices)").all() as any[];
    const officeColNames = officeColumns.map(c => c.name);
    if (!officeColNames.includes('leader_id')) {
      this.db!.exec('ALTER TABLE offices ADD COLUMN leader_id TEXT');
    }
    if (!officeColNames.includes('current_task')) {
      this.db!.exec('ALTER TABLE offices ADD COLUMN current_task TEXT');
    }
    if (!officeColNames.includes('agent_configs')) {
      this.db!.exec('ALTER TABLE offices ADD COLUMN agent_configs TEXT');
    }
    if (!officeColNames.includes('agent_roles')) {
      this.db!.exec('ALTER TABLE offices ADD COLUMN agent_roles TEXT');
    }
    if (!officeColNames.includes('bot_channels')) {
      this.db!.exec('ALTER TABLE offices ADD COLUMN bot_channels TEXT');
    }

    // Add file_data column to knowledge_documents if not exists
    const kdColumns = this.db!.prepare("PRAGMA table_info(knowledge_documents)").all() as any[];
    const kdColNames = kdColumns.map((c: any) => c.name);
    if (!kdColNames.includes('file_data')) {
      this.db!.exec('ALTER TABLE knowledge_documents ADD COLUMN file_data BLOB');
    }

    // Create vec0 virtual tables for native vector search
    // These must be created separately as they use a different SQL engine
    try {
      this.db!.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_agent_memory USING vec0(embedding float[1024])`);
      this.db!.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_document_chunks USING vec0(embedding float[1024])`);
      this.db!.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_conversation_summaries USING vec0(embedding float[1024])`);
    } catch (err) {
      console.warn('[Database] vec0 tables creation issue:', (err as Error).message);
    }

    if (this.config.verbose) {
      console.log('[Database] Tables created successfully');
    }
  }

  getDatabase(): Database.Database | null {
    return this.db;
  }

  save(): void {
    // better-sqlite3 auto-saves to disk; no manual save needed.
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  run(sql: string, params: any[] = []): Database.RunResult {
    const stmt = this.db!.prepare(sql);
    return stmt.run(...params);
  }

  all(sql: string, params: any[] = []): any[] {
    const stmt = this.db!.prepare(sql);
    return stmt.all(...params);
  }

  get(sql: string, params: any[] = []): any | undefined {
    const stmt = this.db!.prepare(sql);
    return stmt.get(...params);
  }

  transaction<T>(callback: () => T): T {
    const tx = this.db!.transaction(callback);
    return tx();
  }
}

let dbManagerInstance: DatabaseManager | null = null;

export async function getDatabaseManager(): Promise<DatabaseManager> {
  if (!dbManagerInstance) {
    dbManagerInstance = await DatabaseManager.create();
  }
  return dbManagerInstance;
}

export function closeDatabase(): void {
  if (dbManagerInstance) {
    dbManagerInstance.close();
    dbManagerInstance = null;
  }
}
