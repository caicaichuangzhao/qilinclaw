import { DatabaseManager, getDatabaseManager } from '../config/database';
import { embeddingService } from './embedding-service.js';
import { vectorStore } from './vector-store.js';

export interface MemoryFile {
  id: string;
  agentId: string;
  filename: string;
  content: string;
  embedding?: number[];
  embeddingStatus?: 'success' | 'failed' | 'pending';
  embeddingError?: string;
  embeddingUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
  size: number;
  type: 'knowledge' | 'conversation' | 'preference' | 'custom';
}

export interface AgentMemoryConfig {
  agentId: string;
  enabled: boolean;
  heartbeatIntervalMs: number;
  autoExtract: boolean;
  lastHeartbeat?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMemoryStats {
  agentId: string;
  files: MemoryFileInfo[];
  totalSize: number;
  lastHeartbeat?: number;
  config: AgentMemoryConfig;
}

export interface MemoryFileInfo {
  id: string;
  filename: string;
  size: number;
  type: string;
  embeddingStatus?: 'success' | 'failed' | 'pending';
  embeddingError?: string;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_CONFIG: Omit<AgentMemoryConfig, 'agentId' | 'createdAt' | 'updatedAt'> = {
  enabled: true,
  heartbeatIntervalMs: 60 * 60 * 1000,
  autoExtract: true,
};

export class AgentMemoryManager {
  private db: DatabaseManager | null = null;
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private initialized: boolean = false;

  constructor() { }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.db = await getDatabaseManager();
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private serializeEmbedding(embedding: number[]): Buffer {
    const floatArray = new Float32Array(embedding);
    return Buffer.from(floatArray.buffer);
  }

  private deserializeEmbedding(data: Buffer | null): number[] | undefined {
    if (!data) return undefined;
    const floatArray = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    return Array.from(floatArray);
  }

  initAgent(agentId: string, customConfig?: Partial<AgentMemoryConfig>): AgentMemoryConfig {
    throw new Error('Use async initAgentAsync instead');
  }

