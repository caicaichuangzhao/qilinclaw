<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  documents?: any[];
  createdAt: number;
  updatedAt?: number;
}

const props = defineProps<{
  knowledgeBases: KnowledgeBase[];
  modelValue: KnowledgeBase | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: KnowledgeBase | null];
  'refresh': [];
}>();

const showCreateKBModal = ref(false);
const newKBName = ref('');
const newKBDescription = ref('');

// KB Multi-select State
const selectedKBIds = ref<Set<string>>(new Set());
const selectAllKBs = ref(false);

function toggleSelectAllKBs() {
  if (selectAllKBs.value) {
    props.knowledgeBases.forEach(kb => selectedKBIds.value.add(kb.id));
  } else {
    selectedKBIds.value.clear();
  }
}

function toggleKBSelection(kbId: string) {
  if (selectedKBIds.value.has(kbId)) {
    selectedKBIds.value.delete(kbId);
  } else {
    selectedKBIds.value.add(kbId);
  }
  selectAllKBs.value = props.knowledgeBases.length > 0 && props.knowledgeBases.every(kb => selectedKBIds.value.has(kb.id));
}

function isKBSelected(kbId: string): boolean {
  return selectedKBIds.value.has(kbId);
}

async function createKnowledgeBase() {
  if (!newKBName.value.trim()) return;
  try {
    const response = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKBName.value, description: newKBDescription.value }),
    });
    if (response.ok) {
      emit('refresh');
      showCreateKBModal.value = false;
      newKBName.value = '';
      newKBDescription.value = '';
    }
  } catch (error) {
    console.error('Failed to create knowledge base:', error);
  }
}

async function deleteKnowledgeBase(id: string) {
  if (!confirm(t('knowledgeSub.deleteKBConfirm'))) return;
  try {
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    if (props.modelValue?.id === id) {
      emit('update:modelValue', null);
    }
    emit('refresh');
  } catch (error) {
    console.error('Failed to delete knowledge base:', error);
  }
}

async function deleteSelectedKBs() {
  if (selectedKBIds.value.size === 0) return;
  if (!confirm(t('knowledgeSub.deleteSelectedKBConfirm', { n: selectedKBIds.value.size }))) return;
  
  try {
    for (const kbId of selectedKBIds.value) {
      await fetch(`/api/knowledge/${kbId}`, { method: 'DELETE' });
      if (props.modelValue?.id === kbId) {
        emit('update:modelValue', null);
      }
    }
    selectedKBIds.value.clear();
    selectAllKBs.value = false;
    emit('refresh');
  } catch (error) {
    console.error('Failed to delete knowledge bases:', error);
  }
}
</script>

<template>
  <div class="card h-full flex flex-col">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold">{{ t('knowledgeSub.kbList') }}</h3>
      <div class="flex gap-2">
        <button v-if="selectedKBIds.size > 0" class="btn btn-danger btn-sm" @click="deleteSelectedKBs">
          {{ t('knowledgeSub.deleteSelected', { n: selectedKBIds.size }) }}
        </button>
        <button class="btn btn-primary btn-sm" @click="showCreateKBModal = true">{{ t('knowledgeSub.newKB') }}</button>
      </div>
    </div>
    
    <!-- Multi-select Controls -->
    <div v-if="knowledgeBases.length > 0" class="flex items-center gap-4 mb-3 pb-3 border-b border-slate-700">
      <label class="flex items-center gap-2 text-sm text-slate-400">
        <input 
          type="checkbox" 
          :checked="selectAllKBs"
          @change="selectAllKBs = !selectAllKBs; toggleSelectAllKBs()"
          class="w-4 h-4 rounded"
        />
        {{ t('knowledgeSub.selectAll') }}
      </label>
      <span class="text-xs text-slate-500">{{ t('knowledgeSub.totalKBs', { n: knowledgeBases.length }) }}</span>
    </div>
    
    <div v-if="knowledgeBases.length === 0" class="text-center py-4 text-slate-400">{{ t('knowledgeSub.noKBs') }}</div>
    <div v-else class="space-y-2 flex-auto overflow-y-auto">
      <div
        v-for="kb in knowledgeBases"
        :key="kb.id"
        :class="['p-4 rounded-2xl cursor-pointer transition-all border', modelValue?.id === kb.id ? 'bg-amber-500/10 border-amber-500/20 shadow-inner' : 'bg-black/20 border-white/5 hover:border-white/10']"
        @click="emit('update:modelValue', kb)"
      >
        <div class="flex justify-between items-start">
          <div class="flex items-start gap-3">
            <input 
              type="checkbox" 
              :checked="isKBSelected(kb.id)"
              @change="toggleKBSelection(kb.id)"
              class="w-4 h-4 rounded mt-0.5"
            />
            <div>
              <h4 class="font-medium">{{ kb.name }}</h4>
              <p class="text-xs text-slate-400">{{ t('knowledgeSub.documents', { n: kb.documents?.length || 0 }) }}</p>
            </div>
          </div>
          <button class="text-red-400 hover:text-red-300 text-sm" @click.stop="deleteKnowledgeBase(kb.id)">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
    
    <!-- Create KB Modal -->
    <Teleport to="body">
      <div v-if="showCreateKBModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click="showCreateKBModal = false">
        <div class="bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" @click.stop>
          <h2 class="text-xl font-semibold mb-4">{{ t('knowledgeSub.createKB') }}</h2>
          <form @submit.prevent="createKnowledgeBase" class="space-y-4">
            <div>
              <label class="block text-sm text-slate-400 mb-1">{{ t('knowledgeSub.name') }}</label>
              <input v-model="newKBName" type="text" class="input w-full" required />
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-1">{{ t('knowledgeSub.description') }}</label>
              <textarea v-model="newKBDescription" class="input w-full" rows="2"></textarea>
            </div>
            <div class="flex justify-end gap-2 pt-4">
              <button type="button" class="btn btn-secondary" @click="showCreateKBModal = false">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn btn-primary">{{ t('common.create') }}</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
