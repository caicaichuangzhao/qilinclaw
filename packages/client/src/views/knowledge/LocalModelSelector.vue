<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import CustomSelect from '../../components/CustomSelect.vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface EmbeddingConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  dimension: number;
}

interface LocalModelInfo {
  name: string;
  version: string;
  path: string;
  dimension: number;
}

const embeddingConfig = ref<EmbeddingConfig>({
  provider: 'local',
  model: 'all-MiniLM-L6-v2',
  apiKey: '',
  baseUrl: '',
  dimension: 1536,
});

const localModels = ref<LocalModelInfo[]>([]);
const loadingLocalModels = ref(false);

const embeddingStatus = ref<{
  configured: boolean;
  provider: string | null;
  model: string | null;
  lastError: string | null;
  lastSuccess: number | null;
  totalApiCalls: number;
  totalLocalCalls: number;
  totalCacheHits: number;
} | null>(null);

const testingEmbedding = ref(false);
const testResult = ref<{ success: boolean; latency?: number; error?: string } | null>(null);

const embeddingProviders = computed(() => {
  const localProviderModels = ['all-MiniLM-L6-v2', 'local-simple'];
  if (localModels.value.length > 0) {
    localModels.value.forEach(m => {
      if (!localProviderModels.includes(m.name)) {
        localProviderModels.push(m.name);
      }
    });
  }
  return [
    { value: 'local', label: t('embedding.localProvider'), models: localProviderModels },
    { value: 'openai', label: 'OpenAI', models: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'] },
    { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-embedding'] },
    { value: 'zhipu', label: '智谱AI', models: ['embedding-2', 'embedding-3'] },
    { value: 'nvidia', label: 'NVIDIA NIM', models: [] },
    { value: 'custom', label: t('embedding.customApi'), models: [] },
  ];
});

const providerOptions = computed(() => embeddingProviders.value.map(p => ({ value: p.value, label: p.label })));

function getProviderModels() {
  const provider = embeddingProviders.value.find(p => p.value === embeddingConfig.value.provider);
  return provider ? provider.models : [];
}

const modelOptions = computed(() => getProviderModels().map(m => ({ value: m, label: m })));

function isCustomProvider() {
  return embeddingConfig.value.provider === 'custom' || embeddingConfig.value.provider === 'nvidia';
}

function onProviderChange(val: string | number) {
  embeddingConfig.value.provider = String(val);
  const models = getProviderModels();
  if (models.length > 0) {
    embeddingConfig.value.model = models[0];
  } else {
    embeddingConfig.value.model = '';
  }
}

async function loadLocalModels() {
  loadingLocalModels.value = true;
  try {
    const response = await fetch('/api/memory/embedding/local-models');
    if (response.ok) {
      const data = await response.json();
      // the endpoint returns { modelsPath, models: [], count: n }
      localModels.value = data.models || [];
    }
  } catch (error) {
    console.error('Failed to load local models:', error);
  } finally {
    loadingLocalModels.value = false;
  }
}

async function loadEmbeddingConfig() {
  try {
    const response = await fetch('/api/memory/embedding/config');
    if (response.ok) {
      const config = await response.json();
      if (config) {
        embeddingConfig.value = {
          provider: config.provider || 'local',
          model: config.model || 'all-MiniLM-L6-v2',
          apiKey: config.apiKey || '',
          baseUrl: config.baseUrl || '',
          dimension: config.dimension || 1536,
        };
      }
    }
  } catch (error) {
    console.error('Failed to load embedding config:', error);
  }
}

async function loadEmbeddingStatus() {
  try {
    const response = await fetch('/api/memory/embedding/status');
    if (response.ok) {
      embeddingStatus.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load embedding status:', error);
  }
}

async function saveEmbeddingConfig() {
  try {
    const configToSave: any = {
      ...embeddingConfig.value,
      dimension: embeddingConfig.value.dimension || 1536,
    };
    
    if (configToSave.provider === 'local') {
      const selectedLocalModel = localModels.value.find(m => m.name === configToSave.model);
      if (selectedLocalModel) {
        configToSave.localModelPath = selectedLocalModel.path;
        configToSave.dimension = selectedLocalModel.dimension;
      }
    }
    
    const response = await fetch('/api/memory/embedding/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configToSave),
    });
    
    if (response.ok) {
      await loadEmbeddingStatus();
      alert(t('embedding.configSaved'));
    } else {
      const error = await response.json();
      alert(t('embedding.saveFailed') + ' ' + (error.error || 'Unknown'));
    }
  } catch (error) {
    console.error('Failed to save embedding config:', error);
    alert(t('embedding.saveFailed') + ' ' + (error as Error).message);
  }
}

async function testEmbeddingConnection() {
  testingEmbedding.value = true;
  testResult.value = null;
  try {
    const response = await fetch('/api/memory/embedding/test', { method: 'POST' });
    if (response.ok) {
      testResult.value = await response.json();
    }
  } catch (error) {
    testResult.value = { success: false, error: String(error) };
  } finally {
    testingEmbedding.value = false;
  }
}

onMounted(() => {
  loadLocalModels();
  loadEmbeddingConfig();
  loadEmbeddingStatus();
});
</script>

<template>
  <div class="card mb-6" style="position: relative; z-index: 20;">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold">{{ t('embedding.title') }}</h3>
      <div class="flex gap-2">
        <button 
          class="btn btn-secondary btn-sm" 
          @click="loadLocalModels" 
          :disabled="loadingLocalModels"
        >
          {{ loadingLocalModels ? t('embedding.refreshing') : t('embedding.refreshLocal') }}
        </button>
        <button 
          class="btn btn-secondary btn-sm" 
          @click="testEmbeddingConnection" 
          :disabled="testingEmbedding || embeddingConfig.provider === 'local'"
        >
          {{ testingEmbedding ? t('embedding.testing') : t('embedding.testConnection') }}
        </button>
        <button class="btn btn-primary btn-sm" @click="saveEmbeddingConfig">{{ t('embedding.saveConfig') }}</button>
      </div>
    </div>
    
    <!-- Status Display -->
    <div v-if="embeddingStatus" class="mb-4 p-4 bg-black/40 border border-white/5 rounded-xl">
      <div class="flex items-center gap-4 text-sm">
        <span :class="embeddingStatus.configured ? 'text-green-400' : 'text-yellow-400'">
          {{ embeddingStatus.configured ? t('embedding.configured') : t('embedding.notConfigured') }}
        </span>
        <span v-if="embeddingStatus.provider" class="text-slate-400">
          {{ t('embedding.providerLabel') }} {{ embeddingStatus.provider }}
        </span>
        <span v-if="embeddingStatus.model" class="text-slate-400">
          {{ t('embedding.modelLabel') }} {{ embeddingStatus.model }}
        </span>
        <span v-if="embeddingStatus.lastError" class="text-red-400">
          {{ t('embedding.errorLabel') }} {{ embeddingStatus.lastError }}
        </span>
      </div>
      <div v-if="testResult" class="mt-2 text-sm">
        <span v-if="testResult.success" class="text-green-400">
          {{ t('embedding.connectionSuccess', { latency: testResult.latency }) }}
        </span>
        <span v-else class="text-red-400">
          {{ t('embedding.connectionFailed') }} {{ testResult.error }}
        </span>
      </div>
    </div>
    
    <div class="space-y-4">
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="block text-sm text-slate-400 mb-1">{{ t('embedding.provider') }}</label>
          <CustomSelect
            :modelValue="embeddingConfig.provider"
            :options="providerOptions"
            :placeholder="t('embedding.selectProvider')"
            @update:modelValue="onProviderChange"
          />
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">{{ t('embedding.model') }}</label>
          <CustomSelect
            v-if="!isCustomProvider() && getProviderModels().length > 0"
            :modelValue="embeddingConfig.model"
            :options="modelOptions"
            :placeholder="t('embedding.selectModel')"
            @update:modelValue="(val) => embeddingConfig.model = String(val)"
          />
          <input v-else v-model="embeddingConfig.model" type="text" class="w-full bg-black/40 border border-white/10 text-zinc-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-3 py-2 transition-colors outline-none" :placeholder="t('embedding.enterModelName')" />
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">{{ t('embedding.dimension') }}</label>
          <input v-model.number="embeddingConfig.dimension" type="number" class="w-full bg-black/40 border border-white/10 text-zinc-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-3 py-2 transition-colors outline-none" min="128" max="4096" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4" v-if="embeddingConfig.provider !== 'local'">
        <div>
          <label class="block text-sm text-slate-400 mb-1">{{ t('embedding.apiKey') }}</label>
          <input v-model="embeddingConfig.apiKey" type="password" class="w-full bg-black/40 border border-white/10 text-zinc-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-3 py-2 transition-colors outline-none" :placeholder="t('embedding.apiKeyPlaceholder')" />
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">{{ t('embedding.customApiUrl') }}</label>
          <input v-model="embeddingConfig.baseUrl" type="text" class="w-full bg-black/40 border border-white/10 text-zinc-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-3 py-2 transition-colors outline-none" :placeholder="t('embedding.customApiUrlPlaceholder')" />
        </div>
      </div>
      
      <div v-if="embeddingConfig.provider === 'local'" class="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
        <h4 class="text-amber-400 font-bold mb-2">{{ t('embedding.localModelHint') }}</h4>
        <p class="text-zinc-400 text-sm mb-2">{{ t('embedding.localModelDesc') }}</p>
        <div class="bg-black/40 rounded-lg p-3 font-mono text-sm text-zinc-300">.qilin-claw/local-embedding-models/</div>
        <div class="text-zinc-500 text-xs mt-3">
          <div class="mb-2">
            <strong class="text-amber-400">{{ t('embedding.modelFormat') }}</strong>
            <ul class="mt-1 ml-4 list-disc text-zinc-400">
              <li>{{ t('embedding.modelFormatOnnx') }}</li>
              <li>{{ t('embedding.modelFormatFolder') }}</li>
              <li>{{ t('embedding.modelFormatFile') }}</li>
            </ul>
          </div>
          <div class="mb-2">
            <strong class="text-amber-400">{{ t('embedding.recommendedModels') }}</strong>
            <ul class="mt-1 ml-4 list-disc text-zinc-400">
              <li><span class="text-emerald-400">onnx-community/Qwen3-Embedding-0.6B-ONNX</span> - 1024dim, ONNX</li>
              <li><span class="text-emerald-400">BAAI/bge-m3-ONNX</span> - 1024dim, multilingual</li>
              <li><span class="text-emerald-400">shibing624/text2vec-base-chinese-ONNX</span> - 768dim, Chinese optimized</li>
            </ul>
          </div>
          <div>
            <strong class="text-amber-400">{{ t('embedding.downloadMethods') }}</strong>
            <ul class="mt-1 ml-4 list-disc text-zinc-400">
              <li>{{ t('embedding.downloadHF') }} <a href="https://huggingface.co/spaces" target="_blank" class="text-blue-400 underline">Hugging Face Spaces</a></li>
              <li>{{ t('embedding.downloadMS') }} <a href="https://www.modelscope.cn/models" target="_blank" class="text-blue-400 underline">ModelScope</a></li>
              <li>{{ t('embedding.downloadGit') }} <code class="bg-black/30 px-1 rounded">git clone https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX</code></li>
              <li>{{ t('embedding.downloadNote') }}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