  async initAgentAsync(agentId: string, customConfig?: Partial<AgentMemoryConfig>): Promise<AgentMemoryConfig> {
    await this.ensureInitialized();
    const existing = await this.getAgentConfigAsync(agentId);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const config: AgentMemoryConfig = {
      ...DEFAULT_CONFIG,
      agentId,
      createdAt: now,
      updatedAt: now,
      ...customConfig,
    };

    this.db!.run(
      `INSERT OR REPLACE INTO agent_memory_configs 
       (agent_id, enabled, heartbeat_interval_ms, auto_extract, last_heartbeat, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        agentId,
        config.enabled ? 1 : 0,
        config.heartbeatIntervalMs,
        config.autoExtract ? 1 : 0,
        config.lastHeartbeat || null,
        config.createdAt,
        config.updatedAt
      ]
    );

    this.db!.save();
    console.log(`[AgentMemory] Initialized agent: ${agentId}`);
    return config;
  }

  getAgentConfig(agentId: string): AgentMemoryConfig | undefined {
    throw new Error('Use async getAgentConfigAsync instead');
  }

  async getAgentConfigAsync(agentId: string): Promise<AgentMemoryConfig | undefined> {
    await this.ensureInitialized();
    const result = this.db!.get(
      'SELECT * FROM agent_memory_configs WHERE agent_id = ?',
      [agentId]
    );

    if (!result) return undefined;

    return {
      agentId: result.agent_id,
      enabled: result.enabled === 1,
      heartbeatIntervalMs: result.heartbeat_interval_ms,
      autoExtract: result.auto_extract === 1,
      lastHeartbeat: result.last_heartbeat || undefined,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  }

  updateAgentConfig(agentId: string, updates: Partial<AgentMemoryConfig>): AgentMemoryConfig | undefined {
    throw new Error('Use async updateAgentConfigAsync instead');
  }

  async updateAgentConfigAsync(agentId: string, updates: Partial<AgentMemoryConfig>): Promise<AgentMemoryConfig | undefined> {
    await this.ensureInitialized();
    const config = await this.getAgentConfigAsync(agentId);
    if (!config) return undefined;

    const oldInterval = config.heartbeatIntervalMs;
    Object.assign(config, updates, { updatedAt: Date.now() });

    this.db!.run(
      `UPDATE agent_memory_configs 
       SET enabled = ?, heartbeat_interval_ms = ?, auto_extract = ?, last_heartbeat = ?, updated_at = ?
       WHERE agent_id = ?`,
      [
        config.enabled ? 1 : 0,
        config.heartbeatIntervalMs,
        config.autoExtract ? 1 : 0,
        config.lastHeartbeat || null,
        config.updatedAt,
        agentId
      ]
    );

    this.db!.save();

    if (updates.heartbeatIntervalMs && updates.heartbeatIntervalMs !== oldInterval) {
      if (this.heartbeatIntervals.has(agentId)) {
        this.stopHeartbeat(agentId);
        this.startHeartbeat(agentId);
      }
    }

    return config;
  }

  createMemoryFile(agentId: string, filename: string, content: string, type: MemoryFile['type'] = 'custom'): MemoryFile {
    throw new Error('Use async createMemoryFileAsync instead');
  }

  async createMemoryFileAsync(agentId: string, filename: string, content: string, type: MemoryFile['type'] = 'custom'): Promise<MemoryFile> {
    await this.ensureInitialized();
    await this.initAgentAsync(agentId);

    const now = Date.now();
    const fileId = `${agentId}-${filename}`;
    const memoryFile: MemoryFile = {
      id: fileId,
      agentId,
      filename,
      content,
      size: Buffer.byteLength(content, 'utf-8'),
      type,
      createdAt: now,
      updatedAt: now,
      embeddingStatus: 'pending',
    };

    this.db!.run(
      `INSERT OR REPLACE INTO agent_memory_files 
       (id, agent_id, filename, content, embedding_status, embedding_error, embedding_updated_at, size, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileId,
        agentId,
        filename,
        content,
        'pending',
        null,
        null,
        memoryFile.size,
        type,
        now,
        now
      ]
    );

    this.db!.save();
    console.log(`[AgentMemory] Created memory file: ${filename} for agent ${agentId}`);
    return memoryFile;
  }

  updateMemoryFile(fileId: string, content: string): MemoryFile | undefined {
    throw new Error('Use async updateMemoryFileAsync instead');
  }

  async updateMemoryFileAsync(fileId: string, content: string): Promise<MemoryFile | undefined> {
    await this.ensureInitialized();
    const file = await this.getMemoryFileAsync(fileId);
    if (!file) return undefined;

    const now = Date.now();
    file.content = content;
    file.size = Buffer.byteLength(content, 'utf-8');
    file.updatedAt = now;
    file.embedding = undefined;
    file.embeddingStatus = 'pending';
    file.embeddingError = undefined;
    file.embeddingUpdatedAt = undefined;

    this.db!.transaction(() => {
      this.db!.run(
        `UPDATE agent_memory_files 
         SET content = ?, embedding_status = ?, embedding_error = ?, embedding_updated_at = ?, size = ?, updated_at = ?
         WHERE id = ?`,
        [
          content,
          'pending',
          null,
          null,
          file.size,
          now,
          fileId
        ]
      );
    });

    this.db!.save();
    console.log(`[AgentMemory] Updated memory file: ${file.filename}`);
    return file;
  }

  deleteMemoryFile(fileId: string): boolean {
    throw new Error('Use async deleteMemoryFileAsync instead');
  }

  async deleteMemoryFileAsync(fileId: string): Promise<boolean> {
    await this.ensureInitialized();
    const file = await this.getMemoryFileAsync(fileId);
    if (!file) return false;

    this.db!.transaction(() => {
      this.db!.run('DELETE FROM agent_memory_files WHERE id = ?', [fileId]);
    });
    console.log(`[AgentMemory] Deleted memory file: ${file.filename}`);
    return true;
  }

