export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerLabel?: string;
  baseUrl?: string;
  contextLength: number;
  maxOutputTokens: number;
  description: string;
  tags: string[];
  pricing?: {
    input?: number;
    output?: number;
    currency?: string;
  };
}

export const MODEL_DATABASE: ModelInfo[] = [
  // 阿里云Coding Plan专用模型
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3-Coder-Plus',
    provider: 'alibaba-coding',
    providerLabel: '阿里云Coding Plan',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    contextLength: 262144,
    maxOutputTokens: 32768,
    description: '阿里云最强编程模型，原生支持256K上下文',
    tags: ['code', 'agent', 'long-context'],
    pricing: { input: 0.005, output: 0.015, currency: 'CNY' }
  },
  {
    id: 'qwen3-coder-next',
    name: 'Qwen3-Coder-Next',
    provider: 'alibaba-coding',
    providerLabel: '阿里云Coding Plan',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    contextLength: 262144,
    maxOutputTokens: 32768,
    description: '阿里云最新编程模型，支持百万级上下文扩展',
    tags: ['code', 'agent', 'long-context'],
    pricing: { input: 0.01, output: 0.03, currency: 'CNY' }
  },

  // 阿里云百炼平台模型
  {
    id: 'qwen-turbo',
    name: 'Qwen-Turbo',
    provider: 'alibaba',
    providerLabel: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: '通义千问快速版，适合一般对话',
    tags: ['chat', 'fast'],
    pricing: { input: 0.002, output: 0.006, currency: 'CNY' }
  },
  {
    id: 'qwen-plus',
    name: 'Qwen-Plus',
    provider: 'alibaba',
    providerLabel: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: '通义千问增强版，平衡性能与成本',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.004, output: 0.012, currency: 'CNY' }
  },
  {
    id: 'qwen-max',
    name: 'Qwen-Max',
    provider: 'alibaba',
    providerLabel: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 32768,
    maxOutputTokens: 8192,
    description: '通义千问旗舰版，最强能力',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.04, output: 0.12, currency: 'CNY' }
  },
  {
    id: 'qwen2.5-72b-instruct',
    name: 'Qwen2.5-72B-Instruct',
    provider: 'alibaba',
    providerLabel: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: 'Qwen2.5 720亿参数指令模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.006, output: 0.018, currency: 'CNY' }
  },
  {
    id: 'qwen2.5-coder-32b-instruct',
    name: 'Qwen2.5-Coder-32B',
    provider: 'alibaba',
    providerLabel: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 32768,
    maxOutputTokens: 8192,
    description: 'Qwen2.5编程专用模型',
    tags: ['code'],
    pricing: { input: 0.004, output: 0.012, currency: 'CNY' }
  },

  // 智谱AI GLM系列
  {
    id: 'glm-4',
    name: 'GLM-4',
    provider: 'zhipu',
    providerLabel: '智谱AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: '智谱AI旗舰模型，支持长上下文',
    tags: ['chat', 'powerful', 'long-context'],
    pricing: { input: 0.1, output: 0.1, currency: 'CNY' }
  },
  {
    id: 'glm-4-flash',
    name: 'GLM-4-Flash',
    provider: 'zhipu',
    providerLabel: '智谱AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: '智谱AI快速模型，免费额度大',
    tags: ['chat', 'fast', 'free'],
    pricing: { input: 0.0001, output: 0.0001, currency: 'CNY' }
  },
  {
    id: 'glm-4-plus',
    name: 'GLM-4-Plus',
    provider: 'zhipu',
    providerLabel: '智谱AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: '智谱AI增强版模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.05, output: 0.05, currency: 'CNY' }
  },

  // DeepSeek系列
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-Chat',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    contextLength: 65536,
    maxOutputTokens: 8192,
    description: 'DeepSeek对话模型，性价比高',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.001, output: 0.002, currency: 'CNY' } // 假设约 ¥1/¥2 per 1M tokens
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek-Coder',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    contextLength: 65536,
    maxOutputTokens: 8192,
    description: 'DeepSeek编程专用模型',
    tags: ['code'],
    pricing: { input: 0.001, output: 0.002, currency: 'CNY' }
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-Reasoner',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    contextLength: 65536,
    maxOutputTokens: 8192,
    description: 'DeepSeek推理模型',
    tags: ['reasoning'],
    pricing: { input: 0.004, output: 0.016, currency: 'CNY' } // 假设约 ¥4/¥16 per 1M tokens
  },

  // OpenAI系列
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 128000,
    maxOutputTokens: 16384,
    description: 'OpenAI最新多模态模型',
    tags: ['chat', 'multimodal', 'powerful'],
    pricing: { input: 0.0175, output: 0.07, currency: 'USD' } // $2.5 / $10 per 1M -> 0.0025 / 0.01 per 1K
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o-Mini',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 128000,
    maxOutputTokens: 16384,
    description: 'OpenAI轻量级多模态模型',
    tags: ['chat', 'multimodal', 'fast'],
    pricing: { input: 0.00105, output: 0.0042, currency: 'USD' } // $0.150 / $0.600 per 1M -> 0.00015 / 0.0006 per 1K
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4-Turbo',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 128000,
    maxOutputTokens: 4096,
    description: 'GPT-4增强版',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.07, output: 0.21, currency: 'USD' } // $10 / $30 per 1M -> 0.01 / 0.03 per 1K
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5-Turbo',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 16384,
    maxOutputTokens: 4096,
    description: 'OpenAI快速对话模型',
    tags: ['chat', 'fast'],
    pricing: { input: 0.0035, output: 0.0105, currency: 'USD' } // $0.5 / $1.5 per 1M -> 0.0005 / 0.0015 per 1K
  },

  // Claude系列
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    contextLength: 200000,
    maxOutputTokens: 8192,
    description: 'Anthropic最新旗舰模型',
    tags: ['chat', 'powerful', 'long-context'],
    pricing: { input: 0.021, output: 0.105, currency: 'USD' } // Approx $3 / $15 per 1M tokens -> 0.003 / 0.015 per 1K
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    contextLength: 200000,
    maxOutputTokens: 4096,
    description: 'Claude最强模型',
    tags: ['chat', 'powerful', 'long-context'],
    pricing: { input: 0.105, output: 0.525, currency: 'USD' } // Approx $15 / $75 per 1M tokens -> 0.015 / 0.075 per 1K
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    contextLength: 200000,
    maxOutputTokens: 4096,
    description: 'Claude快速轻量模型',
    tags: ['chat', 'fast'],
    pricing: { input: 0.00175, output: 0.00875, currency: 'USD' } // Approx $0.25 / $1.25 per 1M tokens -> 0.00025 / 0.00125 per 1K
  },

  // 月之暗面 Moonshot
  {
    id: 'moonshot-v1-8k',
    name: 'Moonshot-V1-8K',
    provider: 'moonshot',
    providerLabel: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    contextLength: 8192,
    maxOutputTokens: 4096,
    description: '月之暗面Kimi对话模型',
    tags: ['chat'],
    pricing: { input: 0.012, output: 0.012, currency: 'CNY' }
  },
  {
    id: 'moonshot-v1-32k',
    name: 'Moonshot-V1-32K',
    provider: 'moonshot',
    providerLabel: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: 'Kimi长上下文模型',
    tags: ['chat', 'long-context'],
    pricing: { input: 0.024, output: 0.024, currency: 'CNY' }
  },
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot-V1-128K',
    provider: 'moonshot',
    providerLabel: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    contextLength: 131072,
    maxOutputTokens: 4096,
    description: 'Kimi超长上下文模型',
    tags: ['chat', 'long-context'],
    pricing: { input: 0.06, output: 0.06, currency: 'CNY' }
  },

  // DeepSeek Coding Plan
  {
    id: 'deepseek-chat-v3-0324',
    name: 'DeepSeek-V3-0324',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    contextLength: 65536,
    maxOutputTokens: 8192,
    description: 'DeepSeek V3最新版本',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.001, output: 0.002, currency: 'CNY' }
  },

  // OpenAI Coding Plan
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 200000,
    maxOutputTokens: 100000,
    description: 'OpenAI最强推理模型',
    tags: ['reasoning', 'powerful'],
    pricing: { input: 0.015, output: 0.06, currency: 'USD' }
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 200000,
    maxOutputTokens: 100000,
    description: 'OpenAI轻量推理模型',
    tags: ['reasoning', 'fast'],
    pricing: { input: 0.0011, output: 0.0044, currency: 'USD' }
  },

  // Anthropic Coding Plan
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    contextLength: 200000,
    maxOutputTokens: 8192,
    description: 'Anthropic最新旗舰模型，支持扩展思考',
    tags: ['chat', 'powerful', 'reasoning'],
    pricing: { input: 0.003, output: 0.015, currency: 'USD' }
  },

  // 百度文心
  {
    id: 'ernie-4.0-8k',
    name: 'ERNIE-4.0-8K',
    provider: 'baidu',
    providerLabel: '百度文心',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    contextLength: 8192,
    maxOutputTokens: 2048,
    description: '百度文心一言旗舰模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.12, output: 0.12, currency: 'CNY' }
  },
  {
    id: 'ernie-3.5-8k',
    name: 'ERNIE-3.5-8K',
    provider: 'baidu',
    providerLabel: '百度文心',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    contextLength: 8192,
    maxOutputTokens: 2048,
    description: '百度文心一言标准模型',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.012, output: 0.012, currency: 'CNY' }
  },
  {
    id: 'ernie-speed-8k',
    name: 'ERNIE-Speed-8K',
    provider: 'baidu',
    providerLabel: '百度文心',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    contextLength: 8192,
    maxOutputTokens: 2048,
    description: '百度文心快速模型，免费使用',
    tags: ['chat', 'fast', 'free'],
    pricing: { input: 0, output: 0, currency: 'CNY' }
  },

  // 讯飞星火
  {
    id: 'spark-v3.5',
    name: 'Spark-V3.5',
    provider: 'xunfei',
    providerLabel: '讯飞星火',
    baseUrl: 'https://spark-api.xf-yun.com/v3.5',
    contextLength: 8192,
    maxOutputTokens: 4096,
    description: '讯飞星火认知大模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.03, output: 0.03, currency: 'CNY' }
  },
  {
    id: 'spark-v4-ultra',
    name: 'Spark-V4-Ultra',
    provider: 'xunfei',
    providerLabel: '讯飞星火',
    baseUrl: 'https://spark-api.xf-yun.com/v4',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: '讯飞星火V4旗舰模型',
    tags: ['chat', 'powerful', 'long-context'],
    pricing: { input: 0.05, output: 0.05, currency: 'CNY' }
  },

  // MiniMax
  {
    id: 'abab6.5-chat',
    name: 'ABAB-6.5-Chat',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    contextLength: 245760,
    maxOutputTokens: 8192,
    description: 'MiniMax对话模型，支持长上下文',
    tags: ['chat', 'long-context'],
    pricing: { input: 0.03, output: 0.03, currency: 'CNY' }
  },
  {
    id: 'abab6.5s-chat',
    name: 'ABAB-6.5s-Chat',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    contextLength: 245760,
    maxOutputTokens: 8192,
    description: 'MiniMax快速对话模型',
    tags: ['chat', 'fast'],
    pricing: { input: 0.01, output: 0.01, currency: 'CNY' }
  },

  // 零一万物
  {
    id: 'yi-large',
    name: 'Yi-Large',
    provider: 'yi',
    providerLabel: '零一万物',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '零一万物大语言模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.02, output: 0.02, currency: 'CNY' }
  },
  {
    id: 'yi-medium',
    name: 'Yi-Medium',
    provider: 'yi',
    providerLabel: '零一万物',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    contextLength: 16384,
    maxOutputTokens: 4096,
    description: '零一万物中等模型',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.0025, output: 0.0025, currency: 'CNY' }
  },
  {
    id: 'yi-spark',
    name: 'Yi-Spark',
    provider: 'yi',
    providerLabel: '零一万物',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    contextLength: 16384,
    maxOutputTokens: 4096,
    description: '零一万物轻量模型',
    tags: ['chat', 'fast'],
    pricing: { input: 0.001, output: 0.001, currency: 'CNY' }
  },

  // 百川智能
  {
    id: 'baichuan2-turbo',
    name: 'Baichuan2-Turbo',
    provider: 'baichuan',
    providerLabel: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '百川智能对话模型',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.008, output: 0.008, currency: 'CNY' }
  },
  {
    id: 'baichuan4',
    name: 'Baichuan4',
    provider: 'baichuan',
    providerLabel: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '百川智能旗舰模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.1, output: 0.1, currency: 'CNY' }
  },

  // NVIDIA（免费）
  {
    id: 'meta/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B Instruct',
    provider: 'nvidia',
    providerLabel: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    contextLength: 131072,
    maxOutputTokens: 4096,
    description: 'Meta最强开源模型，NVIDIA免费托管',
    tags: ['chat', 'powerful', 'free'],
    pricing: { input: 0, output: 0, currency: 'USD' }
  },
  {
    id: 'meta/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    provider: 'nvidia',
    providerLabel: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    contextLength: 131072,
    maxOutputTokens: 4096,
    description: 'Meta 70B开源模型，NVIDIA免费托管',
    tags: ['chat', 'balanced', 'free'],
    pricing: { input: 0, output: 0, currency: 'USD' }
  },
  {
    id: 'deepseek-ai/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'nvidia',
    providerLabel: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    contextLength: 32768,
    maxOutputTokens: 8192,
    description: 'DeepSeek推理模型，NVIDIA免费托管',
    tags: ['reasoning', 'free'],
    pricing: { input: 0, output: 0, currency: 'USD' }
  },
  {
    id: 'google/gemma-2-27b-it',
    name: 'Gemma 2 27B',
    provider: 'nvidia',
    providerLabel: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    contextLength: 8192,
    maxOutputTokens: 4096,
    description: 'Google Gemma 2 27B，NVIDIA免费托管',
    tags: ['chat', 'free'],
    pricing: { input: 0, output: 0, currency: 'USD' }
  },

  // 火山引擎（字节跳动）
  {
    id: 'doubao-1.5-pro-256k',
    name: 'Doubao-1.5-pro-256k',
    provider: 'volcengine',
    providerLabel: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    contextLength: 262144,
    maxOutputTokens: 16384,
    description: '豆包1.5 Pro，超长上下文256K',
    tags: ['chat', 'powerful', 'long-context'],
    pricing: { input: 0.0008, output: 0.002, currency: 'CNY' }
  },
  {
    id: 'doubao-1.5-pro-32k',
    name: 'Doubao-1.5-pro-32k',
    provider: 'volcengine',
    providerLabel: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    contextLength: 32768,
    maxOutputTokens: 8192,
    description: '豆包1.5 Pro，32K上下文',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.0008, output: 0.002, currency: 'CNY' }
  },
  {
    id: 'doubao-1.5-lite-32k',
    name: 'Doubao-1.5-lite-32k',
    provider: 'volcengine',
    providerLabel: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    contextLength: 32768,
    maxOutputTokens: 8192,
    description: '豆包1.5 Lite，轻量快速',
    tags: ['chat', 'fast'],
    pricing: { input: 0.0003, output: 0.0006, currency: 'CNY' }
  },
  {
    id: 'doubao-1.5-thinking-pro-250k',
    name: 'Doubao-1.5-thinking-pro',
    provider: 'volcengine',
    providerLabel: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    contextLength: 262144,
    maxOutputTokens: 16384,
    description: '豆包1.5深度思考模型',
    tags: ['reasoning', 'powerful'],
    pricing: { input: 0.004, output: 0.016, currency: 'CNY' }
  },

  // Grok（xAI）
  {
    id: 'grok-3',
    name: 'Grok-3',
    provider: 'grok',
    providerLabel: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: 'xAI最强旗舰模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.003, output: 0.015, currency: 'USD' }
  },
  {
    id: 'grok-3-mini',
    name: 'Grok-3-mini',
    provider: 'grok',
    providerLabel: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: 'xAI轻量推理模型',
    tags: ['reasoning', 'fast'],
    pricing: { input: 0.0003, output: 0.0005, currency: 'USD' }
  },
  {
    id: 'grok-2',
    name: 'Grok-2',
    provider: 'grok',
    providerLabel: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    contextLength: 131072,
    maxOutputTokens: 8192,
    description: 'xAI上一代模型',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.002, output: 0.01, currency: 'USD' }
  },

  // 腾讯混元
  {
    id: 'hunyuan-pro',
    name: '混元-Pro',
    provider: 'hunyuan',
    providerLabel: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '腾讯混元旗舰模型',
    tags: ['chat', 'powerful'],
    pricing: { input: 0.03, output: 0.1, currency: 'CNY' }
  },
  {
    id: 'hunyuan-standard',
    name: '混元-Standard',
    provider: 'hunyuan',
    providerLabel: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '腾讯混元标准模型',
    tags: ['chat', 'balanced'],
    pricing: { input: 0.0045, output: 0.005, currency: 'CNY' }
  },
  {
    id: 'hunyuan-lite',
    name: '混元-Lite',
    provider: 'hunyuan',
    providerLabel: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '腾讯混元轻量模型，免费使用',
    tags: ['chat', 'fast', 'free'],
    pricing: { input: 0, output: 0, currency: 'CNY' }
  },
  {
    id: 'hunyuan-turbo',
    name: '混元-Turbo',
    provider: 'hunyuan',
    providerLabel: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '腾讯混元快速模型',
    tags: ['chat', 'fast'],
    pricing: { input: 0.015, output: 0.05, currency: 'CNY' }
  },

  // 本地模型
  {
    id: 'llama3.1-70b',
    name: 'Llama 3.1 70B',
    provider: 'local',
    providerLabel: '本地模型',
    contextLength: 131072,
    maxOutputTokens: 4096,
    description: 'Meta Llama 3.1 700亿参数模型',
    tags: ['local', 'powerful'],
  },
  {
    id: 'llama3.1-8b',
    name: 'Llama 3.1 8B',
    provider: 'local',
    providerLabel: '本地模型',
    contextLength: 131072,
    maxOutputTokens: 4096,
    description: 'Meta Llama 3.1 80亿参数模型',
    tags: ['local', 'fast'],
  },
  {
    id: 'qwen2.5-7b-instruct',
    name: 'Qwen2.5-7B-Instruct',
    provider: 'local',
    providerLabel: '本地模型',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: '通义千问2.5本地版',
    tags: ['local', 'balanced'],
  },
  {
    id: 'mistral-7b-instruct',
    name: 'Mistral-7B-Instruct',
    provider: 'local',
    providerLabel: '本地模型',
    contextLength: 32768,
    maxOutputTokens: 4096,
    description: 'Mistral 70亿参数指令模型',
    tags: ['local', 'fast'],
  },
  {
    id: 'codellama-34b-instruct',
    name: 'CodeLlama-34B-Instruct',
    provider: 'local',
    providerLabel: '本地模型',
    contextLength: 16384,
    maxOutputTokens: 4096,
    description: 'Meta代码专用模型',
    tags: ['local', 'code'],
  },
];

