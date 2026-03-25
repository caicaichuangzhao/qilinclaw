import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager, getDatabaseManager } from '../config/database.js';
import { embeddingService } from './embedding-service.js';
import { cosineSimilarity, serializeEmbedding, deserializeEmbedding } from '../utils/vector.js';
import pdfParse from 'pdf-parse';
import * as xlsx from 'xlsx';
import { parseOffice } from 'officeparser';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  content: string;
  uploadedAt: number;
  updatedAt: number;
  source: string;
  tags: string;
  embeddingStatus?: 'success' | 'failed' | 'pending';
  embeddingError?: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  startIndex: number;
  endIndex: number;
  pageNumber?: number;
  section?: string;
  createdAt: number;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface SearchResult {
  chunk: DocumentChunk;
  document: KnowledgeDocument;
  similarity: number;
}

export class KnowledgeService {
  private db: DatabaseManager | null = null;
  private initialized: boolean = false;
  private chunkSize: number = 500;
  private chunkOverlap: number = 50;

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

  // Knowledge Base Management
  async createKnowledgeBase(name: string, description: string = ''): Promise<KnowledgeBase> {
    await this.ensureInitialized();
    const now = Date.now();
    const kb: KnowledgeBase = {
      id: `kb-${uuidv4()}`,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    };

    this.db!.run(
      `INSERT INTO knowledge_bases (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [kb.id, kb.name, kb.description, kb.createdAt, kb.updatedAt]
    );

    this.db!.save();
    return kb;
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBase | undefined> {
    await this.ensureInitialized();
    const result = this.db!.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );

    if (!result) return undefined;

    return {
      id: result.id,
      name: result.name,
      description: result.description || '',
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  }

  async getAllKnowledgeBases(): Promise<KnowledgeBase[]> {
    await this.ensureInitialized();
    const results = this.db!.all('SELECT * FROM knowledge_bases');

    return results.map(result => ({
      id: result.id,
      name: result.name,
      description: result.description || '',
      createdAt: result.created_at,
      updatedAt: result.updated_at
    }));
  }

  async getDocumentsForKnowledgeBase(kbId: string): Promise<KnowledgeDocument[]> {
    await this.ensureInitialized();
    const results = this.db!.all(
      'SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY uploaded_at DESC',
      [kbId]
    );

    return results.map(result => ({
      id: result.id,
      knowledgeBaseId: result.knowledge_base_id,
      filename: result.filename,
      originalName: result.original_name,
      mimeType: result.mime_type,
      size: result.size,
      content: '', // Omit large content from list
      uploadedAt: result.uploaded_at,
      updatedAt: result.updated_at,
      source: result.source || '',
      tags: result.tags || '[]',
      embeddingStatus: result.embedding_status as any,
      embeddingError: result.embedding_error || undefined
    }));
  }

  async updateKnowledgeBase(id: string, updates: Partial<KnowledgeBase>): Promise<KnowledgeBase | undefined> {
    await this.ensureInitialized();
    const kb = await this.getKnowledgeBase(id);
    if (!kb) return undefined;

    const updated = {
      ...kb,
      ...updates,
      id: kb.id,
      createdAt: kb.createdAt,
      updatedAt: Date.now(),
    };

    this.db!.run(
      'UPDATE knowledge_bases SET name = ?, description = ?, updated_at = ? WHERE id = ?',
      [updated.name, updated.description, updated.updatedAt, id]
    );

    this.db!.save();
    return updated;
  }

  async deleteKnowledgeBase(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const kb = await this.getKnowledgeBase(id);
    if (!kb) return false;

    await this.db!.transaction(() => {
      const docs = this.db!.all(
        'SELECT id FROM knowledge_documents WHERE knowledge_base_id = ?',
        [id]
      );

      for (const doc of docs) {
        this.db!.run('DELETE FROM document_chunks WHERE document_id = ?', [doc.id]);
      }

      this.db!.run('DELETE FROM knowledge_documents WHERE knowledge_base_id = ?', [id]);
      this.db!.run('DELETE FROM knowledge_bases WHERE id = ?', [id]);
    });

    this.db!.save();
    return true;
  }

  // Document Management
  async addDocument(
    knowledgeBaseId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    options: {
      tags?: string[];
      source?: string;
    } = {}
  ): Promise<KnowledgeDocument> {
    await this.ensureInitialized();
    const kb = await this.getKnowledgeBase(knowledgeBaseId);
    if (!kb) {
      throw new Error('Knowledge base not found');
    }

    const content = await this.extractContent(file.buffer, file.mimetype, file.originalname);
    const { chunks, embeddingSuccess, embeddingError } = await this.createChunksWithStatus(content);

    const now = Date.now();
    const doc: KnowledgeDocument = {
      id: `doc-${uuidv4()}`,
      knowledgeBaseId,
      filename: `${Date.now()}-${file.originalname}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      content,
      uploadedAt: now,
      updatedAt: now,
      source: options.source || 'upload',
      tags: JSON.stringify(options.tags || []),
      embeddingStatus: embeddingSuccess ? 'success' : 'failed',
      embeddingError: embeddingError,
    };

    await this.db!.transaction(() => {
      console.log(`[KnowledgeService] Storing document ${doc.originalName} with file_data length: ${file.buffer?.length || 0}`);
      this.db!.run(
        `INSERT INTO knowledge_documents 
         (id, knowledge_base_id, filename, original_name, mime_type, size, content, uploaded_at, updated_at, source, tags, embedding_status, embedding_error, file_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          doc.id, doc.knowledgeBaseId, doc.filename, doc.originalName, doc.mimeType,
          doc.size, doc.content, doc.uploadedAt, doc.updatedAt, doc.source, doc.tags,
          doc.embeddingStatus, doc.embeddingError, file.buffer
        ]
      );

      for (const chunk of chunks) {
        chunk.documentId = doc.id;
        const result = this.db!.run(
          `INSERT INTO document_chunks 
           (id, document_id, content, embedding, start_index, end_index, page_number, section, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id, chunk.documentId, chunk.content,
            serializeEmbedding(chunk.embedding),
            chunk.startIndex, chunk.endIndex, chunk.pageNumber || null, chunk.section || null,
            chunk.createdAt
          ]
        );

        // Also insert into vec0 virtual table for native vector search
        try {
          this.db!.run(
            `INSERT INTO vec_document_chunks (rowid, embedding) VALUES (last_insert_rowid(), ?)`,
            [serializeEmbedding(chunk.embedding)]
          );
        } catch (e) {
          console.warn('[KnowledgeService] Failed to insert into vec_document_chunks:', e);
        }
      }

      this.db!.run(
        'UPDATE knowledge_bases SET updated_at = ? WHERE id = ?',
        [Date.now(), knowledgeBaseId]
      );
    });

