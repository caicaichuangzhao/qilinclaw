import { createHash } from 'crypto';
import { DatabaseManager, getDatabaseManager } from '../config/database';
import { cosineSimilarity, serializeEmbedding, deserializeEmbedding } from '../utils/vector';

export interface VectorEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    role: 'user' | 'assistant' | 'system';
    timestamp: number;
    conversationId: string;
    tokenCount: number;
  };
}

export interface SearchResult {
  entry: VectorEntry;
  similarity: number;
}

export interface ConversationSummary {
  id: string;
  conversationId: string;
  summary: string;
  embedding: number[];
  messageCount: number;
  startTimestamp: number;
  endTimestamp: number;
  createdAt: number;
}

export interface ConversationMeta {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export class VectorStore {
  private db: DatabaseManager | null = null;
  private embeddingDimension: number = 1024;
  private maxEntriesPerConversation: number = 100;
  private similarityThreshold: number = 0.05;
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

  setEmbeddingDimension(dimension: number): void {
    this.embeddingDimension = dimension;
  }

  setMaxEntriesPerConversation(max: number): void {
    this.maxEntriesPerConversation = max;
  }

  setSimilarityThreshold(threshold: number): void {
    this.similarityThreshold = threshold;
  }

  generateId(content: string, timestamp: number): string {
    return createHash('md5').update(`${content}:${timestamp}`).digest('hex');
  }