export function findModel(modelId: string): ModelInfo | undefined {
  return MODEL_DATABASE.find(m =>
    m.id.toLowerCase() === modelId.toLowerCase() ||
    m.id.toLowerCase().includes(modelId.toLowerCase()) ||
    modelId.toLowerCase().includes(m.id.toLowerCase())
  );
}

export function getModelsByProvider(provider: string): ModelInfo[] {
  return MODEL_DATABASE.filter(m => m.provider === provider);
}

export function searchModels(query: string): ModelInfo[] {
  const q = query.toLowerCase();
  return MODEL_DATABASE.filter(m =>
    m.id.toLowerCase().includes(q) ||
    m.name.toLowerCase().includes(q) ||
    m.tags.some(t => t.includes(q))
  );
}

import fs from 'fs';
import path from 'path';

const CUSTOM_MODELS_FILE = path.join(process.cwd(), '.qilin-claw', 'custom-models.json');

export function loadCustomModels(): ModelInfo[] {
  try {
    if (fs.existsSync(CUSTOM_MODELS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CUSTOM_MODELS_FILE, 'utf-8'));
      return data.models || [];
    }
  } catch (error) {
    console.error('[Models] Failed to load custom models:', error);
  }
  return [];
}

export function saveCustomModels(models: ModelInfo[]): void {
  try {
    const dir = path.dirname(CUSTOM_MODELS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CUSTOM_MODELS_FILE, JSON.stringify({ models }, null, 2));
  } catch (error) {
    console.error('[Models] Failed to save custom models:', error);
  }
}

export function addCustomModel(model: ModelInfo): void {
  const customModels = loadCustomModels();
  const existingIndex = customModels.findIndex(m => m.id === model.id);
  if (existingIndex >= 0) {
    customModels[existingIndex] = model;
  } else {
    customModels.push(model);
  }
  saveCustomModels(customModels);
  MODEL_DATABASE.push(model);
}

export function removeCustomModel(modelId: string): void {
  const customModels = loadCustomModels();
  const filtered = customModels.filter(m => m.id !== modelId);
  saveCustomModels(filtered);
  const index = MODEL_DATABASE.findIndex(m => m.id === modelId);
  if (index >= 0) {
    MODEL_DATABASE.splice(index, 1);
  }
}

export function getAllModelsWithCustom(): ModelInfo[] {
  const customModels = loadCustomModels();
  const allModels = [...MODEL_DATABASE];
  for (const custom of customModels) {
    if (!allModels.find(m => m.id === custom.id)) {
      allModels.push(custom);
    }
  }
  return allModels;
}