    this.db!.save();
    return doc;
  }

  async getDocument(id: string): Promise<KnowledgeDocument | undefined> {
    await this.ensureInitialized();
    const result = this.db!.get(
      'SELECT * FROM knowledge_documents WHERE id = ?',
      [id]
    );

    if (!result) return undefined;

    return {
      id: result.id,
      knowledgeBaseId: result.knowledge_base_id,
      filename: result.filename,
      originalName: result.original_name,
      mimeType: result.mime_type,
      size: result.size,
      content: result.content,
      uploadedAt: result.uploaded_at,
      updatedAt: result.updated_at,
      source: result.source || '',
      tags: result.tags || '[]',
      embeddingStatus: result.embedding_status as any,
      embeddingError: result.embedding_error || undefined
    };
  }

  async deleteDocument(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const doc = await this.getDocument(id);
    if (!doc) return false;

    await this.db!.transaction(() => {
      // Clean up vec0 entries first
      try {
        this.db!.run('DELETE FROM vec_document_chunks WHERE rowid IN (SELECT rowid FROM document_chunks WHERE document_id = ?)', [id]);
      } catch (e) { /* vec0 table may not have entries */ }
      this.db!.run('DELETE FROM document_chunks WHERE document_id = ?', [id]);
      this.db!.run('DELETE FROM knowledge_documents WHERE id = ?', [id]);
      this.db!.run(
        'UPDATE knowledge_bases SET updated_at = ? WHERE id = ?',
        [Date.now(), doc.knowledgeBaseId]
      );
    });

    this.db!.save();
    return true;
  }

  async updateDocumentMetadata(docId: string, metadata: Record<string, unknown>): Promise<KnowledgeDocument | undefined> {
    await this.ensureInitialized();
    const doc = await this.getDocument(docId);
    if (!doc) return undefined;

    const updates: any = {};
    if (metadata.source !== undefined) updates.source = metadata.source;
    if (metadata.tags !== undefined) updates.tags = JSON.stringify(metadata.tags);
    updates.updated_at = Date.now();

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), docId];

    this.db!.run(
      `UPDATE knowledge_documents SET ${setClause} WHERE id = ?`,
      values
    );

    this.db!.run(
      'UPDATE knowledge_bases SET updated_at = ? WHERE id = ?',
      [Date.now(), doc.knowledgeBaseId]
    );

    this.db!.save();
    return this.getDocument(docId);
  }

  async extractContent(buffer: Buffer, mimeType: string, filename: string = ''): Promise<string> {
    if (mimeType.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      return `[图片文件] data:${mimeType};base64,${base64}`;
    }

    if (mimeType.startsWith('text/')) {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'application/json' || mimeType.endsWith('+json')) {
      try {
        const json = JSON.parse(buffer.toString('utf-8'));
        return JSON.stringify(json, null, 2);
      } catch {
        return buffer.toString('utf-8');
      }
    }

    if (mimeType === 'application/markdown' || mimeType === 'text/markdown') {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'text/csv' || mimeType === 'application/csv') {
      return this.parseCSV(buffer.toString('utf-8'));
    }

    if (mimeType === 'application/xml' || mimeType === 'text/xml') {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
      return this.parseHTML(buffer.toString('utf-8'));
    }

    if (mimeType === 'application/javascript' || mimeType === 'text/javascript' || mimeType === 'application/typescript') {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'text/x-python' || mimeType === 'application/x-python-code') {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      return await this.parsePDF(buffer);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword' || filename.endsWith('.docx') || filename.endsWith('.doc')) {
      return await this.parseWord(buffer);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel' || filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      return this.parseExcel(buffer);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint' || filename.endsWith('.pptx') || filename.endsWith('.ppt')) {
      return await this.parsePowerpoint(buffer);
    }

    if (mimeType === 'application/x-yaml' || mimeType === 'text/yaml') {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'application/x-sh' || mimeType === 'application/x-shellscript') {
      return buffer.toString('utf-8');
    }

    try {
      return buffer.toString('utf-8');
    } catch {
      return `[Binary file - ${mimeType}]`;
    }
  }

  private parseCSV(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      const cells = line.split(',').map(cell => cell.trim().replace(/^["']|["']$/g, ''));
      result.push(cells.join(' | '));
    }

    return result.join('\n');
  }

  private parseHTML(content: string): string {
    return content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async parsePDF(buffer: Buffer): Promise<string> {
    try {
      // @ts-ignore
      const data = await pdfParse(buffer);
      return data.text;
    } catch (err) {
      console.error('[KnowledgeService] PDF parse error:', err);
      try {
        const content = buffer.toString('utf-8');
        const textMatches = content.match(/\(([^\)]+)\)/g);
        if (textMatches) {
          return textMatches.map(m => m.slice(1, -1)).join(' ');
        }
      } catch { }
      return '[PDF file - unable to extract text]';
    }
  }

  private async parseWord(buffer: Buffer): Promise<string> {
    try {
      console.log('[KnowledgeService] Parsing Word document with JSZip, buffer length:', buffer.length);
      const zip = await JSZip.loadAsync(buffer);

      const docXml = zip.file('word/document.xml');
      if (!docXml) {
        console.warn('[KnowledgeService] Invalid DOCX format: missing word/document.xml');
        return '[Word document - invalid format]';
      }

      const xmlString = await docXml.async('string');
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');

      // Extract all <w:t> (text) nodes
      const textNodes = doc.getElementsByTagName('w:t');
      let extractedText = '';

      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes.item(i);
        if (node && node.textContent) {
          extractedText += node.textContent;
        }

        // Add artificial spacing or newlines for certain elements if needed
        // For simple extraction, just concatenating text is usually fine, 
        // but adding spaces after paragraphs `<w:p>` improves readability.
        const parent = node?.parentNode;
        if (parent && parent.nextSibling && parent.nextSibling.nodeName === 'w:p') {
          extractedText += '\n';
        }
      }

      console.log(`[KnowledgeService] DOCX parsed successfully, content length: ${extractedText.length}`);
      return extractedText || '[Word document - empty]';
    } catch (err) {
      console.error('[KnowledgeService] DOCX parse error:', err);
      return '[Word document - unable to extract text]';
    }
  }

  private parseExcel(buffer: Buffer): string {
    try {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      let result = '';
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        result += `--- 表格: ${sheetName} ---\n`;
        result += xlsx.utils.sheet_to_csv(worksheet) + '\n\n';
      }
      return result.trim() || '[Excel document - empty]';
    } catch (err) {
      console.error('[KnowledgeService] Excel parse error:', err);
      return '[Excel document - unable to extract text]';
    }
  }

  private async parsePowerpoint(buffer: Buffer): Promise<string> {
    try {
      // @ts-ignore
      const text = await parseOffice(buffer);
      return typeof text === 'string' ? text : JSON.stringify(text);
    } catch (err) {
      console.error('[KnowledgeService] PPTX parse error:', err);
      return '[PowerPoint document - unable to extract text]';
    }
  }

  private async createChunks(content: string): Promise<DocumentChunk[]> {
    const result = await this.createChunksWithStatus(content);
    return result.chunks;
  }

  private async createChunksWithStatus(content: string): Promise<{ chunks: DocumentChunk[]; embeddingSuccess: boolean; embeddingError?: string }> {
    const chunks: DocumentChunk[] = [];
    let currentChunk = '';
    let startIndex = 0;
    let currentIndex = 0;
    let embeddingSuccess = true;
    let embeddingError: string | undefined;

    // Helper to process a finalized chunk
    const processChunk = async (text: string, startIdx: number, endIdx: number) => {
      const result = await this.getEmbeddingWithStatus(text);
      if (!result.success) {
        embeddingSuccess = false;
        embeddingError = result.error;
      }
      chunks.push({
        id: `chunk-${uuidv4()}`,
        documentId: '',
        content: text,
        embedding: result.embedding,
        startIndex: startIdx,
        endIndex: endIdx,
        createdAt: Date.now(),
      });
    };

    const lines = content.split('\n');

    for (const line of lines) {
      // If the single line is extremely long, break it down first
      if (line.length > this.chunkSize) {
        // First process whatever we accumulated so far
        if (currentChunk.trim().length > 0) {
          await processChunk(currentChunk, startIndex, currentIndex);
        }

        let tempLine = line;
        let lineIdx = currentIndex;

        // Forcefully slice the giant line into chunk-sized pieces
        while (tempLine.length > this.chunkSize) {
          const slice = tempLine.slice(0, this.chunkSize);
          await processChunk(slice, lineIdx, lineIdx + this.chunkSize);

          const stepSize = this.chunkSize - this.chunkOverlap;
          tempLine = tempLine.slice(stepSize);
          lineIdx += stepSize;
        }

        // The remainder of the giant line becomes the new currentChunk
        currentChunk = tempLine + '\n';
        startIndex = lineIdx;
        currentIndex += line.length + 1;
        continue;
      }

      if (currentChunk.length + line.length > this.chunkSize && currentChunk.length > 0) {
        await processChunk(currentChunk, startIndex, currentIndex);

        const overlapText = currentChunk.slice(-this.chunkOverlap);
        currentChunk = overlapText + line + '\n';
        startIndex = currentIndex - overlapText.length;
      } else {
        currentChunk += line + '\n';
      }
      currentIndex += line.length + 1;
    }

    if (currentChunk.trim().length > 0) {
      await processChunk(currentChunk, startIndex, currentIndex);
    }

    return { chunks, embeddingSuccess, embeddingError };
  }

  private async getEmbeddingWithStatus(text: string): Promise<{ embedding: number[]; success: boolean; error?: string }> {
    try {
      const result = await embeddingService.generateEmbedding(text);
      return { embedding: result.embedding, success: true };
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return {
        embedding: new Array(1536).fill(0),
        success: false,
        error: (error as Error).message
      };
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
    try {
      const result = await embeddingService.generateEmbedding(text);
      return result.embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return new Array(1536).fill(0);
    }
  }

  // Search with hybrid keyword + semantic scoring
  async search(
    query: string,
    options: {
      knowledgeBaseId?: string;
      limit?: number;
      threshold?: number;
    } = {}
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const { knowledgeBaseId, limit = 5, threshold = 0.05 } = options;

    const rawQueryEmbedding = await this.getEmbedding(query);
    // Pad/truncate the query embedding to match the database dimension format
    const queryEmbedding = deserializeEmbedding(serializeEmbedding(rawQueryEmbedding));

    let results: SearchResult[] = [];

    // Extract keywords from query for hybrid scoring
    const queryKeywords = this.extractKeywords(query);

    // Try native sqlite-vec first
    try {
      let chunkQuery = `
        SELECT dc.id, dc.document_id, dc.content, dc.start_index, dc.end_index, dc.page_number, dc.section, dc.created_at,
               kd.knowledge_base_id, kd.filename, kd.original_name, kd.mime_type, kd.size as doc_size, kd.uploaded_at, kd.updated_at, kd.source, kd.tags, kd.embedding_status, kd.embedding_error,
               (1.0 - vec_distance_cosine(CAST(? AS BLOB), v.embedding)) as similarity
        FROM vec_document_chunks v
        JOIN document_chunks dc ON v.rowid = dc.rowid
        JOIN knowledge_documents kd ON dc.document_id = kd.id
      `;
      const params: any[] = [serializeEmbedding(queryEmbedding)];
      // Use a lower internal threshold to get more candidates for hybrid scoring
      const internalThreshold = Math.min(threshold * 0.5, 0.05);
      if (knowledgeBaseId) {
        chunkQuery += ' WHERE kd.knowledge_base_id = ? AND similarity >= ? ORDER BY similarity DESC LIMIT ?';
        params.push(knowledgeBaseId, internalThreshold, limit * 3);
      } else {
        chunkQuery += ' WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?';
        params.push(internalThreshold, limit * 3);
      }

      const chunkResults = this.db!.all(chunkQuery, params);
      for (const row of chunkResults) {
        const chunk: DocumentChunk = { id: row.id, documentId: row.document_id, content: row.content, embedding: [], startIndex: row.start_index, endIndex: row.end_index, pageNumber: row.page_number || undefined, section: row.section || undefined, createdAt: row.created_at };
        const document: KnowledgeDocument = { id: row.document_id, knowledgeBaseId: row.knowledge_base_id, filename: row.filename, originalName: row.original_name, mimeType: row.mime_type, size: row.doc_size, content: '', uploadedAt: row.uploaded_at, updatedAt: row.updated_at, source: row.source || '', tags: row.tags || '[]', embeddingStatus: row.embedding_status as any, embeddingError: row.embedding_error || undefined };
        const keywordScore = this.computeKeywordScore(row.content, queryKeywords);
        // Exclude results with zero keyword match — user explicitly typed search terms
        if (keywordScore === 0) continue;
        const hybridScore = row.similarity * 0.6 + keywordScore * 0.4;
        results.push({ chunk, document, similarity: hybridScore });
      }
      if (results.length > 0) {
        console.log(`[KnowledgeService] Native vec search found ${results.length} candidates`);
      }
    } catch (e) {
      console.warn('[KnowledgeService] Native vec search failed, will use JS fallback:', (e as Error).message);
    }

    // Fallback: JS cosine similarity on raw document_chunks table
    if (results.length === 0) {
      console.log('[KnowledgeService] Using JS cosine similarity fallback for search');
      let chunkSql = `
        SELECT dc.id, dc.document_id, dc.content, dc.embedding, dc.start_index, dc.end_index, dc.page_number, dc.section, dc.created_at,
               kd.knowledge_base_id, kd.filename, kd.original_name, kd.mime_type, kd.size as doc_size, kd.uploaded_at, kd.updated_at, kd.source, kd.tags, kd.embedding_status, kd.embedding_error
        FROM document_chunks dc
        JOIN knowledge_documents kd ON dc.document_id = kd.id
      `;
      const fallbackParams: any[] = [];
      if (knowledgeBaseId) {
        chunkSql += ' WHERE kd.knowledge_base_id = ?';
        fallbackParams.push(knowledgeBaseId);
      }

      const allChunks = this.db!.all(chunkSql, fallbackParams);
      console.log(`[KnowledgeService] JS fallback: scanning ${allChunks.length} chunks`);

      for (const row of allChunks) {
        const chunkEmbedding = deserializeEmbedding(row.embedding);
        if (chunkEmbedding.length === 0) continue;
        const semanticSim = cosineSimilarity(queryEmbedding, chunkEmbedding);
        const keywordScore = this.computeKeywordScore(row.content, queryKeywords);
        // Exclude results with zero keyword match — user explicitly typed search terms
        if (keywordScore === 0) continue;
        const hybridScore = semanticSim * 0.6 + keywordScore * 0.4;
        // Include candidates above a low bar for hybrid re-ranking
        if (hybridScore >= threshold * 0.5) {
          const chunk: DocumentChunk = { id: row.id, documentId: row.document_id, content: row.content, embedding: [], startIndex: row.start_index, endIndex: row.end_index, pageNumber: row.page_number || undefined, section: row.section || undefined, createdAt: row.created_at };
          const document: KnowledgeDocument = { id: row.document_id, knowledgeBaseId: row.knowledge_base_id, filename: row.filename, originalName: row.original_name, mimeType: row.mime_type, size: row.doc_size, content: '', uploadedAt: row.uploaded_at, updatedAt: row.updated_at, source: row.source || '', tags: row.tags || '[]', embeddingStatus: row.embedding_status as any, embeddingError: row.embedding_error || undefined };
          results.push({ chunk, document, similarity: hybridScore });
        }
      }
      console.log(`[KnowledgeService] JS fallback found ${results.length} hybrid results`);
    }

    // Filter by final threshold and sort
    results = results.filter(r => r.similarity >= threshold);
    results.sort((a, b) => b.similarity - a.similarity);
    console.log(`[KnowledgeService] Returning ${results.slice(0, limit).length} results above threshold ${threshold}`);
    return results.slice(0, limit);
  }

  // Extract meaningful keywords from a query string
  private extractKeywords(query: string): string[] {
    // For Chinese text, split into individual characters and multi-char words
    const keywords: string[] = [];
    // Add the full query
    if (query.trim().length > 0) {
      keywords.push(query.trim().toLowerCase());
    }
    // Split by common separators
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
        // Count how many times the keyword appears
        let idx = 0;
        let count = 0;
        while ((idx = lowerContent.indexOf(kw, idx)) !== -1) {
          count++;
          idx += kw.length;
        }
        totalOccurrences += Math.min(count, 5); // Cap at 5 per keyword
      }
    }
    // Score based on keyword coverage and frequency
    const coverageScore = matchCount / keywords.length;
    const frequencyBonus = Math.min(totalOccurrences / (keywords.length * 3), 1);
    return coverageScore * 0.7 + frequencyBonus * 0.3;
  }

  // Get context for chat (RAG) — uses pure semantic search, NO keyword filtering
  // This is deliberately different from user-facing search() which requires keyword matches
  async getContextForQuery(
    query: string,
    knowledgeBaseIds: string[],
    maxTokens: number = 2000
  ): Promise<string> {
    await this.ensureInitialized();
    const allResults: SearchResult[] = [];

    const rawQueryEmbedding = await this.getEmbedding(query);
    const queryEmbedding = deserializeEmbedding(serializeEmbedding(rawQueryEmbedding));

    for (const kbId of knowledgeBaseIds) {
      // Direct semantic search — no keyword filtering for RAG context
      try {
        let chunkSql = `
          SELECT dc.id, dc.document_id, dc.content, dc.embedding, dc.start_index, dc.end_index, dc.page_number, dc.section, dc.created_at,
                 kd.knowledge_base_id, kd.filename, kd.original_name, kd.mime_type, kd.size as doc_size, kd.uploaded_at, kd.updated_at, kd.source, kd.tags, kd.embedding_status, kd.embedding_error
          FROM document_chunks dc
          JOIN knowledge_documents kd ON dc.document_id = kd.id
          WHERE kd.knowledge_base_id = ?
        `;
        const rows = this.db!.all(chunkSql, [kbId]);

        for (const row of rows) {
          const chunkEmbedding = deserializeEmbedding(row.embedding);
          if (chunkEmbedding.length === 0) continue;
          const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
          if (similarity >= 0.1) {
            const chunk: DocumentChunk = { id: row.id, documentId: row.document_id, content: row.content, embedding: [], startIndex: row.start_index, endIndex: row.end_index, pageNumber: row.page_number || undefined, section: row.section || undefined, createdAt: row.created_at };
            const document: KnowledgeDocument = { id: row.document_id, knowledgeBaseId: row.knowledge_base_id, filename: row.filename, originalName: row.original_name, mimeType: row.mime_type, size: row.doc_size, content: '', uploadedAt: row.uploaded_at, updatedAt: row.updated_at, source: row.source || '', tags: row.tags || '[]', embeddingStatus: row.embedding_status as any, embeddingError: row.embedding_error || undefined };
            allResults.push({ chunk, document, similarity });
          }
        }
      } catch (e) {
        console.error(`[KnowledgeService] getContextForQuery failed for KB ${kbId}:`, (e as Error).message);
      }
    }

    allResults.sort((a, b) => b.similarity - a.similarity);
    const topResults = allResults.slice(0, 5);
    console.log(`[KnowledgeService] RAG context: found ${allResults.length} candidates, using top ${topResults.length}`);

    let context = '';
    let tokenCount = 0;

    for (const result of topResults) {
      const chunkText = `[来源: ${result.document.originalName}]\n${result.chunk.content}\n\n`;
      const chunkTokens = chunkText.length / 4;

      if (tokenCount + chunkTokens > maxTokens) break;

      context += chunkText;
      tokenCount += chunkTokens;
    }

    return context;
  }

  // Regenerate embeddings for a document
  async regenerateDocumentEmbeddings(docId: string): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();
    const doc = await this.getDocument(docId);
    if (!doc) {
      return { success: false, error: 'Document not found' };
    }

    console.log(`[KnowledgeService] Regenerating embeddings for document ${doc.originalName}...`);

    let contentToUse = doc.content;

    // If we have the stored original file data, attempt to re-extract content from it.
    // This fixes documents that were previously stored with placeholder text
    // (e.g., "[Word document - content extraction requires mammoth library]").
    try {
      const row = this.db!.get('SELECT file_data, mime_type, original_name FROM knowledge_documents WHERE id = ?', [docId]);
      if (row?.file_data && row.file_data.length > 0) {
        console.log(`[KnowledgeService] Re-extracting content from stored file_data (${row.file_data.length} bytes)...`);
        const reExtracted = await this.extractContent(Buffer.from(row.file_data), row.mime_type, row.original_name);
        if (reExtracted && reExtracted.length > 10) {
          contentToUse = reExtracted;
          // Also update the stored content field so it's correct from now on
          this.db!.run('UPDATE knowledge_documents SET content = ? WHERE id = ?', [contentToUse, docId]);
          console.log(`[KnowledgeService] Content re-extracted successfully (${contentToUse.length} chars)`);
        }
      }
    } catch (e) {
      console.warn('[KnowledgeService] Could not re-extract from file_data, using existing content:', e);
    }

    let success = true;
    let lastError: string | undefined;

    const { chunks, embeddingSuccess, embeddingError } = await this.createChunksWithStatus(contentToUse);
    if (!embeddingSuccess) {
      success = false;
      lastError = embeddingError;
    }

    await this.db!.transaction(() => {
      try {
        this.db!.run('DELETE FROM vec_document_chunks WHERE rowid IN (SELECT rowid FROM document_chunks WHERE document_id = ?)', [docId]);
      } catch (e) { /* vec0 entries may not exist */ }
      this.db!.run('DELETE FROM document_chunks WHERE document_id = ?', [docId]);

      for (const chunk of chunks) {
        chunk.documentId = docId;
        const result = this.db!.run(
          `INSERT INTO document_chunks 
           (id, document_id, content, embedding, start_index, end_index, page_number, section, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id, chunk.documentId, chunk.content,
            serializeEmbedding(chunk.embedding),
            chunk.startIndex, chunk.endIndex, chunk.pageNumber || null, chunk.section || null,
            chunk.createdAt
          ]
        );

        try {
          this.db!.run(
            `INSERT INTO vec_document_chunks (rowid, embedding) VALUES (?, ?)`,
            [result.lastInsertRowid, serializeEmbedding(chunk.embedding)]
          );
        } catch (e) {
          console.warn('[KnowledgeService] Failed to insert vec_document_chunks:', e);
        }
      }

      this.db!.run(
        'UPDATE knowledge_documents SET embedding_status = ?, embedding_error = ?, updated_at = ? WHERE id = ?',
        [success ? 'success' : 'failed', lastError || null, Date.now(), docId]
      );
    });

    this.db!.save();

    console.log(`[KnowledgeService] Embedding regeneration ${success ? 'successful' : 'failed'} for document ${doc.originalName}`);
    return { success, error: lastError };
  }

  // Regenerate embeddings for all documents in a knowledge base
  async regenerateKnowledgeBaseEmbeddings(kbId: string): Promise<{ success: number; failed: number; errors: string[] }> {
    await this.ensureInitialized();
    const kb = await this.getKnowledgeBase(kbId);
    if (!kb) {
      return { success: 0, failed: 0, errors: ['Knowledge base not found'] };
    }

    console.log(`[KnowledgeService] Regenerating embeddings for knowledge base ${kb.name}...`);

    const docs = this.db!.all(
      'SELECT id FROM knowledge_documents WHERE knowledge_base_id = ?',
      [kbId]
    );

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const docRow of docs) {
      const result = await this.regenerateDocumentEmbeddings(docRow.id);
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
        if (result.error) {
          errors.push(`${docRow.id}: ${result.error}`);
        }
      }
    }

    console.log(`[KnowledgeService] Embedding regeneration complete for ${kb.name}: ${successCount} success, ${failedCount} failed`);
    return { success: successCount, failed: failedCount, errors };
  }

  // Get embedding status for a knowledge base
  async getKnowledgeBaseEmbeddingStatus(kbId: string): Promise<{
    total: number;
    success: number;
    failed: number;
    pending: number;
  }> {
    await this.ensureInitialized();
    const kb = await this.getKnowledgeBase(kbId);
    if (!kb) {
      return { total: 0, success: 0, failed: 0, pending: 0 };
    }

    const results = this.db!.all(
      'SELECT embedding_status FROM knowledge_documents WHERE knowledge_base_id = ?',
      [kbId]
    );

    let total = 0;
    let success = 0;
    let failed = 0;
    let pending = 0;

    for (const row of results) {
      total++;
      const status = row.embedding_status;
      if (status === 'success') success++;
      else if (status === 'failed') failed++;
      else pending++;
    }

    return { total, success, failed, pending };
  }
}

export const knowledgeService = new KnowledgeService();
