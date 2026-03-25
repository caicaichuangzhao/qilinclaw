<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { llmApi, type LLMConfig as modelConfig, modelRegistryApi } from '@/api';
import { Plus, Cpu, Trash2, Edit3, ShieldCheck, X, Activity, Zap, RefreshCw } from 'lucide-vue-next';
import CustomSelect from '../components/CustomSelect.vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  contextLength: number;
  maxOutputTokens: number;
  description: string;
  tags: string[];
}

interface ProviderOption {
  value: string;
  label: string;
  baseUrl?: string;
}

const configs = ref<modelConfig[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingConfig = ref<modelConfig | null>(null);
const testingConnection = ref(false);
const testResult = ref<{ success: boolean; message: string } | null>(null);
const modelDatabase = ref<ModelInfo[]>([]);
const providerOptions = ref<ProviderOption[]>([]);

const modelTypeOptions = [
  { value: 'chat', label: '💬 对话模型' },
  { value: 'vision', label: '👁️ 视觉/多模态' },
  { value: 'image-gen', label: '🖼️ 图像生成' },
  { value: 'audio-tts', label: '🔊 语音合成 (TTS)' },
  { value: 'audio-stt', label: '🎙️ 语音识别 (STT)' },
  { value: 'video-gen', label: '🎬 视频生成' },
];

const imageSizeOptions = [
  { value: 'dynamic', label: '✨ 动态解析 (根据提示词推断比例)' },
  { value: '1024x1024', label: '1024x1024 (1:1)' },
  { value: '1328x1328', label: '1328x1328 (1:1 高清)' },
  { value: '1664x928', label: '1664x928 (16:9 电脑宽屏)' },
  { value: '928x1664', label: '928x1664 (9:16 手机竖屏)' },
  { value: '1472x1140', label: '1472x1140 (4:3)' },
  { value: '1584x1056', label: '1584x1056 (3:2)' },
];

const audioFormatOptions = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'opus', label: 'Opus' },
  { value: 'flac', label: 'FLAC' },
];



const formData = ref({
  name: '',
  provider: 'openai',
  modelType: 'chat',
  apiKey: '',
  baseUrl: '',
  model: '',
  maxTokens: 4096,
  temperature: 0.7,
  enabled: true,
  imageSize: '1024x1024',
  voice: '',
  responseFormat: 'mp3',
});



