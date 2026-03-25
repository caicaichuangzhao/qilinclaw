import type { LLMConfig } from '../types/index.js';
import fs from 'fs';
import path from 'path';
import { PythonEmbeddingService } from './python-embedding-service.js';
import { setEmbeddingDimension } from '../utils/vector.js';

export interface EmbeddingConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  dimension?: number;
  localModelPath?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
  source: 'api' | 'local' | 'local-model' | 'cache';
  error?: string;
}

export interface EmbeddingStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  lastError: string | null;
  lastSuccess: number | null;
  totalApiCalls: number;
  totalLocalCalls: number;
  totalCacheHits: number;
  localModelLoaded: boolean;
}

export interface LocalModelInfo {
  name: string;
  path: string;
  dimension: number;
  files: string[];
}

let pythonEmbeddingService: PythonEmbeddingService | null = null;

export class EmbeddingService {
  private config: EmbeddingConfig | null = null;
  private cache: Map<string, number[]> = new Map();
  private maxCacheSize: number = 1000;
  private configPath: string;
  private localModelsPath: string;
  private extractor: any = null;
  private pythonExtractor: PythonEmbeddingService | null = null;
  private modelLoading: boolean = false;
  private status: EmbeddingStatus = {
    configured: false,
    provider: null,
    model: null,
    lastError: null,
    lastSuccess: null,
    totalApiCalls: 0,
    totalLocalCalls: 0,
    totalCacheHits: 0,
    localModelLoaded: false,
  };

  constructor() {
    let currentDir = process.env.WORKSPACE_ROOT || process.cwd();
    let configRoot = path.join(currentDir, '.qilin-claw');

    // Traverse upwards to find .qilin-claw if not found in current dir
    while (!fs.existsSync(configRoot) && currentDir !== path.dirname(currentDir)) {
      currentDir = path.dirname(currentDir);
      configRoot = path.join(currentDir, '.qilin-claw');
    }

    if (!fs.existsSync(configRoot)) {
      // Fallback to original cwd behavior
      configRoot = path.join(process.cwd(), '.qilin-claw');
    }

    this.configPath = path.resolve(configRoot, 'embedding-config.json');
    this.localModelsPath = path.resolve(configRoot, 'local-embedding-models');
    this.loadConfig();
  }

