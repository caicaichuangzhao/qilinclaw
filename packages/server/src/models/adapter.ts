import type { LLMConfig, ChatRequest, ChatResponse, StreamChunk, LLMProvider, ChatMessage } from '../types/index.js';
import path from 'path';
import fs from 'fs';

export interface LLMAdapter {
  readonly config: LLMConfig;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void>;
  isAvailable(): Promise<boolean>;
  getModels(): Promise<string[]>;
}

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAIAdapter(config);
    case 'anthropic':
      return new AnthropicAdapter(config);
    case 'deepseek':
    case 'moonshot':
    case 'zhipu':
    case 'baidu':
    case 'alibaba':
    case 'alibaba-coding':
    case 'xunfei':
    case 'minimax':
    case 'yi':
    case 'baichuan':
    case 'google':
      return new OpenAICompatibleAdapter(config);
    case 'local-ollama':
      return new OllamaAdapter(config);
    case 'local-lmstudio':
      return new LMStudioAdapter(config);

    case 'custom':
    default:
      return new OpenAICompatibleAdapter(config);
  }
}

class OpenAIAdapter implements LLMAdapter {
  readonly config: LLMConfig;
  private client: unknown;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private async getClient() {
    if (!this.client) {
      const { OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl || 'https://api.openai.com/v1',
      });
    }
    return this.client as import('openai').OpenAI;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const response = await client.chat.completions.create({
      model: request.model || this.config.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content || '',
        name: m.name,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls
      } as any)),
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      tools: request.tools as any,
      tool_choice: request.tool_choice as any,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      finishReason: choice.finish_reason,
      tool_calls: choice.message.tool_calls as any,
    };
  }

  async chatStream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    const client = await this.getClient();

    // The OpenAI SDK doesn't natively accept AbortSignal in create() — use a per-request controller
    const ctrl = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    const stream = await client.chat.completions.create({
      model: request.model || this.config.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content || '',
        name: m.name,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls
      } as any)),
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      tools: request.tools as any,
      tool_choice: request.tool_choice as any,
      stream: true,
    }, { signal: ctrl.signal });

    for await (const chunk of stream) {
      if (ctrl.signal.aborted) break;
      const delta = chunk.choices[0]?.delta?.content || '';
      const tool_calls = chunk.choices[0]?.delta?.tool_calls;
      const done = chunk.choices[0]?.finish_reason !== null;
      onChunk({ delta, done, tool_calls: tool_calls as any });
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    const client = await this.getClient();
    const models = await client.models.list();
    return models.data.map(m => m.id);
  }
}

class AnthropicAdapter implements LLMAdapter {
  readonly config: LLMConfig;
  private client: unknown;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private async getClient() {
    if (!this.client) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      this.client = new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
      });
    }
    return this.client as import('@anthropic-ai/sdk').default;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const response = await client.messages.create({
      model: request.model || this.config.model,
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      system: (typeof systemMessage?.content === 'string' ? systemMessage.content : undefined) as any,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : (m.content || ''),
      })) as any,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return {
      content: textBlock ? (textBlock as { text: string }).text : '',
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason || 'stop',
    };
  }

  async chatStream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    const client = await this.getClient();
    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');

    const stream = client.messages.stream({
      model: request.model || this.config.model,
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      system: (typeof systemMessage?.content === 'string' ? systemMessage.content : undefined) as any,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : (m.content || ''),
      })) as any,
    });

    stream.on('text', (text) => {
      onChunk({ delta: text, done: false });
    });

    await stream.finalMessage();
    onChunk({ delta: '', done: true });
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async getModels(): Promise<string[]> {
    return ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
  }
}

class OpenAICompatibleAdapter implements LLMAdapter {
  readonly config: LLMConfig;
  private baseUrl: string;

  constructor(config: LLMConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || this.getDefaultBaseUrl();
    if (!this.baseUrl) {
      throw new Error('Base URL is required for custom provider');
    }
  }