  getMemoryFile(fileId: string): MemoryFile | undefined {
    throw new Error('Use async getMemoryFileAsync instead');
  }

  async getMemoryFileAsync(fileId: string): Promise<MemoryFile | undefined> {
    await this.ensureInitialized();
    const result = this.db!.get(
      'SELECT * FROM agent_memory_files WHERE id = ?',
      [fileId]
    );

    if (!result) return undefined;

    return {
      id: result.id,
      agentId: result.agent_id,
      filename: result.filename,
      content: result.content,
      embedding: undefined, // Embedded vector not fetched here
      embeddingStatus: result.embedding_status as any,
      embeddingError: result.embedding_error || undefined,
      embeddingUpdatedAt: result.embedding_updated_at || undefined,
      size: result.size,
      type: result.type as any,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  }

  getAgentMemoryFiles(agentId: string): MemoryFile[] {
    throw new Error('Use async getAgentMemoryFilesAsync instead');
  }

  async getAgentMemoryFilesAsync(agentId: string): Promise<MemoryFile[]> {
    await this.ensureInitialized();
    const results = this.db!.all(
      'SELECT * FROM agent_memory_files WHERE agent_id = ?',
      [agentId]
    );

    return results.map(result => ({
      id: result.id,
      agentId: result.agent_id,
      filename: result.filename,
      content: result.content,
      embedding: undefined,
      embeddingStatus: result.embedding_status as any,
      embeddingError: result.embedding_error || undefined,
      embeddingUpdatedAt: result.embedding_updated_at || undefined,
      size: result.size,
      type: result.type as any,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    }));
  }

  async getEmbeddingForFile(fileId: string, forceRegenerate: boolean = false): Promise<number[] | undefined> {
    const file = await this.getMemoryFileAsync(fileId);
    if (!file) {
      console.error(`[AgentMemory] File not found: ${fileId}`);
      return undefined;
    }

    if (!forceRegenerate && file.embedding && file.embeddingStatus === 'success') {
      return file.embedding;
    }

    file.embeddingStatus = 'pending';
    file.embeddingError = undefined;

    this.db!.run(
      'UPDATE agent_memory_files SET embedding_status = ?, embedding_error = ? WHERE id = ?',
      ['pending', null, fileId]
    );

    try {
      console.log(`[AgentMemory] Generating embedding for ${file.filename}...`);
      const result = await embeddingService.generateEmbedding(file.content);

      file.embedding = result.embedding;
      file.embeddingStatus = 'success';
      file.embeddingError = undefined;
      file.embeddingUpdatedAt = Date.now();

      this.db!.transaction(() => {
        this.db!.run(
          `UPDATE agent_memory_files 
           SET embedding = ?, embedding_status = ?, embedding_error = ?, embedding_updated_at = ?
           WHERE id = ?`,
          [this.serializeEmbedding(result.embedding), 'success', null, Date.now(), fileId]
        );

        // Also insert into vec0 virtual table for native vector search
        try {
          this.db!.run(
            `INSERT OR REPLACE INTO vec_agent_memory (rowid, embedding)
             VALUES ((SELECT rowid FROM agent_memory_files WHERE id = ?), ?)`,
            [fileId, this.serializeEmbedding(result.embedding)]
          );
        } catch (e) {
          console.warn('[AgentMemory] Failed to insert into vec_agent_memory:', e);
        }
      });

      this.db!.save();
      console.log(`[AgentMemory] Embedding generated successfully for ${file.filename}`);
      return result.embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AgentMemory] Failed to generate embedding for ${file.filename}:`, errorMessage);

      file.embedding = undefined;
      file.embeddingStatus = 'failed';
      file.embeddingError = errorMessage;

      this.db!.run(
        'UPDATE agent_memory_files SET embedding_status = ?, embedding_error = ? WHERE id = ?',
        ['failed', errorMessage, fileId]
      );

      this.db!.save();
      return undefined;
    }
  }

  async regenerateEmbedding(fileId: string): Promise<boolean> {
    const file = await this.getMemoryFileAsync(fileId);
    if (!file) {
      console.error(`[AgentMemory] File not found: ${fileId}`);
      return false;
    }

    console.log(`[AgentMemory] Regenerating embedding for ${file.filename}...`);
    const embedding = await this.getEmbeddingForFile(fileId, true);
    return embedding !== undefined;
  }

  async regenerateAllEmbeddings(agentId: string): Promise<{ success: number; failed: number }> {
    const files = await this.getAgentMemoryFilesAsync(agentId);
    let success = 0;
    let failed = 0;

    console.log(`[AgentMemory] Regenerating embeddings for ${files.length} files of agent ${agentId}...`);

    for (const file of files) {
      const result = await this.regenerateEmbedding(file.id);
      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    console.log(`[AgentMemory] Embedding regeneration complete: ${success} success, ${failed} failed`);
    return { success, failed };
  }

  async getContextForAgent(agentId: string, query: string, maxTokens: number = 2000): Promise<string> {
    const files = await this.getAgentMemoryFilesAsync(agentId);
    if (files.length === 0) return '';

    try {
      console.log(`[AgentMemory] Getting context for agent ${agentId} with query: "${query.substring(0, 50)}..." (${files.length} memory files)`);

      // ── Tier 1: If all files fit within token budget, include everything directly ──
      // This is the most common case for agent memory (few small files + KB docs)
      const allContent: Array<{ filename: string; content: string; tokens: number }> = [];
      let totalTokens = 0;

      for (const file of files) {
        if (!file.content) continue;
        const tokens = Math.ceil(file.content.length / 4);
        allContent.push({ filename: file.filename, content: file.content, tokens });
        totalTokens += tokens;
      }

      if (totalTokens <= maxTokens) {
        // Everything fits — include all files directly (no semantic search needed)
        let context = '';
        for (const item of allContent) {
          context += `\n--- ${item.filename} ---\n${item.content}\n`;
        }
        console.log(`[AgentMemory] Direct inclusion: all ${allContent.length} files (${totalTokens} tokens) fit within ${maxTokens} budget`);
        return context.trim();
      }

      // ── Tier 2: Too much content — use embedding search to prioritize ──
      console.log(`[AgentMemory] Content (${totalTokens} tokens) exceeds budget (${maxTokens}), using embedding-ranked selection`);

      let embeddingRankedContext = '';

      try {
        const queryResult = await embeddingService.generateEmbedding(query);
        const queryEmbedding = queryResult.embedding;

        // Try native vec_distance_cosine first
        try {
          const serializedQuery = this.serializeEmbedding(queryEmbedding);
          const searchResults = this.db!.all(`
            SELECT am.filename, am.content, vec_distance_cosine(v.embedding, ?) as score
            FROM vec_agent_memory v
            JOIN agent_memory_files am ON v.rowid = am.rowid
            WHERE am.agent_id = ?
            ORDER BY score ASC
            LIMIT 10
          `, [serializedQuery, agentId]);

          let currentTokens = 0;
          for (const row of searchResults) {
            const similarity = 1 - row.score;
            if (similarity < 0.15) continue; // Lowered threshold for better recall

            const tokens = Math.ceil(row.content.length / 4);
            if (currentTokens + tokens > maxTokens) break;

            embeddingRankedContext += `\n--- ${row.filename} ---\n${row.content}\n`;
            currentTokens += tokens;
          }

          if (currentTokens > 0) {
            console.log(`[AgentMemory] Embedding-ranked context (native vec): ${currentTokens} tokens`);
          }
        } catch (vecError) {
          console.warn('[AgentMemory] vec_distance_cosine failed, falling back to JS:', vecError);
        }

        // JS fallback if native vec returned nothing
        if (!embeddingRankedContext) {
          const candidates = this.db!.all(`
            SELECT filename, content, embedding
            FROM agent_memory_files
            WHERE agent_id = ? AND embedding IS NOT NULL AND embedding_status = 'success'
          `, [agentId]);

          const scored = candidates
            .map((row: any) => {
              const fileEmbedding = this.deserializeEmbedding(row.embedding);
              const similarity = this.cosineSimilarity(queryEmbedding, fileEmbedding || []);
              return { filename: row.filename, content: row.content, similarity };
            })
            .filter((r: any) => r.similarity >= 0.15) // Lowered threshold
            .sort((a: any, b: any) => b.similarity - a.similarity)
            .slice(0, 10);

          let currentTokens = 0;
          for (const row of scored) {
            const tokens = Math.ceil(row.content.length / 4);
            if (currentTokens + tokens > maxTokens) break;
            embeddingRankedContext += `\n--- ${row.filename} ---\n${row.content}\n`;
            currentTokens += tokens;
          }

          if (currentTokens > 0) {
            console.log(`[AgentMemory] Embedding-ranked context (JS fallback): ${currentTokens} tokens from ${scored.length} files`);
          }
        }
      } catch (embeddingError) {
        console.warn('[AgentMemory] Embedding search failed entirely:', embeddingError);
      }

      // ── Tier 3 Fallback: If embedding search returned nothing, include files by recency ──
      if (!embeddingRankedContext) {
        console.log(`[AgentMemory] Embedding search returned no results, falling back to recency-based inclusion`);
        let context = '';
        let currentTokens = 0;

        // Sort by most recently updated first
        const sorted = [...allContent].sort((a, b) => {
          const fileA = files.find(f => f.filename === a.filename);
          const fileB = files.find(f => f.filename === b.filename);
          return (fileB?.updatedAt || 0) - (fileA?.updatedAt || 0);
        });

        for (const item of sorted) {
          if (currentTokens + item.tokens > maxTokens) {
            // Truncate the file content if it's the first one and too large
            if (currentTokens === 0) {
              const maxChars = maxTokens * 4;
              context += `\n--- ${item.filename} (截断) ---\n${item.content.substring(0, maxChars)}\n`;
              currentTokens = maxTokens;
            }
            break;
          }
          context += `\n--- ${item.filename} ---\n${item.content}\n`;
          currentTokens += item.tokens;
        }

        console.log(`[AgentMemory] Recency fallback: ${currentTokens} tokens`);
        return context.trim();
      }

      return embeddingRankedContext.trim();
    } catch (error) {
      console.error(`[AgentMemory] Failed to get context for agent ${agentId}:`, error);

      // Last resort: return raw content up to token limit
      let fallback = '';
      let tokens = 0;
      for (const file of files) {
        if (!file.content) continue;
        const t = Math.ceil(file.content.length / 4);
        if (tokens + t > maxTokens) break;
        fallback += `\n--- ${file.filename} ---\n${file.content}\n`;
        tokens += t;
      }
      return fallback.trim();
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  startHeartbeat(agentId: string): void {
    (async () => {
      const config = await this.getAgentConfigAsync(agentId);
      if (!config || !config.enabled) return;

      if (this.heartbeatIntervals.has(agentId)) {
        clearInterval(this.heartbeatIntervals.get(agentId)!);
      }

      const interval = setInterval(async () => {
        await this.runHeartbeat(agentId);
      }, config.heartbeatIntervalMs);

      this.heartbeatIntervals.set(agentId, interval);
      console.log(`[AgentMemory] Agent ${agentId}: Heartbeat started (${config.heartbeatIntervalMs / 60000}min)`);
    })();
  }

  stopHeartbeat(agentId: string): void {
    if (this.heartbeatIntervals.has(agentId)) {
      clearInterval(this.heartbeatIntervals.get(agentId)!);
      this.heartbeatIntervals.delete(agentId);
      console.log(`[AgentMemory] Agent ${agentId}: Heartbeat stopped`);
    }
  }

  async startAllHeartbeats(): Promise<void> {
    await this.ensureInitialized();
    const results = this.db!.all('SELECT agent_id FROM agent_memory_configs WHERE enabled = 1');
    for (const result of results) {
      this.startHeartbeat(result.agent_id);
    }
  }

  stopAllHeartbeats(): void {
    for (const agentId of this.heartbeatIntervals.keys()) {
      this.stopHeartbeat(agentId);
    }
  }

  private async runHeartbeat(agentId: string): Promise<void> {
    const config = await this.getAgentConfigAsync(agentId);
    if (!config) return;

    console.log(`[AgentMemory] Agent ${agentId}: Running heartbeat (Task parser active)...`);

    const files = await this.getAgentMemoryFilesAsync(agentId);
    let parsedTasks = 0;

    for (const file of files) {
      await this.getEmbeddingForFile(file.id);

      if (file.content) {
        const cronRegex = /\[CRON:(.*?)\]\s*(.*)/g;
        let match;
        while ((match = cronRegex.exec(file.content)) !== null) {
          const timestamp = match[1].trim();
          const taskCommand = match[2].trim();

          let execute = false;
          const now = new Date();

          if (timestamp === 'every_hour') {
            execute = true;
          } else if (timestamp === 'every_day' && now.getHours() === 9) {
            execute = true;
          } else if (timestamp.includes(':')) {
            const [hh, mm] = timestamp.split(':');
            if (now.getHours() === parseInt(hh) && now.getMinutes() === parseInt(mm)) {
              execute = true;
            }
          }

          if (execute) {
            console.log(`[AgentMemory] Agent ${agentId}: Executing scheduled memory task -> ${taskCommand}`);
            parsedTasks++;
          }
        }
      }
    }

    const heartbeatFile = files.find(f => f.filename === 'HEARTBEAT.md');
    if (heartbeatFile && heartbeatFile.content) {
      console.log(`[AgentMemory] Agent ${agentId}: Found HEARTBEAT.md, checking for proactive actions...`);

      try {
        const { agentService } = await import('./agent-service.js');
        const { modelsManager } = await import('../models/manager.js');
        const { gatewayService } = await import('./gateway.js');

        const agent = agentService.getAgent(agentId);
        if (agent) {
          const systemPrompt = `你是「${agent.name}」。你的心跳机制刚刚触发，你需要检查是否有需要主动跟进的事项。

以下是你记忆中的HEARTBEAT.md文件内容：
${heartbeatFile.content}

请分析以下内容：
1. 是否有需要提醒用户的事项？
2. 是否有需要主动检查的任务？
3. 是否有需要汇报的状态？

如果有需要主动跟进的事项，请使用send_message工具向用户发送消息。如果没有需要跟进的事项，请回复"无需要跟进的事项"。`;

          const response = await modelsManager.chat({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: '请检查是否有需要主动跟进的事项。' }
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

          if (response.content && !response.content.includes('无需要跟进的事项')) {
            console.log(`[AgentMemory] Agent ${agentId}: Proactive message generated: ${response.content}`);

            const sessions = gatewayService.getSessionsByAgent(agentId);
            if (sessions.length > 0) {
              gatewayService.sendMessage(sessions[0].id, 'status', response.content);
            }
          }
        }
      } catch (error) {
        console.error(`[AgentMemory] Agent ${agentId}: Error in heartbeat proactive check:`, error);
      }
    }

    if (parsedTasks > 0) {
      console.log(`[AgentMemory] Agent ${agentId}: Triggered ${parsedTasks} scheduled tasks during heartbeat.`);
    }

    await this.updateAgentConfigAsync(agentId, { lastHeartbeat: Date.now() });
  }

  getAgentStats(agentId: string): AgentMemoryStats | undefined {
    throw new Error('Use async getAgentStatsAsync instead');
  }

  async getAgentStatsAsync(agentId: string): Promise<AgentMemoryStats | undefined> {
    const config = await this.getAgentConfigAsync(agentId);
    if (!config) return undefined;

    const files = await this.getAgentMemoryFilesAsync(agentId);
    const fileInfos: MemoryFileInfo[] = files.map(f => ({
      id: f.id,
      filename: f.filename,
      size: f.size,
      type: f.type,
      embeddingStatus: f.embeddingStatus,
      embeddingError: f.embeddingError,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    return {
      agentId,
      files: fileInfos,
      totalSize,
      lastHeartbeat: config.lastHeartbeat,
      config,
    };
  }

  getAllStats(): AgentMemoryStats[] {
    throw new Error('Use async getAllStatsAsync instead');
  }

  async getAllStatsAsync(): Promise<AgentMemoryStats[]> {
    await this.ensureInitialized();
    const results = this.db!.all('SELECT agent_id FROM agent_memory_configs');
    const stats: AgentMemoryStats[] = [];

    for (const result of results) {
      const agentStats = await this.getAgentStatsAsync(result.agent_id);
      if (agentStats) stats.push(agentStats);
    }

    return stats;
  }

  clearAgent(agentId: string): void {
    throw new Error('Use async clearAgentAsync instead');
  }

  async clearAgentAsync(agentId: string): Promise<void> {
    const files = await this.getAgentMemoryFilesAsync(agentId);
    for (const file of files) {
      await this.deleteMemoryFileAsync(file.id);
    }
    this.stopHeartbeat(agentId);
    console.log(`[AgentMemory] Agent ${agentId}: Memory cleared`);
  }

  deleteAgent(agentId: string): void {
    throw new Error('Use async deleteAgentAsync instead');
  }

  async deleteAgentAsync(agentId: string): Promise<void> {
    this.stopHeartbeat(agentId);
    await this.clearAgentAsync(agentId);

    this.db!.run('DELETE FROM agent_memory_configs WHERE agent_id = ?', [agentId]);
    this.db!.save();
    console.log(`[AgentMemory] Agent ${agentId}: Deleted`);
  }

  async extractKeyInfoFromConversation(
    agentId: string,
    userMessage: string,
    assistantMessage: string
  ): Promise<void> {
    const config = await this.getAgentConfigAsync(agentId);
    if (!config || !config.autoExtract) return;

    const keyInfo = this.identifyKeyInfo(userMessage, assistantMessage);
    if (!keyInfo) return;

    const memoryFile = await this.getOrCreateMemoryFileAsync(agentId);
    const existingContent = memoryFile.content;

    const newEntry = this.formatKeyInfoEntry(keyInfo, Date.now());
    const updatedContent = this.mergeKeyInfo(existingContent, newEntry);

    await this.updateMemoryFileAsync(memoryFile.id, updatedContent);
    console.log(`[AgentMemory] Agent ${agentId}: Extracted key info - ${keyInfo.type}`);
  }

  private identifyKeyInfo(userMsg: string, assistantMsg: string): { type: string; content: string; importance: number } | null {
    const combinedText = `${userMsg} ${assistantMsg}`.toLowerCase();

    const patterns = [
      { regex: /我叫|我是|我的名字|name is|my name/i, type: '用户姓名', importance: 10 },
      { regex: /我喜欢|我爱好|i like|i love|偏好|preference/i, type: '用户偏好', importance: 8 },
      { regex: /我的工作|职业|job|profession|我是做/i, type: '用户职业', importance: 7 },
      { regex: /我的公司|company|工作单位/i, type: '用户公司', importance: 7 },
      { regex: /我的项目|project|正在做/i, type: '用户项目', importance: 6 },
      { regex: /记住|记得|remember|不要忘|重要|important/i, type: '重要信息', importance: 9 },
      { regex: /我的目标|goal|计划|plan|想要/i, type: '用户目标', importance: 6 },
      { regex: /遇到问题|报错|error|bug|失败/i, type: '问题记录', importance: 5 },
      { regex: /解决了|成功|success|完成/i, type: '成功经验', importance: 5 },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(combinedText)) {
        const sentences = combinedText.split(/[。！？.!?]/);
        for (const sentence of sentences) {
          if (pattern.regex.test(sentence)) {
            return {
              type: pattern.type,
              content: sentence.trim().substring(0, 200),
              importance: pattern.importance,
            };
          }
        }
      }
    }

    if (userMsg.includes('记住') || userMsg.includes('记得')) {
      return {
        type: '用户要求记忆',
        content: userMsg.substring(0, 200),
        importance: 10,
      };
    }

    return null;
  }

  private async getOrCreateMemoryFileAsync(agentId: string): Promise<MemoryFile> {
    const existingFiles = await this.getAgentMemoryFilesAsync(agentId);

    const memoryFile = existingFiles.find(f => f.filename === 'memory.md');
    if (memoryFile) return memoryFile;

    return this.createMemoryFileAsync(
      agentId,
      'memory.md',
      `# 记忆文件\n\n此文件记录了Agent的身份信息和对话中的关键信息。\n\n---\n`,
      'knowledge'
    );
  }