async function loadProviderOptions() {
  try {
    const response = await modelRegistryApi.get();
    const registry = response.data;
    const options: ProviderOption[] = [];
    
    // 从注册表添加供应商
    for (const provider of registry.providers) {
      const baseUrl = provider.tiers[0]?.baseUrl || '';
      options.push({
        value: provider.id,
        label: provider.name,
        baseUrl
      });
    }
    
    // 添加本地供应商
    options.push(
      { value: 'local-ollama', label: 'Ollama (本地)', baseUrl: 'http://localhost:11434' },
      { value: 'local-lmstudio', label: 'LM Studio (本地)', baseUrl: 'http://localhost:1234/v1' },
      { value: 'custom', label: '自定义 API', baseUrl: '' }
    );
    
    providerOptions.value = options;
  } catch (error) {
    console.error('Failed to load provider options:', error);
    // 如果加载失败，使用默认选项
    providerOptions.value = [
      { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
      { value: 'moonshot', label: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1' },
      { value: 'zhipu', label: '智谱 AI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      { value: 'aliyun', label: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { value: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1' },
      { value: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
      { value: 'nvidia', label: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1' },
      { value: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { value: 'baichuan', label: '百川智能', baseUrl: 'https://api.baichuan-ai.com/v1' },
      { value: 'stepfun', label: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1' },
      { value: '01ai', label: '零一万物', baseUrl: 'https://api.lingyiwanwu.com/v1' },
      { value: 'internlm', label: '书生·浦语', baseUrl: 'https://internlm-chat.intern-ai.org.cn/puyu/api/v1' },
      { value: 'chatglm', label: 'ChatGLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      { value: 'local-ollama', label: 'Ollama (本地)', baseUrl: 'http://localhost:11434' },
      { value: 'local-lmstudio', label: 'LM Studio (本地)', baseUrl: 'http://localhost:1234/v1' },
      { value: 'custom', label: '自定义 API', baseUrl: '' },
    ];
  }
}

onMounted(async () => {
  await Promise.all([loadConfigs(), loadModelDatabase(), loadProviderOptions()]);
});

watch(() => formData.value.provider, async (newProvider) => {
  const provider = providerOptions.value.find(p => p.value === newProvider);
  if (provider && provider.baseUrl) {
    formData.value.baseUrl = provider.baseUrl;
  }
  formData.value.model = '';
  
  if (editingConfig.value) {
    if (!formData.value.model) formData.value.model = editingConfig.value.model;
  }
});

async function loadModelDatabase() {
  try {
    const response = await modelRegistryApi.get();
    const registry = response.data;
    
    const models: ModelInfo[] = [];
    if (registry && registry.providers) {
      registry.providers.forEach((provider: any) => {
        provider.tiers.forEach((tier: any) => {
          tier.models.forEach((model: any) => {
            models.push({
              id: model.id,
              name: model.name,
              provider: provider.id,
              baseUrl: tier.baseUrl,
              contextLength: model.contextWindow,
              maxOutputTokens: Math.min(model.contextWindow, 8192),
              description: `${tier.name} - ${model.price ? `In/Out: ${model.price.inputPer1k}/${model.price.outputPer1k} ${model.price.currency}` : ''}`,
              tags: [provider.name, tier.name]
            });
          });
        });
      });
    }
    modelDatabase.value = models;
  } catch (error) {
    console.error('Failed to load model database:', error);
  }
}



const syncingModels = ref(false);
async function syncModels() {
  syncingModels.value = true;
  try {
    const response = await modelRegistryApi.update();
    const result = response.data;
    if (result.success) {
      alert(result.message);
      await Promise.all([loadModelDatabase(), loadProviderOptions()]);
    } else {
      alert('同步失败: ' + result.message);
    }
  } catch (error) {
    console.error('Sync error:', error);
    alert('同步失败：网络错误\n\n可能原因：\n1. 服务器未启动或无法访问\n2. 网络连接不稳定\n3. 防火墙阻止了 API 访问\n\n请检查网络连接后重试');
  } finally {
    syncingModels.value = false;
  }
}

watch(() => formData.value.model, (newModel) => {
  if (newModel && modelDatabase.value.length > 0) {
    const modelInfo = modelDatabase.value.find(m => 
      m.id.toLowerCase() === newModel.toLowerCase() ||
      m.id.toLowerCase().includes(newModel.toLowerCase()) ||
      newModel.toLowerCase().includes(m.id.toLowerCase())
    );
    if (modelInfo) {
      formData.value.maxTokens = modelInfo.maxOutputTokens;
      if (modelInfo.baseUrl) {
        formData.value.baseUrl = modelInfo.baseUrl;
      }
    }
  }
});
async function loadConfigs() {
  loading.value = true;
  try {
    const response = await llmApi.getAll();
    configs.value = response.data;
  } catch (error) {
    console.error('Failed to load configs:', error);
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingConfig.value = null;
  const defaultProvider = providerOptions.value[0];
  formData.value = {
    name: '',
    provider: defaultProvider?.value || 'openai',
    modelType: 'chat',
    apiKey: '',
    baseUrl: defaultProvider?.baseUrl || '',
    model: '',
    maxTokens: 4096,
    temperature: 0.7,
    enabled: true,
    imageSize: '1024x1024',
    voice: '',
    responseFormat: 'mp3',
  };
  testResult.value = null;
  showModal.value = true;
}

function openEditModal(config: modelConfig) {
  editingConfig.value = config;
  formData.value = {
    name: config.name,
    provider: config.provider,
    modelType: (config as any).modelType || 'chat',
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || '',
    model: config.model,
    maxTokens: config.maxTokens || 4096,
    temperature: config.temperature || 0.7,
    enabled: config.enabled,
    imageSize: (config as any).imageSize || '1024x1024',
    voice: (config as any).voice || '',
    responseFormat: (config as any).responseFormat || 'mp3',
  };
  testResult.value = null;
  showModal.value = true;
}

function onProviderChange() {
  const provider = providerOptions.value.find(p => p.value === formData.value.provider);
  if (provider && provider.baseUrl) {
    formData.value.baseUrl = provider.baseUrl;
  }
}

async function saveConfig() {
  try {
    if (!formData.value.name || !formData.value.model) {
      alert('请填写配置名称和模型名称');
      return;
    }

    const config: Partial<modelConfig> & Record<string, any> = {
      name: formData.value.name,
      provider: formData.value.provider as modelConfig['provider'],
      modelType: formData.value.modelType,
      apiKey: formData.value.apiKey || undefined,
      baseUrl: formData.value.baseUrl || undefined,
      model: formData.value.model,
      maxTokens: formData.value.maxTokens,
      temperature: formData.value.temperature,
      enabled: formData.value.enabled,
      imageSize: formData.value.modelType === 'image-gen' ? formData.value.imageSize : undefined,
      voice: formData.value.modelType === 'audio-tts' ? formData.value.voice : undefined,
      responseFormat: formData.value.modelType === 'audio-tts' ? formData.value.responseFormat : undefined,
    };

    if (editingConfig.value) {
      if (!config.apiKey) {
        delete config.apiKey;
      }
      await llmApi.update(editingConfig.value.id, config);
      alert('配置已更新');
    } else {
      await llmApi.create(config);
      alert('配置已创建');
    }

    showModal.value = false;
    await loadConfigs();
  } catch (error: any) {
    console.error('Failed to save config:', error);
    alert('保存失败: ' + (error.message || '未知错误'));
  }
}

async function deleteConfig(id: string) {
  if (!confirm(t('models.deleteConfirm'))) return;
  try {
    await llmApi.delete(id);
    await loadConfigs();
  } catch (error) {
    console.error('Failed to delete config:', error);
  }
}

async function testConnection() {
  if (!formData.value.baseUrl || !formData.value.apiKey || !formData.value.model) {
    testResult.value = {
      success: false,
      message: '请先填写API地址、API密钥和模型名称',
    };
    return;
  }
  
  testingConnection.value = true;
  testResult.value = null;
  try {
    const response = await fetch('/api/models/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: formData.value.baseUrl,
        apiKey: formData.value.apiKey || '',
        model: formData.value.model,
        provider: formData.value.provider,
      }),
    });
    
    const data = await response.json();
    testResult.value = {
      success: data.success,
      message: data.success 
        ? `✅ ${data.message}\n模型回复: ${data.reply}`
        : `❌ ${data.error}`,
    };
  } catch (error) {
    testResult.value = {
      success: false,
      message: `❌ 连接失败: ${(error as Error).message}`,
    };
  } finally {
    testingConnection.value = false;
  }
}

async function testExistingConfig(id: string) {
  try {
    const response = await fetch(`/api/models/test/${id}`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      alert(`✅ 连接成功！\n模型回复: ${data.reply}`);
    } else {
      alert(`❌ 连接失败: ${data.error}`);
    }
  } catch (error) {
    alert(`❌ 测试失败: ${(error as Error).message}`);
  }
}

function getProviderLabel(provider: string): string {
  return providerOptions.value.find(p => p.value === provider)?.label || provider;
}



const modelSuggestions = computed(() => {
  if (modelDatabase.value.length > 0) {
    const provider = formData.value.provider;
    const providerMap: Record<string, string> = {
      'openai': 'openai',
      'anthropic': 'anthropic',
      'deepseek': 'deepseek',
      'moonshot': 'moonshot',
      'zhipu': 'zhipu',
      'baidu': 'baidu',
      'alibaba': 'alibaba',
      'alibaba-coding': 'alibaba-coding',
      'xunfei': 'xunfei',
      'minimax': 'minimax',
      'yi': 'yi',
      'baichuan': 'baichuan',
      'local-ollama': 'local',
      'local-lmstudio': 'local',
    };
    const targetProvider = providerMap[provider] || provider;
    const filtered = modelDatabase.value.filter(m => m.provider === targetProvider);
    if (filtered.length > 0) {
      return filtered.map(m => m.id);
    }
  }
  return [];
});
</script>

<template>
  <div class="flex-1 bg-white/[0.02] border border-white/[0.05] rounded-[2rem] backdrop-blur-2xl flex flex-col overflow-hidden shadow-2xl relative h-full">
    
    <header class="h-24 flex items-center justify-between px-8 border-b border-white/[0.05] shrink-0">
      <div>
        <h1 class="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500 mb-1 flex items-center gap-2">{{ t('models.title') }}</h1>
        <p class="text-zinc-500 text-sm">{{ t('models.subtitle') }}</p>
      </div>
      <div class="flex gap-4">
        <button @click="syncModels" :disabled="syncingModels" class="flex items-center gap-2 px-5 py-2.5 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 font-bold rounded-xl text-sm transition-all border border-white/[0.05] active:scale-95">
          <Activity :size="16" :class="{ 'animate-spin': syncingModels }" /> 
          {{ syncingModels ? t('models.syncing') : t('models.syncModels') }}
        </button>
        <button @click="openCreateModal" class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-bold rounded-xl text-sm transition-all shadow-lg shadow-amber-500/20 active:scale-95">
          <Plus :size="16" /> {{ t('models.addConfig') }}
        </button>
      </div>
    </header>

    <div class="p-8 flex-1 overflow-y-auto custom-scrollbar">
      <div v-if="loading" class="text-center py-12 flex justify-center">
        <div class="animate-spin h-8 w-8 border-4 border-emerald-500/50 border-t-emerald-500 rounded-full mx-auto"></div>
      </div>
      <div v-else-if="configs.length === 0" class="flex flex-col items-center justify-center h-64 text-zinc-500">
        <Cpu :size="48" class="text-zinc-600 mb-4 opacity-50" />
        <p class="mb-4 text-zinc-400">暂无语言模型配置</p>
        <button @click="openCreateModal" class="flex items-center gap-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm font-medium transition-colors border border-white/[0.05]">
          <Plus :size="16" /> 添加第一个配置
        </button>
      </div>
      <div v-else class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
        <div
          v-for="config in configs"
          :key="config.id"
          class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner hover:border-white/[0.1] transition-colors flex flex-col group"
        >
          <div class="flex justify-between items-start mb-6">
            <div class="flex items-center gap-4 min-w-0">
              <div class="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-zinc-300 shadow-md shrink-0">
                <Cpu v-if="config.provider.includes('local')" :size="24" class="text-amber-400" />
                <Zap v-else :size="24" class="text-amber-400" />
              </div>
              <div class="overflow-hidden min-w-0 flex-1">
                <h4 class="font-bold text-white text-lg truncate whitespace-nowrap overflow-hidden text-ellipsis">{{ config.name }}</h4>
                <p class="text-xs text-zinc-500 mt-0.5 truncate">{{ getProviderLabel(config.provider) }}</p>
              </div>
            </div>
            <span :class="`w-20 h-8 flex items-center justify-center gap-1.5 rounded text-[11px] font-medium border shrink-0 ${config.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'}`">
              <div :class="`w-1.5 h-1.5 rounded-full ${config.enabled ? 'bg-emerald-400' : 'bg-zinc-400'}`"></div>
              <span class="truncate">{{ config.enabled ? '已启用' : '已禁用' }}</span>
            </span>
          </div>

          <div class="bg-black/30 rounded-xl p-3 mb-6 border border-white/5 font-mono text-xs flex-1">
             <div class="flex justify-between mb-2">
               <span class="text-slate-500 shrink-0">类型</span>
               <span class="text-cyan-300 font-bold truncate text-right">{{ modelTypeOptions.find(t => t.value === ((config as any).modelType || 'chat'))?.label || '💬 对话模型' }}</span>
             </div>
             <div class="flex justify-between mb-2">
               <span class="text-slate-500 shrink-0">Model</span>
               <span class="text-amber-300 font-bold truncate text-right min-w-0 flex-1" :title="config.model">{{ config.model || '-' }}</span>
             </div>
             <div class="flex justify-between mb-2">
               <span class="text-slate-500 shrink-0">Max Tokens</span>
               <span class="text-slate-300">{{ config.maxTokens }}</span>
             </div>
             <div class="flex justify-between mb-2">
               <span class="text-slate-500 shrink-0">Temperature</span>
               <span class="text-slate-300">{{ config.temperature }}</span>
             </div>
             <div class="flex justify-between">
               <span class="text-slate-500 shrink-0">API Key</span>
               <span class="text-slate-300 tracking-widest">{{ config.apiKey ? '••••••••' : 'None' }}</span>
             </div>
          </div>

          <div class="flex gap-2 shrink-0">
            <button @click="testExistingConfig(config.id)" :title="t('models.testApi')" class="flex-1 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-xl text-sm transition-colors border border-amber-500/30 flex justify-center items-center gap-1">
              <Activity :size="14" /> {{ t('common.test') }}
            </button>
            <button @click="openEditModal(config)" class="flex-1 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm transition-colors border border-white/[0.05] flex justify-center items-center gap-1">
              <Edit3 :size="14" /> {{ t('common.edit') }}
            </button>
            <button @click="deleteConfig(config.id)" class="px-4 py-2 bg-white/[0.05] hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/20 text-zinc-400 rounded-xl text-sm transition-colors border border-white/[0.05] flex justify-center items-center">
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div class="bg-[#1e2330] w-full max-w-lg rounded-2xl shadow-2xl border border-white/[0.05] flex flex-col max-h-[90vh] overflow-hidden" @click.stop>
        
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/[0.05] shrink-0">
          <h2 class="text-lg font-bold text-white">{{ editingConfig ? t('models.editConfig') : t('models.addConfig') }}</h2>
          <button @click="showModal = false" class="text-zinc-400 hover:text-white transition-colors">
            <X :size="20" />
          </button>
        </div>

        <form @submit.prevent="saveConfig" class="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar flex flex-col">
          
          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.configName') }}</label>
            <input
              v-model="formData.name"
              type="text"
              required
              :placeholder="t('models.configNamePlaceholder')"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.provider') }}</label>
            <CustomSelect
              v-model="formData.provider"
              :options="providerOptions"
              placeholder="选择提供商"
              @change="onProviderChange"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.modelType') }}</label>
            <CustomSelect
              v-model="formData.modelType"
              :options="modelTypeOptions"
              placeholder="选择模型类型"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.apiKey') }}</label>
            <input
              v-model="formData.apiKey"
              type="password"
              :placeholder="editingConfig ? t('models.apiKeyEditPlaceholder') : t('models.apiKeyPlaceholder')"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">Base URL</label>
            <input
              v-model="formData.baseUrl"
              type="text"
              placeholder="自定义API地址（可选）"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
            />
          </div>

          <div>
             <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.model') }}</label>
             <input
               v-model="formData.model"
               type="text"
               list="model-suggestions"
               :placeholder="t('models.modelPlaceholder')"
               required
               class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
             />
             <datalist id="model-suggestions">
               <option v-for="model in modelSuggestions" :key="model" :value="model" />
             </datalist>
          </div>

          <div v-if="formData.modelType === 'chat' || formData.modelType === 'vision'" class="grid grid-cols-2 gap-4">
             <div>
                <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.maxTokens') }}</label>
                <input
                  v-model.number="formData.maxTokens"
                  type="number"
                  min="1" max="128000"
                  class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors"
                />
             </div>
             <div>
               <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.temperature') }}</label>
               <input
                 v-model.number="formData.temperature"
                 type="number"
                 step="0.1" min="0" max="2"
                 class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors"
               />
             </div>
          </div>

          <div v-if="formData.modelType === 'image-gen'">
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.defaultImageSize') }}</label>
            <CustomSelect
              v-model="formData.imageSize"
              :options="imageSizeOptions"
              placeholder="选择图像尺寸"
            />
          </div>

          <div v-if="formData.modelType === 'audio-tts'" class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.voice') }}</label>
              <input
                v-model="formData.voice"
                type="text"
                placeholder="alloy / echo / fable..."
                class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
              />
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('models.outputFormat') }}</label>
              <CustomSelect
                v-model="formData.responseFormat"
                :options="audioFormatOptions"
                placeholder="选择输出格式"
              />
            </div>
          </div>

          <label class="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-black/20 cursor-pointer mt-2 hover:border-amber-500/30 transition-colors group">
            <input v-model="formData.enabled" type="checkbox" class="w-4 h-4 rounded appearance-none border border-white/20 checked:bg-amber-500 checked:border-amber-500 transition-colors relative" />
            <div class="flex-1">
              <span class="text-sm font-bold text-slate-200 group-hover:text-amber-400 transition-colors">{{ t('models.enableConfig') }}</span>
            </div>
            <div v-if="formData.enabled" class="absolute left-4 top-auto transform flex items-center justify-center pointer-events-none">
               <ShieldCheck :size="14" class="text-white" />
            </div>
          </label>

          <div v-if="testResult" :class="['p-4 rounded-xl text-xs font-medium border whitespace-pre-line', testResult.success ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20']">
            {{ testResult.message }}
          </div>

          <div class="flex-1 min-h-4"></div>

          <div class="flex justify-between gap-4 pt-4 border-t border-white/[0.05] shrink-0">
            <button v-if="editingConfig" type="button" @click="testConnection" :disabled="testingConnection" class="flex-[0.5] py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-xl text-sm font-medium transition-colors border border-amber-500/30 disabled:opacity-50">
              {{ testingConnection ? t('models.testing') : t('common.test') }}
            </button>
            <button type="button" class="flex-[0.5] py-2.5 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm font-medium transition-colors border border-white/[0.05]" @click="showModal = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-sm font-bold transition-colors shadow-lg shadow-amber-500/20">
              {{ t('models.saveConfig') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,0.3); }

input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1px;
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
</style>
