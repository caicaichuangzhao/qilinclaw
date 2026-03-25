export type ModelType = 'chat' | 'vision' | 'image-gen' | 'audio-tts' | 'audio-stt' | 'video-gen';

export interface LLMConfig {
  id: string;
  name: string;
  provider: LLMProvider;
  modelType?: ModelType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  maxContextTokens?: number;
  temperature?: number;
  enabled: boolean;
  modelPath?: string;
  // Media model specific configs
  imageSize?: string;       // image-gen: default size e.g. "1024x1024"
  voice?: string;           // audio-tts: voice preset
  responseFormat?: string;  // audio-tts: mp3/wav/opus/pcm
}

export type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'baidu'
  | 'alibaba'
  | 'local-ollama'
  | 'local-lmstudio'
  | 'local-native'
  | 'custom'
  | 'alibaba-coding'
  | 'xunfei'
  | 'minimax'
  | 'yi'
  | 'baichuan';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string; // Often used with tool roles to identify the tool
  timestamp?: number;
  attachments?: Array<{ name: string; type: string; dataUrl: string }>;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>; // JSON Schema
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  tool_calls?: ToolCall[];
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface BotConfig {
  id: string;
  platform: BotPlatform;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  llmConfigId: string;
  agentId?: string;
  systemPrompt?: string;
  allowedChannels?: string[];
  allowedUsers?: string[];
  isRunning?: boolean;
}

export type BotPlatform =
  | 'discord'
  | 'telegram'
  | 'wechat'
  | 'feishu'
  | 'dingtalk'
  | 'wecom'
  | 'whatsapp'
  | 'slack'
  | 'line'
  | 'messenger'
  | 'qq'
  | 'signal'
  | 'imessage'
  | 'msteams'
  | 'googlechat'
  | 'mattermost';

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  lastModified: number;
  isDirectory: boolean;
}

export interface FileEdit {
  path: string;
  content: string;
  encoding?: string;
}

export interface FileBackup {
  id: string;
  path: string;
  originalContent: string;
  timestamp: number;
  operation: string;
  conversationId?: string;
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
  recoveryDelay: number; // 恢复延迟时间（毫秒）
  enableProxy?: boolean;
  proxyUrl?: string;
}

export interface SystemStatus {
  healthy: boolean;
  uptime: number;
  activeConnections: number;
  requestsPerMinute: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeBots: string[];
  lastError?: string;
}

export interface ConversationContext {
  id: string;
  platform: BotPlatform;
  channelId: string;
  userId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}