  private formatKeyInfoEntry(keyInfo: { type: string; content: string; importance: number }, timestamp: number): string {
    const date = new Date(timestamp).toLocaleString('zh-CN');
    return `\n## [${keyInfo.type}] ${date}\n${keyInfo.content}\n`;
  }

  private mergeKeyInfo(existing: string, newEntry: string): string {
    const lines = existing.split('\n');
    const existingEntries = new Set<string>();

    for (const line of lines) {
      if (line.startsWith('##') || line.length > 20) {
        existingEntries.add(line.trim().toLowerCase());
      }
    }

    const newLines = newEntry.trim().split('\n');
    const newContent = newLines[2]?.trim().toLowerCase() || '';

    for (const existingEntry of existingEntries) {
      if (existingEntry.includes(newContent.substring(0, 20))) {
        return existing;
      }
    }

    return existing.trim() + '\n' + newEntry;
  }

  async summarizeConversation(
    agentId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    if (messages.length < 4) return;

    const summaryFile = await this.getOrCreateSummaryFileAsync(agentId);
    const summary = this.generateConversationSummary(messages);

    if (summary) {
      const newEntry = `\n## 对话摘要 ${new Date().toLocaleString('zh-CN')}\n${summary}\n`;
      await this.updateMemoryFileAsync(summaryFile.id, summaryFile.content + newEntry);
      console.log(`[AgentMemory] Agent ${agentId}: Saved conversation summary`);
    }
  }