  private getDefaultBaseUrl(): string {
    const providerUrls: Record<string, string> = {
      'deepseek': 'https://api.deepseek.com/v1',
      'moonshot': 'https://api.moonshot.cn/v1',
      'zhipu': 'https://open.bigmodel.cn/api/paas/v4',
      'baidu': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
      'alibaba': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'alibaba-coding': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'google': 'https://generativelanguage.googleapis.com/v1beta',
    };
    return providerUrls[this.config.provider] || '';
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 minutes

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || this.config.model,
          messages: request.messages.map(m => {
            // Support multimodal content (string or content array)
            const content = m.content || '';
            return {
              role: m.role,
              content,
              ...(m.name ? { name: m.name } : {}),
              ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            };
          }),
          max_tokens: request.maxTokens || this.config.maxTokens || 4096,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          tools: request.tools,
          tool_choice: request.tool_choice,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody = '';
        try { errorBody = await response.text(); } catch { }
        console.error(`[LLM] API ${response.status} error body:`, errorBody.substring(0, 500));

        // If the error is about function/tool format and tools were included, retry without tools
        if (response.status === 400 && request.tools && request.tools.length > 0 &&
          (errorBody.includes('function.arguments') || errorBody.includes('InvalidParameter') || errorBody.includes('invalid_parameter'))) {
          console.warn(`[LLM] Model doesn't support tool format, retrying without tools...`);
          clearTimeout(timeout);
          // Recursive retry without tools
          return this.chat({ ...request, tools: undefined, tool_choice: undefined });
        }

        throw new Error(`LLM API error: ${response.status} ${response.statusText}${errorBody ? ' - ' + errorBody.substring(0, 200) : ''}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string; tool_calls?: any[] }; finish_reason: string }>;
        model: string;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const choice = data.choices[0];

      return {
        content: choice.message.content || '',
        model: data.model,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        finishReason: choice.finish_reason,
        tool_calls: choice.message.tool_calls as any,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    console.log('[LLM Adapter] Calling API:', this.baseUrl, 'Model:', this.config.model);
    console.log('[LLM Adapter] API Key exists:', !!this.config.apiKey);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || this.config.model,
          messages: request.messages.map(m => {
            // Support multimodal content (string or content array)
            const content = m.content || '';
            return {
              role: m.role,
              content,
              ...(m.name ? { name: m.name } : {}),
              ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            };
          }),
          max_tokens: request.maxTokens || this.config.maxTokens || 4096,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          tools: request.tools,
          tool_choice: request.tool_choice,
          stream: true,
        }),
        signal,  // ← STOP button abort signal
      });
    } catch (fetchError: any) {
      const errorMsg = this.formatFetchError(fetchError);
      console.error('[LLM Adapter] Fetch error:', errorMsg);
      throw new Error(errorMsg);
    }

    console.log('[LLM Adapter] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[LLM Adapter] Error response:', errorText);
      const errorMsg = this.formatApiError(response.status, errorText);
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('响应体为空，请检查网络连接');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      let chunkCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[LLM Adapter] Stream done, total chunks:', chunkCount);
          onChunk({ delta: '', done: true });
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log('[LLM Adapter] Received [DONE]');
              onChunk({ delta: '', done: true });
              continue;
            }
            try {
              const parsed = JSON.parse(data) as {
                choices: Array<{ delta: { content?: string; tool_calls?: any[] }; finish_reason?: string | null }>;
                error?: { message: string; code: string };
              };

              if (parsed.error) {
                throw new Error(`API错误 [${parsed.error.code}]: ${parsed.error.message}`);
              }

              const delta = parsed.choices[0]?.delta?.content || '';
              const tool_calls = parsed.choices[0]?.delta?.tool_calls;
              const finishReason = parsed.choices[0]?.finish_reason;
              const isDone = finishReason !== null && finishReason !== undefined;
              if (delta) {
                chunkCount++;
                if (chunkCount <= 3) {
                  console.log('[LLM Adapter] Delta chunk:', delta.substring(0, 50));
                }
              }
              if (delta || tool_calls || isDone) {
                onChunk({ delta, done: isDone, tool_calls: tool_calls as any });
              }
            } catch (e) {
              if (e instanceof Error && e.message.startsWith('API错误')) {
                throw e;
              }
              console.warn('[LLM Adapter] Parse error:', e, 'Data:', data.substring(0, 100));
            }
          }
        }
      }
    } catch (error) {
      console.error('[LLM Adapter] Stream error:', error);
      throw error;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore release errors
      }
    }
  }

  private formatFetchError(error: any): string {
    const cause = error.cause;
    if (cause) {
      if (cause.code === 'ENOTFOUND') {
        return `DNS解析失败: 无法找到域名 "${cause.hostname}"，请检查API地址是否正确`;
      }
      if (cause.code === 'ECONNREFUSED') {
        return `连接被拒绝: 无法连接到服务器，请检查服务是否运行`;
      }
      if (cause.code === 'ETIMEDOUT' || cause.code === 'ETIMEDOUT') {
        return `连接超时: 服务器响应时间过长，请检查网络连接`;
      }
      if (cause.code === 'ECONNRESET') {
        return `连接重置: 服务器关闭了连接，请稍后重试`;
      }
    }
    if (error.message?.includes('fetch failed')) {
      return `网络请求失败: 请检查网络连接和API地址是否正确`;
    }
    return `请求失败: ${error.message || '未知错误'}`;
  }

  private formatApiError(status: number, errorText: string): string {
    try {
      const errorJson = JSON.parse(errorText);
      const errorMsg = errorJson.error?.message || errorJson.message || errorText;
      const errorCode = errorJson.error?.code || errorJson.code;

      switch (status) {
        case 400:
          return `请求参数错误 [${errorCode || '400'}]: ${errorMsg}`;
        case 401:
          return `认证失败: API密钥无效或已过期，请检查密钥是否正确`;
        case 403:
          return `访问被拒绝: 没有权限访问此API，请检查账户权限`;
        case 404:
          return `API地址错误: 找不到接口，请检查Base URL是否正确`;
        case 429:
          return `请求过于频繁: 已达到速率限制，请稍后重试`;
        case 500:
          return `服务器内部错误: API服务异常，请稍后重试`;
        case 502:
          return `网关错误: 服务器暂时不可用，请稍后重试`;
        case 503:
          return `服务不可用: API服务正在维护，请稍后重试`;
        default:
          return `API错误 [${status}]: ${errorMsg}`;
      }
    } catch {
      return `API错误 [${status}]: ${errorText.substring(0, 200)}`;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      const data = await response.json() as { data?: Array<{ id: string }> };
      return data.data?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }
}

class OllamaAdapter implements LLMAdapter {
  readonly config: LLMConfig;
  private baseUrl: string;

  constructor(config: LLMConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.config.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          num_predict: request.maxTokens || this.config.maxTokens || 4096,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json() as {
      message: { content: string };
      model: string;
      done: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message.content,
      model: data.model,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      finishReason: data.done ? 'stop' : 'length',
    };
  }

  async chatStream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.config.model,
        messages: request.messages,
        stream: true,
        options: {
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          num_predict: request.maxTokens || this.config.maxTokens || 4096,
        },
      }),
      signal,
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as {
            message?: { content: string };
            done?: boolean;
          };
          if (data.message?.content) {
            onChunk({ delta: data.message.content, done: false });
          }
          if (data.done) {
            onChunk({ delta: '', done: true });
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }
}

class LMStudioAdapter implements LLMAdapter {
  readonly config: LLMConfig;
  private baseUrl: string;

  constructor(config: LLMConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://localhost:1234/v1';
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.config.model,
        messages: request.messages,
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio error: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const choice = data.choices[0];

    return {
      content: choice.message.content,
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      finishReason: choice.finish_reason,
    };
  }

  async chatStream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.config.model,
        messages: request.messages,
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        stream: true,
      }),
      signal,
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            onChunk({ delta: '', done: true });
            continue;
          }
          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string }; finish_reason?: string }>;
            };
            const delta = parsed.choices[0]?.delta?.content || '';
            const isDone = !!parsed.choices[0]?.finish_reason;
            onChunk({ delta, done: isDone });
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      const data = await response.json() as { data?: Array<{ id: string }> };
      return data.data?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }
}



export { OpenAIAdapter, AnthropicAdapter, OpenAICompatibleAdapter, OllamaAdapter, LMStudioAdapter };