  private loadConfig(): void {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.config = data;
        this.status.configured = true;
        this.status.provider = this.config?.provider || null;
        this.status.model = this.config?.model || null;
        console.log('[EmbeddingService] Loaded config:', this.config?.provider, this.config?.model);
        // Sync dimension globally
        if (this.config?.dimension) {
          setEmbeddingDimension(this.config.dimension);
        }

        if (this.config?.provider === 'local' && (this.config?.localModelPath || this.config?.model)) {
          const modelToLoad = this.config.localModelPath || this.config.model;
          this.loadLocalModel(modelToLoad).catch(err => {
            console.error('[EmbeddingService] Failed to load local model on startup:', err);
          });
        }
      } catch (error) {
        console.error('[EmbeddingService] Failed to load config:', error);
        this.status.lastError = `Failed to load config: ${error}`;
      }
    } else {
      console.log('[EmbeddingService] No config file found, will use local embedding');
    }
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('[EmbeddingService] Config saved:', this.config?.provider, this.config?.model);
    } catch (error) {
      console.error('[EmbeddingService] Failed to save config:', error);
    }
  }

  setConfig(config: EmbeddingConfig): void {
    this.config = {
      ...config,
      dimension: config.dimension && !isNaN(config.dimension) ? config.dimension : 1024,
    };
    this.status.configured = true;
    this.status.provider = this.config.provider;
    this.status.model = this.config.model;
    this.status.lastError = null;
    this.saveConfig();
    this.clearCache();
    // Sync dimension globally
    if (this.config.dimension) {
      setEmbeddingDimension(this.config.dimension);
    }
    console.log('[EmbeddingService] Config updated and cache cleared');

    if (config.provider === 'local' && (config.localModelPath || config.model)) {
      const modelToLoad = config.localModelPath || config.model;
      this.loadLocalModel(modelToLoad).catch(err => {
        console.error('[EmbeddingService] Failed to load local model:', err);
        this.status.lastError = `Failed to load local model: ${err}`;
      });
    }
  }

  getConfig(): EmbeddingConfig | null {
    return this.config;
  }

  getStatus(): EmbeddingStatus {
    return { ...this.status };
  }

  getLocalModelsPath(): string {
    return this.localModelsPath;
  }

  listLocalModels(): LocalModelInfo[] {
    const models: LocalModelInfo[] = [];

    if (!fs.existsSync(this.localModelsPath)) {
      return models;
    }

    const entries = fs.readdirSync(this.localModelsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const modelDir = path.join(this.localModelsPath, entry.name);
      const files = fs.readdirSync(modelDir);

      const hasOnnx = files.some(f => f.endsWith('.onnx') || f.endsWith('.onnx_data'));
      const hasConfig = files.some(f => f === 'config.json' || f === 'tokenizer.json');

      if (hasOnnx || hasConfig) {
        let dimension = 768;
        const configPath = path.join(modelDir, 'config.json');
        if (fs.existsSync(configPath)) {
          try {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            dimension = configData.hidden_size || configData.dim || configData.dimension || 768;
          } catch { }
        }

        models.push({
          name: entry.name,
          path: modelDir,
          dimension,
          files,
        });
      }
    }

    return models;
  }

  async loadLocalModel(modelPath: string): Promise<boolean> {
    try {
      this.modelLoading = true;
      console.log('[EmbeddingService] Loading local model from:', modelPath);

      let actualModelPath = modelPath;

      if (!modelPath.includes(path.sep) && !modelPath.includes('\\') && !modelPath.includes('/')) {
        actualModelPath = path.join(this.localModelsPath, modelPath);
        console.log('[EmbeddingService] Using full path for local folder:', actualModelPath);
      }

      let isDirectory = false;
      try {
        isDirectory = fs.statSync(actualModelPath).isDirectory();
      } catch (err) {
        console.error('[EmbeddingService] Model path does not exist:', actualModelPath);
        throw new Error('Local model path does not exist');
      }

      let hasOnnx = false;

      if (isDirectory) {
        const files = fs.readdirSync(actualModelPath);
        hasOnnx = fs.existsSync(path.join(actualModelPath, 'model.onnx')) ||
          fs.existsSync(path.join(actualModelPath, 'model_quantized.onnx')) ||
          files.some(f => f.endsWith('.onnx'));
      } else {
        hasOnnx = actualModelPath.endsWith('.onnx');

        // For python extractor which expects a directory containing the model
        if (hasOnnx) {
          actualModelPath = path.dirname(actualModelPath);
        }
      }

      if (hasOnnx) {
        console.log('[EmbeddingService] ONNX model detected, using Python embedding service');
        this.pythonExtractor = new PythonEmbeddingService(actualModelPath);
        const success = await this.pythonExtractor.load();

        if (success) {
          this.status.localModelLoaded = true;
          this.modelLoading = false;
          console.log('[EmbeddingService] Python embedding service loaded successfully');
          return true;
        } else {
          console.warn('[EmbeddingService] Failed to load Python embedding service, falling back to transformers.js');
          this.pythonExtractor = null;
          // Continue execution to try HF transformers
        }
      }

      try {
        const { pipeline, env } = await import('@huggingface/transformers');

        env.allowLocalModels = true;

        const isHuggingFaceModel = modelPath.includes('/') && !modelPath.includes('\\') && !modelPath.includes(path.sep);

        if (isHuggingFaceModel) {
          env.allowRemoteModels = true;
          console.log('[EmbeddingService] HuggingFace model detected, remote models enabled');

          this.extractor = await pipeline('feature-extraction', modelPath);
        } else {
          env.allowRemoteModels = false;
          console.log('[EmbeddingService] Local model detected, remote models disabled');

          env.localModelPath = path.dirname(actualModelPath);
          console.log('[EmbeddingService] Set env.localModelPath to:', env.localModelPath);

          const folderName = path.basename(actualModelPath);
          console.log('[EmbeddingService] Using folder name for pipeline:', folderName);

          this.extractor = await pipeline('feature-extraction', folderName);
        }

        this.status.localModelLoaded = true;
        this.modelLoading = false;
        console.log('[EmbeddingService] Local model loaded successfully');
        return true;
      } catch (transformersError) {
        console.warn('[EmbeddingService] Transformers.js failed, falling back to simple embedding:', transformersError);
        this.status.localModelLoaded = false;
        this.modelLoading = false;
        return false;
      }
    } catch (error) {
      console.error('[EmbeddingService] Failed to load local model:', error);
      this.status.lastError = `Failed to load model: ${error}`;
      this.status.localModelLoaded = false;
      this.modelLoading = false;
      return false;
    }
  }

  unloadLocalModel(): void {
    this.extractor = null;
    if (this.pythonExtractor) {
      this.pythonExtractor.unload();
    }
    this.pythonExtractor = null;
    this.status.localModelLoaded = false;
    console.log('[EmbeddingService] Local model unloaded');
  }

  private getCacheKey(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(text).digest('hex');
  }

  private addToCache(text: string, embedding: number[]): void {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(this.getCacheKey(text), embedding);
  }

  private getFromCache(text: string): number[] | null {
    return this.cache.get(this.getCacheKey(text)) || null;
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    // Check cache first
    const cached = this.getFromCache(text);
    if (cached) {
      this.status.totalCacheHits++;
      return {
        embedding: cached,
        tokenCount: Math.ceil(text.length / 4),
        source: 'cache'
      };
    }

    return await this._generateEmbeddingCore(text);
  }

  private async _generateEmbeddingCore(text: string): Promise<EmbeddingResult> {

    // Block execution until the local model physically finishes loading into RAM/VRAM
    if (this.modelLoading) {
      console.log('[EmbeddingService] Model is currently loading, waiting for it to finish...');
      let attempts = 0;
      while (this.modelLoading && attempts < 100) { // 10s max timeout
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }

    // If we have a Python embedding service loaded, use it
    if (this.pythonExtractor && this.pythonExtractor.isReady()) {
      try {
        console.log('[EmbeddingService] Using Python embedding service');
        const startTime = Date.now();
        const embedding = await this.pythonExtractor.generateEmbedding(text);
        const latency = Date.now() - startTime;

        console.log(`[EmbeddingService] Python embedding service generated embedding (${latency}ms, dim: ${embedding.length})`);

        this.status.totalLocalCalls++;
        this.status.lastSuccess = Date.now();
        this.status.lastError = null;

        const result = {
          embedding,
          tokenCount: Math.ceil(text.length / 4),
          source: 'local-model' as const
        };

        this.addToCache(text, embedding);
        return result;
      } catch (error) {
        console.error('[EmbeddingService] Python embedding service failed, falling back:', error);
        this.status.lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // If we have another local model loaded, use it
    if (this.extractor) {
      try {
        console.log('[EmbeddingService] Using local model for embedding');
        const startTime = Date.now();
        const pooling = this.config?.model?.includes('Qwen3-Embedding') ? 'last_token' : 'mean';
        const output = await this.extractor(text, { pooling: pooling, normalize: true });
        const latency = Date.now() - startTime;

        const embedding = Array.from(output.data as Float32Array);

        console.log(`[EmbeddingService] Local model embedding generated (${latency}ms, dim: ${embedding.length})`);

        this.status.totalLocalCalls++;
        this.status.lastSuccess = Date.now();
        this.status.lastError = null;

        const result = {
          embedding,
          tokenCount: Math.ceil(text.length / 4),
          source: 'local-model' as const
        };

        this.addToCache(text, embedding);
        return result;
      } catch (error) {
        console.error('[EmbeddingService] Local model embedding failed, falling back:', error);
        this.status.lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!this.config) {
      console.log('[EmbeddingService] No config, using simple local embedding');
      this.status.totalLocalCalls++;
      const result = await this.generateSimpleLocalEmbedding(text);
      this.addToCache(text, result.embedding);
      return result;
    }

    // If provider is local but no model loaded, use simple local embedding
    if (this.config.provider === 'local' && !this.extractor) {
      console.log('[EmbeddingService] Provider is local but no model loaded, using simple local embedding');
      this.status.totalLocalCalls++;
      const result = await this.generateSimpleLocalEmbedding(text);
      this.addToCache(text, result.embedding);
      return result;
    }

    try {
      console.log(`[EmbeddingService] Calling API (${this.config.provider}/${this.config.model})...`);
      const result = await this.generateAPIEmbedding(text);
      this.addToCache(text, result.embedding);
      this.status.lastSuccess = Date.now();
      this.status.lastError = null;
      this.status.totalApiCalls++;
      console.log(`[EmbeddingService] API call successful, embedding dimension: ${result.embedding.length}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[EmbeddingService] API call failed: ${errorMessage}`);
      this.status.lastError = errorMessage;
      this.status.totalLocalCalls++;
      console.log('[EmbeddingService] Falling back to local embedding');
      const localResult = await this.generateSimpleLocalEmbedding(text);
      localResult.error = errorMessage;
      this.addToCache(text, localResult.embedding);
      return localResult;
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.config) {
      console.log('[EmbeddingService] No config, using local embedding for batch');
      this.status.totalLocalCalls += texts.length;
      const results = await Promise.all(texts.map(t => this.generateSimpleLocalEmbedding(t)));
      // Cache results
      for (let i = 0; i < texts.length; i++) {
        this.addToCache(texts[i], results[i].embedding);
      }
      return results;
    }

    // If provider is local, use simple local embedding directly for batch
    if (this.config.provider === 'local') {
      console.log(`[EmbeddingService] Provider is local, using simple local embedding for batch`);
      this.status.totalLocalCalls += texts.length;
      const results = await Promise.all(texts.map(t => this.generateSimpleLocalEmbedding(t)));
      // Cache results
      for (let i = 0; i < texts.length; i++) {
        this.addToCache(texts[i], results[i].embedding);
      }
      return results;
    }

    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];
    const results: EmbeddingResult[] = new Array(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const cached = this.getFromCache(texts[i]);
      if (cached) {
        this.status.totalCacheHits++;
        results[i] = {
          embedding: cached,
          tokenCount: Math.ceil(texts[i].length / 4),
          source: 'cache'
        };
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    if (uncachedTexts.length === 0) {
      return results;
    }

    try {
      console.log(`[EmbeddingService] Batch API call for ${uncachedTexts.length} texts...`);
      let apiResults: EmbeddingResult[];
      apiResults = await this.generateBatchAPIEmbeddings(uncachedTexts);

      for (let i = 0; i < uncachedTexts.length; i++) {
        const originalIndex = uncachedIndices[i];
        results[originalIndex] = apiResults[i];
        this.addToCache(uncachedTexts[i], apiResults[i].embedding);
      }

      this.status.lastSuccess = Date.now();
      this.status.lastError = null;
      this.status.totalApiCalls++;
      console.log(`[EmbeddingService] Batch API call successful`);
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[EmbeddingService] Batch API call failed: ${errorMessage}`);
      this.status.lastError = errorMessage;
      this.status.totalLocalCalls += uncachedTexts.length;

      for (let i = 0; i < uncachedTexts.length; i++) {
        const originalIndex = uncachedIndices[i];
        const localResult = await this.generateSimpleLocalEmbedding(uncachedTexts[i]);
        localResult.error = errorMessage;
        results[originalIndex] = localResult;
        this.addToCache(uncachedTexts[i], localResult.embedding);
      }

      return results;
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    if (!this.config) {
      return { success: false, error: 'No embedding configuration set' };
    }

    // If provider is local, test simple local embedding
    if (this.config.provider === 'local') {
      const testText = 'Hello, this is a test.';
      const startTime = Date.now();
      try {
        await this.generateSimpleLocalEmbedding(testText);
        const latency = Date.now() - startTime;
        console.log(`[EmbeddingService] Local embedding test successful (${latency}ms)`);
        return { success: true, latency };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    }

    const testText = 'Hello, this is a test.';
    const startTime = Date.now();

    try {
      console.log(`[EmbeddingService] Testing connection to ${this.config.provider}...`);
      const result = await this.generateAPIEmbedding(testText);
      const latency = Date.now() - startTime;
      console.log(`[EmbeddingService] Connection test successful (${latency}ms)`);
      return { success: true, latency };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[EmbeddingService] Connection test failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  private async generateLocalModelEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.extractor) {
      throw new Error('Local model not loaded');
    }

    const startTime = Date.now();
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    const latency = Date.now() - startTime;

    const embedding = Array.from(output.data as Float32Array);

    console.log(`[EmbeddingService] Local model embedding generated (${latency}ms, dim: ${embedding.length})`);

    return {
      embedding,
      tokenCount: Math.ceil(text.length / 4),
      source: 'local-model',
    };
  }

  private async generateAPIEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.config) throw new Error('No embedding config');

    const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();
    const url = `${baseUrl}/embeddings`;

    console.log(`[EmbeddingService] Requesting: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
      }),
    });

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorDetail = errorData.error?.message || errorData.message || errorDetail;
      } catch {
        errorDetail = await response.text() || errorDetail;
      }
      throw new Error(`Embedding API error: ${errorDetail}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      usage: { total_tokens: number };
    };

    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw new Error('Invalid response from embedding API: missing embedding data');
    }

    return {
      embedding: data.data[0].embedding,
      tokenCount: data.usage.total_tokens,
      source: 'api',
    };
  }

  private async generateBatchAPIEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.config) throw new Error('No embedding config');

    const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorDetail = errorData.error?.message || errorData.message || errorDetail;
      } catch {
        errorDetail = await response.text() || errorDetail;
      }
      throw new Error(`Batch embedding API error: ${errorDetail}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { total_tokens: number };
    };

    if (!data.data || data.data.length === 0) {
      throw new Error('Invalid response from batch embedding API: missing data');
    }

    const results = data.data.sort((a, b) => a.index - b.index);
    const avgTokens = Math.ceil(data.usage.total_tokens / texts.length);

    return results.map(r => ({
      embedding: r.embedding,
      tokenCount: avgTokens,
      source: 'api' as const,
    }));
  }

  private getDefaultBaseUrl(): string {
    if (!this.config) return 'https://api.openai.com/v1';

    const providerUrls: Record<string, string> = {
      'openai': 'https://api.openai.com/v1',
      'deepseek': 'https://api.deepseek.com/v1',
      'zhipu': 'https://open.bigmodel.cn/api/paas/v4',
      'moonshot': 'https://api.moonshot.cn/v1',
      'nvidia': 'https://integrate.api.nvidia.com/v1',
    };

    return providerUrls[this.config.provider] || this.config.baseUrl || 'https://api.openai.com/v1';
  }

  private async generateSimpleLocalEmbedding(text: string): Promise<EmbeddingResult> {
    const dimension = this.config?.dimension || 1024;
    const embedding = this.simpleTextToVector(text, dimension);

    return {
      embedding,
      tokenCount: Math.ceil(text.length / 4),
      source: 'local',
    };
  }

  private simpleTextToVector(text: string, dimension: number): number[] {
    const vector: number[] = new Array(dimension).fill(0);

    const tokens: string[] = [];
    let currentWord = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i].toLowerCase();
      if (/[a-z0-9]/.test(char)) {
        currentWord += char;
      } else {
        if (currentWord) {
          tokens.push(currentWord);
          currentWord = '';
        }
        if (!/\s/.test(char)) {
          tokens.push(char);
        }
      }
    }
    if (currentWord) tokens.push(currentWord);

    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i];
      let hash = 0;

      for (let j = 0; j < word.length; j++) {
        const char = word.charCodeAt(j);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }

      const pos1 = Math.abs(hash) % dimension;
      const pos2 = Math.abs(hash >> 8) % dimension;
      const pos3 = Math.abs(hash >> 16) % dimension;

      vector[pos1] += 0.3;
      vector[pos2] += 0.2;
      vector[pos3] += 0.1;

      if (i > 0) {
        const prevWord = tokens[i - 1];
        const combined = prevWord + word;
        let combinedHash = 0;
        for (let j = 0; j < combined.length; j++) {
          combinedHash = ((combinedHash << 5) - combinedHash) + combined.charCodeAt(j);
          combinedHash = combinedHash & combinedHash;
        }
        const pos = Math.abs(combinedHash) % dimension;
        vector[pos] += 0.15;
      }
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[EmbeddingService] Cache cleared');
  }

  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }
}

export const embeddingService = new EmbeddingService();
