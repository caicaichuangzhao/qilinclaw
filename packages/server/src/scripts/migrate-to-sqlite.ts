import fs from 'fs';
import path from 'path';
import { DatabaseManager, getDatabaseManager } from '../config/database';

interface LegacyVectorStoreData {
  entries: Array<{
    id: string;
    content: string;
    embedding: number[];
    metadata: {
      role: string;
      timestamp: number;
      conversationId: string;
      tokenCount: number;
    };
  }>;
  summaries: Array<{
    id: string;
    conversationId: string;
    summary: string;
    embedding: number[];
    messageCount: number;
    startTimestamp: number;
    endTimestamp: number;
    createdAt: number;
  }>;
}

interface LegacyConversationMetas {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface LegacyAgentMemoryData {
  configs: Array<{
    agentId: string;
    enabled: boolean;
    heartbeatIntervalMs: number;
    autoExtract: boolean;
    memoryFiles: string[];
    lastHeartbeat?: number;
    createdAt: number;
    updatedAt: number;
  }>;
  files: Array<{
    id: string;
    agentId: string;
    filename: string;
    content: string;
    embedding?: number[];
    embeddingStatus?: string;
    embeddingError?: string;
    embeddingUpdatedAt?: number;
    createdAt: number;
    updatedAt: number;
    size: number;
    type: string;
  }>;
}

interface LegacyKnowledgeData {
  knowledgeBases: Array<{
    id: string;
    name: string;
    description: string;
    documents: Array<{ id: string }>;
    createdAt: number;
    updatedAt: number;
  }>;
  documents: Array<{
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    content: string;
    chunks: Array<{
      id: string;
      documentId: string;
      content: string;
      embedding: number[];
      startIndex: number;
      endIndex: number;
      metadata: {
        pageNumber?: number;
        section?: string;
      };
    }>;
    metadata: {
      uploadedAt: number;
      updatedAt: number;
      source: string;
      tags: string[];
      embeddingStatus?: string;
      embeddingError?: string;
    };
  }>;
  chunks: Array<any>;
}

export class MigrationTool {
  private db: DatabaseManager | null = null;
  private dataPath: string;

  constructor() {
    this.dataPath = path.resolve(process.cwd(), '.qilin-claw');
  }

  async initialize(): Promise<void> {
    this.db = await getDatabaseManager();
  }

  private serializeEmbedding(embedding: number[]): Uint8Array {
    const buffer = new ArrayBuffer(embedding.length * 4);
    const view = new Float32Array(buffer);
    for (let i = 0; i < embedding.length; i++) {
      view[i] = embedding[i];
    }
    return new Uint8Array(buffer);
  }

  async migrateVectorStore(): Promise<{ success: boolean; message: string }> {
    try {
      const vectorStorePath = path.join(this.dataPath, 'vector-store.json');
      const metaPath = path.join(this.dataPath, 'conversation-metas.json');

      if (!fs.existsSync(vectorStorePath)) {
        return { success: true, message: 'No vector store data found to migrate' };
      }

      console.log('[Migration] Migrating vector store...');
      const vectorData: LegacyVectorStoreData = JSON.parse(fs.readFileSync(vectorStorePath, 'utf-8'));

      let conversationMetas: LegacyConversationMetas[] = [];
      if (fs.existsSync(metaPath)) {
        conversationMetas = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      }

      await this.db!.transaction(() => {
        for (const entry of vectorData.entries || []) {
          this.db!.run(
            `INSERT OR REPLACE INTO vector_entries 
             (id, content, embedding, role, timestamp, conversation_id, token_count)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.content,
              this.serializeEmbedding(entry.embedding),
              entry.metadata.role,
              entry.metadata.timestamp,
              entry.metadata.conversationId,
              entry.metadata.tokenCount
            ]
          );
        }

        for (const summary of vectorData.summaries || []) {
          this.db!.run(
            `INSERT OR REPLACE INTO conversation_summaries 
             (id, conversation_id, summary, embedding, message_count, start_timestamp, end_timestamp, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              summary.id,
              summary.conversationId,
              summary.summary,
              this.serializeEmbedding(summary.embedding),
              summary.messageCount,
              summary.startTimestamp,
              summary.endTimestamp,
              summary.createdAt
            ]
          );
        }

        for (const meta of conversationMetas) {
          this.db!.run(
            `INSERT OR REPLACE INTO conversation_metas 
             (conversation_id, title, created_at, updated_at, message_count)
             VALUES (?, ?, ?, ?, ?)`,
            [
              meta.conversationId,
              meta.title,
              meta.createdAt,
              meta.updatedAt,
              meta.messageCount
            ]
          );
        }
      });

      this.db!.save();
      console.log(`[Migration] Vector store migrated: ${(vectorData.entries || []).length} entries, ${(vectorData.summaries || []).length} summaries`);
      return { success: true, message: `Vector store migrated successfully: ${(vectorData.entries || []).length} entries` };
    } catch (error) {
      console.error('[Migration] Failed to migrate vector store:', error);
      return { success: false, message: `Failed to migrate vector store: ${error}` };
    }
  }