  async addEntry(
    content: string,
    embedding: number[],
    metadata: VectorEntry['metadata']
  ): Promise<VectorEntry> {
    await this.ensureInitialized();
    const id = this.generateId(content, metadata.timestamp);

    const entry: VectorEntry = {
      id,
      content,
      embedding,
      metadata,
    };

    await this.db!.transaction(() => {
      const existingMeta = this.getConversationMeta(metadata.conversationId);
      const isNewConversation = !existingMeta || existingMeta.messageCount === 0;
      const isFirstUserMessage = metadata.role === 'user' && isNewConversation;

      this.db!.run(
        `INSERT OR REPLACE INTO vector_entries 
         (id, content, embedding, role, timestamp, conversation_id, token_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          content,
          serializeEmbedding(embedding),
          metadata.role,
          metadata.timestamp,
          metadata.conversationId,
          metadata.tokenCount
        ]
      );

      this.db!.run(
        `INSERT OR REPLACE INTO conversation_metas 
         (conversation_id, title, created_at, updated_at, message_count)
         VALUES (?, ?, ?, ?, ?)`,
        [
          metadata.conversationId,
          existingMeta?.title || (isFirstUserMessage ? content.substring(0, 50) : ''),
          existingMeta?.createdAt || metadata.timestamp,
          metadata.timestamp,
          (existingMeta?.messageCount || 0) + 1
        ]
      );
    });

    await this.pruneConversation(metadata.conversationId);
    this.db!.save();

    return entry;
  }

  private async pruneConversation(conversationId: string): Promise<void> {
    await this.ensureInitialized();
    const entries = await this.getConversationEntries(conversationId);
    if (entries.length <= this.maxEntriesPerConversation) return;

    const toRemove = entries.slice(0, entries.length - this.maxEntriesPerConversation);
    for (const entry of toRemove) {
      await this.deleteEntry(entry.id);
    }
  }

  async getEntry(id: string): Promise<VectorEntry | undefined> {
    await this.ensureInitialized();
    const result = this.db!.get(
      'SELECT * FROM vector_entries WHERE id = ?',
      [id]
    );

    if (!result) return undefined;

    return {
      id: result.id,
      content: result.content,
      embedding: deserializeEmbedding(result.embedding),
      metadata: {
        role: result.role,
        timestamp: result.timestamp,
        conversationId: result.conversation_id,
        tokenCount: result.token_count
      }
    };
  }

  async getConversationEntries(conversationId: string): Promise<VectorEntry[]> {
    await this.ensureInitialized();
    const results = this.db!.all(
      'SELECT * FROM vector_entries WHERE conversation_id = ? ORDER BY timestamp ASC',
      [conversationId]
    );

    return results.map(result => ({
      id: result.id,
      content: result.content,
      embedding: deserializeEmbedding(result.embedding),
      metadata: {
        role: result.role,
        timestamp: result.timestamp,
        conversationId: result.conversation_id,
        tokenCount: result.token_count
      }
    }));
  }

  async searchSimilar(
    queryEmbedding: number[],
    options: {
      conversationId?: string;
      limit?: number;
      threshold?: number;
      queryText?: string; // For hybrid keyword+semantic scoring
    } = {}
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const { conversationId, limit = 10, threshold = this.similarityThreshold, queryText } = options;

    // Extract keywords for hybrid scoring
    const keywords = queryText ? this.extractKeywords(queryText) : [];
    const useHybrid = keywords.length > 0;

    let allResults: SearchResult[] = [];

    try {
      // Use a lower internal threshold to collect more candidates when hybrid scoring
      const internalThreshold = useHybrid ? Math.min(threshold * 0.3, 0.05) : threshold;
      const internalLimit = useHybrid ? limit * 5 : limit;

      let query = `
        SELECT *, (1.0 - vec_distance_cosine(CAST(? AS BLOB), embedding)) as similarity
        FROM vector_entries
      `;
      const params: any[] = [serializeEmbedding(queryEmbedding)];

      if (conversationId) {
        query += ' WHERE conversation_id = ?';
        params.push(conversationId);
        query += ' AND similarity >= ? ORDER BY similarity DESC LIMIT ?';
      } else {
        query += ' WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?';
      }
      params.push(internalThreshold, internalLimit);

      const sqlResults = this.db!.all(query, params);
      allResults = sqlResults.map(result => ({
        entry: {
          id: result.id,
          content: result.content,
          embedding: deserializeEmbedding(result.embedding),
          metadata: {
            role: result.role,
            timestamp: result.timestamp,
            conversationId: result.conversation_id,
            tokenCount: result.token_count
          }
        },
        similarity: result.similarity
      }));
    } catch (err) {
      console.warn('[VectorStore] Native vec_distance_cosine failed, falling back to JavaScript cosine similarity:', (err as Error).message);
      let candidates: VectorEntry[];
      if (conversationId) {
        candidates = await this.getConversationEntries(conversationId);
      } else {
        const results = this.db!.all('SELECT * FROM vector_entries');
        candidates = results.map(result => ({
          id: result.id,
          content: result.content,
          embedding: deserializeEmbedding(result.embedding),
          metadata: {
            role: result.role,
            timestamp: result.timestamp,
            conversationId: result.conversation_id,
            tokenCount: result.token_count
          }
        }));
      }

      for (const entry of candidates) {
        const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity >= (useHybrid ? Math.min(threshold * 0.3, 0.05) : threshold)) {
          allResults.push({ entry, similarity });
        }
      }
    }

    // Apply hybrid keyword scoring if query text is provided
    if (useHybrid) {
      allResults = allResults
        .map(r => {
          const keywordScore = this.computeKeywordScore(r.entry.content, keywords);
          // Exclude results with zero keyword match entirely — user explicitly typed keywords
          if (keywordScore === 0) return null;
          const hybridScore = r.similarity * 0.6 + keywordScore * 0.4;
          return { ...r, similarity: hybridScore };
        })
        .filter((r): r is SearchResult => r !== null && r.similarity >= threshold);
    }

    allResults.sort((a, b) => b.similarity - a.similarity);
    return allResults.slice(0, limit);
  }

  // Extract keywords from query for hybrid scoring
  private extractKeywords(query: string): string[] {
    const keywords: string[] = [];
    if (query.trim().length > 0) {
      keywords.push(query.trim().toLowerCase());
    }
    const parts = query.split(/[\s,，。！？、；：""''（）\(\)\[\]]+/).filter(p => p.length > 0);
    for (const part of parts) {
      if (part.length > 0) {
        keywords.push(part.toLowerCase());
      }
    }
    return [...new Set(keywords)];
  }

  // Compute keyword match score (0 to 1)
  private computeKeywordScore(content: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const lowerContent = content.toLowerCase();
    let matchCount = 0;
    let totalOccurrences = 0;
    for (const kw of keywords) {
      if (lowerContent.includes(kw)) {
        matchCount++;
        let idx = 0;
        let count = 0;
        while ((idx = lowerContent.indexOf(kw, idx)) !== -1) {
          count++;
          idx += kw.length;
        }
        totalOccurrences += Math.min(count, 5);
      }
    }
    const coverageScore = matchCount / keywords.length;
    const frequencyBonus = Math.min(totalOccurrences / (keywords.length * 3), 1);
    return coverageScore * 0.7 + frequencyBonus * 0.3;
  }

  async addSummary(
    conversationId: string,
    summary: string,
    embedding: number[],
    messageCount: number,
    startTimestamp: number,
    endTimestamp: number
  ): Promise<ConversationSummary> {
    await this.ensureInitialized();
    const id = this.generateId(summary, Date.now());
    const createdAt = Date.now();

    const summaryEntry: ConversationSummary = {
      id,
      conversationId,
      summary,
      embedding,
      messageCount,
      startTimestamp,
      endTimestamp,
      createdAt,
    };

    this.db!.run(
      `INSERT OR REPLACE INTO conversation_summaries 
       (id, conversation_id, summary, embedding, message_count, start_timestamp, end_timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        conversationId,
        summary,
        serializeEmbedding(embedding),
        messageCount,
        startTimestamp,
        endTimestamp,
        createdAt
      ]
    );

    this.db!.save();
    return summaryEntry;
  }

  async getConversationSummaries(conversationId: string): Promise<ConversationSummary[]> {
    await this.ensureInitialized();
    const results = this.db!.all(
      'SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );

    return results.map(result => ({
      id: result.id,
      conversationId: result.conversation_id,
      summary: result.summary,
      embedding: deserializeEmbedding(result.embedding),
      messageCount: result.message_count,
      startTimestamp: result.start_timestamp,
      endTimestamp: result.end_timestamp,
      createdAt: result.created_at
    }));
  }

  async searchSummaries(
    queryEmbedding: number[],
    conversationId?: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();

    try {
      let query = `
        SELECT cs.*, (1.0 - vec_distance_cosine(CAST(? AS BLOB), cs.embedding)) as similarity
        FROM conversation_summaries cs
      `;
      const params: any[] = [serializeEmbedding(queryEmbedding)];

      if (conversationId) {
        query += ' WHERE cs.conversation_id = ?';
        params.push(conversationId);
      }

      query += ' ORDER BY similarity DESC LIMIT ?';
      params.push(limit);

      const sqlResults = this.db!.all(query, params);
      return sqlResults.map(result => ({
        entry: {
          id: result.id,
          content: result.summary,
          embedding: deserializeEmbedding(result.embedding),
          metadata: {
            role: 'system',
            timestamp: result.created_at,
            conversationId: result.conversation_id,
            tokenCount: 0,
          },
        },
        similarity: result.similarity
      }));
    } catch (err) {
      console.warn('[VectorStore] Native searchSummaries failed, falling back to JavaScript cosine similarity:', err);
      let query = 'SELECT * FROM conversation_summaries';
      const params: any[] = [];

      if (conversationId) {
        query += ' WHERE conversation_id = ?';
        params.push(conversationId);
      }

      const results = this.db!.all(query, params);
      const summaries: ConversationSummary[] = results.map(result => ({
        id: result.id,
        conversationId: result.conversation_id,
        summary: result.summary,
        embedding: deserializeEmbedding(result.embedding),
        messageCount: result.message_count,
        startTimestamp: result.start_timestamp,
        endTimestamp: result.end_timestamp,
        createdAt: result.created_at
      }));

      const searchResults: SearchResult[] = [];

      for (const summary of summaries) {
        const similarity = cosineSimilarity(queryEmbedding, summary.embedding);
        searchResults.push({
          entry: {
            id: summary.id,
            content: summary.summary,
            embedding: summary.embedding,
            metadata: {
              role: 'system',
              timestamp: summary.createdAt,
              conversationId: summary.conversationId,
              tokenCount: 0,
            },
          },
          similarity,
        });
      }

      searchResults.sort((a, b) => b.similarity - a.similarity);
      return searchResults.slice(0, limit);
    }
  }

  getConversationMeta(conversationId: string): ConversationMeta | undefined {
    if (!this.db) return undefined;
    const result = this.db.get(
      'SELECT * FROM conversation_metas WHERE conversation_id = ?',
      [conversationId]
    );

    if (!result) return undefined;

    return {
      conversationId: result.conversation_id,
      title: result.title || '',
      createdAt: result.created_at,
      updatedAt: result.updated_at,
      messageCount: result.message_count
    };
  }

  async setConversationMeta(conversationId: string, meta: Partial<ConversationMeta>): Promise<void> {
    await this.ensureInitialized();
    const existing = this.getConversationMeta(conversationId);

    this.db!.run(
      `INSERT OR REPLACE INTO conversation_metas 
       (conversation_id, title, created_at, updated_at, message_count)
       VALUES (?, ?, ?, ?, ?)`,
      [
        conversationId,
        meta.title || existing?.title || '',
        meta.createdAt || existing?.createdAt || Date.now(),
        meta.updatedAt || Date.now(),
        meta.messageCount ?? existing?.messageCount ?? 0,
      ]
    );

    this.db!.save();
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.ensureInitialized();
    const existing = this.getConversationMeta(conversationId);

    if (existing) {
      this.db!.run(
        'UPDATE conversation_metas SET title = ?, updated_at = ? WHERE conversation_id = ?',
        [title, Date.now(), conversationId]
      );
      this.db!.save();
    } else {
      await this.setConversationMeta(conversationId, { title });
    }
  }

  async getAllConversationMetas(): Promise<ConversationMeta[]> {
    await this.ensureInitialized();
    const results = this.db!.all(
      'SELECT * FROM conversation_metas ORDER BY updated_at DESC'
    );

    return results.map(result => ({
      conversationId: result.conversation_id,
      title: result.title || '',
      createdAt: result.created_at,
      updatedAt: result.updated_at,
      messageCount: result.message_count
    }));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.ensureInitialized();
    await this.db!.transaction(() => {
      this.db!.run('DELETE FROM vector_entries WHERE conversation_id = ?', [conversationId]);
      this.db!.run('DELETE FROM conversation_summaries WHERE conversation_id = ?', [conversationId]);
      this.db!.run('DELETE FROM conversation_metas WHERE conversation_id = ?', [conversationId]);
    });
    this.db!.save();
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.db!.transaction(() => {
      this.db!.run('DELETE FROM vector_entries');
      this.db!.run('DELETE FROM conversation_summaries');
      this.db!.run('DELETE FROM conversation_metas');
    });
    this.db!.save();
  }

  async getStats(): Promise<{
    totalEntries: number;
    totalSummaries: number;
    conversationCount: number;
  }> {
    await this.ensureInitialized();
    const entryResult = this.db!.get('SELECT COUNT(*) as count FROM vector_entries');
    const summaryResult = this.db!.get('SELECT COUNT(*) as count FROM conversation_summaries');
    const conversationResult = this.db!.get('SELECT COUNT(*) as count FROM conversation_metas');

    return {
      totalEntries: entryResult?.count || 0,
      totalSummaries: summaryResult?.count || 0,
      conversationCount: conversationResult?.count || 0,
    };
  }

  async getAllEntries(): Promise<VectorEntry[]> {
    await this.ensureInitialized();
    const results = this.db!.all('SELECT * FROM vector_entries ORDER BY timestamp DESC');

    return results.map(result => ({
      id: result.id,
      content: result.content,
      embedding: deserializeEmbedding(result.embedding),
      metadata: {
        role: result.role,
        timestamp: result.timestamp,
        conversationId: result.conversation_id,
        tokenCount: result.token_count
      }
    }));
  }

  async getAllSummaries(): Promise<ConversationSummary[]> {
    await this.ensureInitialized();
    const results = this.db!.all('SELECT * FROM conversation_summaries ORDER BY created_at DESC');

    return results.map(result => ({
      id: result.id,
      conversationId: result.conversation_id,
      summary: result.summary,
      embedding: deserializeEmbedding(result.embedding),
      messageCount: result.message_count,
      startTimestamp: result.start_timestamp,
      endTimestamp: result.end_timestamp,
      createdAt: result.created_at
    }));
  }

  async deleteEntry(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const entry = await this.getEntry(id);
    if (!entry) return false;

    this.db!.run('DELETE FROM vector_entries WHERE id = ?', [id]);
    this.db!.save();
    return true;
  }

  async exportData(): Promise<{
    entries: VectorEntry[];
    summaries: ConversationSummary[];
  }> {
    const entries = await this.getAllEntries();
    const summaries = await this.getAllSummaries();
    return { entries, summaries };
  }

  async importData(data: { entries: VectorEntry[]; summaries: ConversationSummary[] }): Promise<void> {
    await this.ensureInitialized();
    await this.clear();

    for (const entry of data.entries) {
      await this.addEntry(entry.content, entry.embedding, entry.metadata);
    }

    for (const summary of data.summaries) {
      this.db!.run(
        `INSERT OR REPLACE INTO conversation_summaries 
         (id, conversation_id, summary, embedding, message_count, start_timestamp, end_timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          summary.id,
          summary.conversationId,
          summary.summary,
          serializeEmbedding(summary.embedding),
          summary.messageCount,
          summary.startTimestamp,
          summary.endTimestamp,
          summary.createdAt
        ]
      );
    }

    this.db!.save();
  }
}

export const vectorStore = new VectorStore();