  private async getOrCreateSummaryFileAsync(agentId: string): Promise<MemoryFile> {
    const existingFiles = await this.getAgentMemoryFilesAsync(agentId);
    const summaryFile = existingFiles.find(f => f.filename === 'conversation-summary.md');

    if (summaryFile) return summaryFile;

    return this.createMemoryFileAsync(
      agentId,
      'conversation-summary.md',
      `# 对话摘要记录\n\n此文件记录对话的精简摘要，保留关键信息而非完整历史。\n\n---\n`,
      'conversation'
    );
  }

  private generateConversationSummary(messages: Array<{ role: string; content: string }>): string | null {
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    if (userMessages.length < 2) return null;

    const topics: string[] = [];
    const keywords = new Set<string>();

    for (const msg of userMessages) {
      const words = msg.content.split(/\s+/);
      for (const word of words) {
        if (word.length >= 2 && word.length <= 10) {
          keywords.add(word);
        }
      }
    }

    const topicPatterns = [
      /关于|关于(.{2,10})/,
      /如何|怎么/,
      /什么是|解释/,
      /帮我|帮助/,
      /写|生成|创建/,
    ];

    for (const msg of userMessages) {
      for (const pattern of topicPatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          topics.push(match[0]);
        }
      }
    }

    if (topics.length === 0 && keywords.size === 0) return null;

    let summary = `- 对话轮数: ${userMessages.length}轮\n`;
    if (topics.length > 0) {
      summary += `- 主要话题: ${topics.slice(0, 3).join(', ')}\n`;
    }
    summary += `- 关键词: ${Array.from(keywords).slice(0, 5).join(', ')}\n`;

    return summary;
  }
}

export const agentMemoryManager = new AgentMemoryManager();
