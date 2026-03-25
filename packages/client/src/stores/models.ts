import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { llmApi, type LLMConfig } from '@/api';

export const useLLMStore = defineStore('llm', () => {
  const configs = ref<LLMConfig[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const defaultConfigId = ref<string | null>(null);

  const enabledConfigs = computed(() => configs.value.filter(c => c.enabled));
  const hasConfigs = computed(() => configs.value.length > 0);

  async function fetchConfigs() {
    loading.value = true;
    error.value = null;
    try {
      const response = await llmApi.getAll();
      configs.value = response.data;
      if (configs.value.length > 0 && !defaultConfigId.value) {
        defaultConfigId.value = configs.value[0].id;
      }
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function createConfig(config: Partial<LLMConfig>) {
    try {
      const response = await llmApi.create(config);
      configs.value.push(response.data);
      return response.data;
    } catch (e) {
      error.value = (e as Error).message;
      throw e;
    }
  }

  async function updateConfig(id: string, config: Partial<LLMConfig>) {
    try {
      const response = await llmApi.update(id, config);
      const index = configs.value.findIndex(c => c.id === id);
      if (index !== -1) {
        configs.value[index] = response.data;
      }
      return response.data;
    } catch (e) {
      error.value = (e as Error).message;
      throw e;
    }
  }

  async function deleteConfig(id: string) {
    try {
      await llmApi.delete(id);
      configs.value = configs.value.filter(c => c.id !== id);
      if (defaultConfigId.value === id) {
        defaultConfigId.value = configs.value[0]?.id || null;
      }
    } catch (e) {
      error.value = (e as Error).message;
      throw e;
    }
  }

  function setDefault(id: string) {
    if (configs.value.some(c => c.id === id)) {
      defaultConfigId.value = id;
    }
  }

  return {
    configs,
    loading,
    error,
    defaultConfigId,
    enabledConfigs,
    hasConfigs,
    fetchConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
    setDefault,
  };
});

export const useModelsStore = useLLMStore;
