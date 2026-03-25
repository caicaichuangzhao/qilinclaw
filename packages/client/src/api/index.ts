import axios from 'axios';

const isFileProtocol = window.location.protocol === 'file:';
const api = axios.create({
  baseURL: isFileProtocol ? 'http://127.0.0.1:18168/api' : '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export interface LLMConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  enabled: boolean;
}

export interface BotConfig {
  id: string;
  platform: 'discord' | 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'whatsapp' | 'slack' | 'line' | 'messenger' | 'qq' | 'signal' | 'imessage' | 'msteams' | 'googlechat' | 'mattermost';
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  llmConfigId: string;
  agentId?: string;
  systemPrompt?: string;
  allowedChannels?: string[];
  allowedUsers?: string[];
  isRunning?: boolean;
  lastError?: string | null;
  statusData?: Record<string, any>;
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  lastModified: number;
  isDirectory: boolean;
}

export interface SafetyConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  maxFileSize: number;
  maxConcurrentOperations: number;
  enableAutoBackup: boolean;
  maxBackupsPerFile: number;
  autoRecoveryEnabled: boolean;
  healthCheckInterval: number;
  recoveryDelay: number;
  enableProxy?: boolean;
  proxyUrl?: string;
}

export interface SystemStatus {
  healthy: boolean;
  uptime: number;
  activeConnections: number;
  requestsPerMinute: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  activeBots: string[];
  lastError?: string;
}

export const llmApi = {
  getAll: () => api.get<LLMConfig[]>('/models/configs'),
  create: (config: Partial<LLMConfig>) => api.post<LLMConfig>('/models/configs', config),
  update: (id: string, config: Partial<LLMConfig>) => api.put<LLMConfig>(`/models/configs/${id}`, config),
  delete: (id: string) => api.delete(`/models/configs/${id}`),
  chat: (messages: Array<{ role: string; content: string }>, configId?: string, stream = false) =>
    api.post('/models/chat', { messages, configId, stream }),
  getModels: (id: string) => api.get<string[]>(`/models/configs/${id}/models`),
};

export const botApi = {
  getAll: () => api.get<BotConfig[]>('/bots'),
  create: (config: Partial<BotConfig>) => api.post<BotConfig>('/bots', config),
  update: (id: string, config: Partial<BotConfig>) => api.put<BotConfig>(`/bots/${id}`, config),
  delete: (id: string) => api.delete(`/bots/${id}`),
  start: (id: string) => api.post(`/bots/${id}/start`),
  stop: (id: string) => api.post(`/bots/${id}/stop`),
  send: (id: string, channelId: string, content: string) =>
    api.post(`/bots/${id}/send`, { channelId, content }),
};

export const fileApi = {
  list: (path = '') => api.get<FileInfo[]>('/files', { params: { path } }),
  read: (path: string) => api.get<{ content: string; metadata?: Record<string, unknown> }>(`/files/${path}`),
  write: (path: string, content: string, operation = 'edit') =>
    api.put(`/files/${path}`, { content, operation }),
  create: (path: string, content = '') => api.post('/files', { path, content }),
  upload: (path: string, content: string) => api.post('/files', { path, content }),
  delete: (path: string) => api.delete(`/files/${path}`),
  search: (query: string, inContent = false) =>
    api.post<Array<{ file: FileInfo; matches?: string[] }>>('/files/search', { query, inContent }),
};

export const backupApi = {
  getAll: (path?: string) => api.get('/backups', { params: { path } }),
  restore: (id: string) => api.post(`/backups/${id}/restore`),
  delete: (id: string) => api.delete(`/backups/${id}`),
};

export const safetyApi = {
  get: () => api.get<SafetyConfig>('/safety/config'),
  update: (config: Partial<SafetyConfig>) => api.put('/safety/config', config),
};

export const statusApi = {
  get: () => api.get<SystemStatus>('/status'),
  health: () => api.get<Record<string, { status: boolean; lastCheck?: number }>>('/health'),
  errors: (limit = 50) => api.get('/errors', { params: { limit } }),
};

export interface LocalModelInfo {
  name: string;
  path: string;
  dimension: number;
  files: string[];
}

export interface ModelRegistry {
  version: number;
  lastUpdated: number;
  providers: Array<{
    id: string;
    name: string;
    tiers: Array<{
      id: string;
      name: string;
      baseUrl: string;
      models: Array<{
        id: string;
        name: string;
        contextWindow: number;
        price: { inputPer1k: number; outputPer1k: number; currency: string };
      }>;
    }>;
  }>;
}

export const modelRegistryApi = {
  get: () => api.get<ModelRegistry>('/models/registry'),
  update: () => api.post('/models/update'),
};

export const embeddingApi = {
  getLocalModels: () => api.get<{ modelsPath: string; models: LocalModelInfo[]; count: number }>('/memory/embedding/local-models'),
  loadLocalModel: (modelPath: string) => api.post('/memory/embedding/local-models/load', { modelPath }),
  unloadLocalModel: () => api.post('/memory/embedding/local-models/unload'),
};

export default api;