  async migrateAgentMemory(): Promise<{ success: boolean; message: string }> {
    try {
      const agentMemoryPath = path.join(this.dataPath, 'agent-memories');
      const configPath = path.join(agentMemoryPath, 'configs.json');
      const filesPath = path.join(agentMemoryPath, 'memory-files.json');

      if (!fs.existsSync(configPath) && !fs.existsSync(filesPath)) {
        return { success: true, message: 'No agent memory data found to migrate' };
      }

      console.log('[Migration] Migrating agent memory...');
      let configs: LegacyAgentMemoryData['configs'] = [];
      let files: LegacyAgentMemoryData['files'] = [];

      if (fs.existsSync(configPath)) {
        configs = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }

      if (fs.existsSync(filesPath)) {
        files = JSON.parse(fs.readFileSync(filesPath, 'utf-8'));
      }

      await this.db!.transaction(() => {
        for (const config of configs) {
          this.db!.run(
            `INSERT OR REPLACE INTO agent_memory_configs 
             (agent_id, enabled, heartbeat_interval_ms, auto_extract, last_heartbeat, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              config.agentId,
              config.enabled ? 1 : 0,
              config.heartbeatIntervalMs,
              config.autoExtract ? 1 : 0,
              config.lastHeartbeat || null,
              config.createdAt,
              config.updatedAt
            ]
          );
        }

        for (const file of files) {
          this.db!.run(
            `INSERT OR REPLACE INTO agent_memory_files 
             (id, agent_id, filename, content, embedding, embedding_status, embedding_error, embedding_updated_at, size, type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              file.id,
              file.agentId,
              file.filename,
              file.content,
              file.embedding ? this.serializeEmbedding(file.embedding) : null,
              file.embeddingStatus || 'pending',
              file.embeddingError || null,
              file.embeddingUpdatedAt || null,
              file.size,
              file.type,
              file.createdAt,
              file.updatedAt
            ]
          );
        }
      });

      this.db!.save();
      console.log(`[Migration] Agent memory migrated: ${configs.length} configs, ${files.length} files`);
      return { success: true, message: `Agent memory migrated successfully: ${configs.length} configs, ${files.length} files` };
    } catch (error) {
      console.error('[Migration] Failed to migrate agent memory:', error);
      return { success: false, message: `Failed to migrate agent memory: ${error}` };
    }
  }

  async migrateKnowledgeBase(): Promise<{ success: boolean; message: string }> {
    try {
      const knowledgePath = path.join(this.dataPath, 'knowledge');
      const indexPath = path.join(knowledgePath, 'index.json');

      if (!fs.existsSync(indexPath)) {
        return { success: true, message: 'No knowledge base data found to migrate' };
      }

      console.log('[Migration] Migrating knowledge base...');
      const knowledgeData: LegacyKnowledgeData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

      await this.db!.transaction(() => {
        for (const kb of knowledgeData.knowledgeBases || []) {
          this.db!.run(
            `INSERT OR REPLACE INTO knowledge_bases 
             (id, name, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            [kb.id, kb.name, kb.description, kb.createdAt, kb.updatedAt]
          );
        }

        for (const doc of knowledgeData.documents || []) {
          const knowledgeBaseId = (knowledgeData.knowledgeBases || []).find(kb =>
            kb.documents?.some(d => d.id === doc.id)
          )?.id || '';

          this.db!.run(
            `INSERT OR REPLACE INTO knowledge_documents 
             (id, knowledge_base_id, filename, original_name, mime_type, size, content, uploaded_at, updated_at, source, tags, embedding_status, embedding_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              doc.id,
              knowledgeBaseId,
              doc.filename,
              doc.originalName,
              doc.mimeType,
              doc.size,
              doc.content,
              doc.metadata.uploadedAt,
              doc.metadata.updatedAt,
              doc.metadata.source,
              JSON.stringify(doc.metadata.tags || []),
              doc.metadata.embeddingStatus || 'pending',
              doc.metadata.embeddingError || null
            ]
          );

          for (const chunk of doc.chunks || []) {
            this.db!.run(
              `INSERT OR REPLACE INTO document_chunks 
               (id, document_id, content, embedding, start_index, end_index, page_number, section, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                chunk.id,
                chunk.documentId,
                chunk.content,
                this.serializeEmbedding(chunk.embedding),
                chunk.startIndex,
                chunk.endIndex,
                chunk.metadata.pageNumber || null,
                chunk.metadata.section || null,
                Date.now()
              ]
            );
          }
        }
      });

      this.db!.save();
      console.log(`[Migration] Knowledge base migrated: ${(knowledgeData.knowledgeBases || []).length} bases, ${(knowledgeData.documents || []).length} documents`);
      return { success: true, message: `Knowledge base migrated successfully: ${(knowledgeData.knowledgeBases || []).length} bases, ${(knowledgeData.documents || []).length} documents` };
    } catch (error) {
      console.error('[Migration] Failed to migrate knowledge base:', error);
      return { success: false, message: `Failed to migrate knowledge base: ${error}` };
    }
  }

  async migrateAll(): Promise<{
    vectorStore: { success: boolean; message: string };
    agentMemory: { success: boolean; message: string };
    knowledgeBase: { success: boolean; message: string };
  }> {
    console.log('[Migration] Starting full migration...');

    const vectorStoreResult = await this.migrateVectorStore();
    const agentMemoryResult = await this.migrateAgentMemory();
    const knowledgeBaseResult = await this.migrateKnowledgeBase();

    console.log('[Migration] Migration complete');
    return {
      vectorStore: vectorStoreResult,
      agentMemory: agentMemoryResult,
      knowledgeBase: knowledgeBaseResult
    };
  }
}

async function runMigration() {
  const migration = new MigrationTool();
  await migration.initialize();

  const results = await migration.migrateAll();

  console.log('\n=== Migration Results ===');
  console.log('Vector Store:', results.vectorStore.message);
  console.log('Agent Memory:', results.agentMemory.message);
  console.log('Knowledge Base:', results.knowledgeBase.message);
  console.log('========================\n');

  const allSuccess = results.vectorStore.success && results.agentMemory.success && results.knowledgeBase.success;
  process.exit(allSuccess ? 0 : 1);
}

if (require.main === module) {
  runMigration().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
