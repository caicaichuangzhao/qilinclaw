<script setup lang="ts">
import { ref, computed } from 'vue';
import CustomSelect from '../../components/CustomSelect.vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface KnowledgeDocument {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  chunks?: any[];
  embeddingStatus?: string;
  embeddingError?: string;
  metadata?: any;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  documents?: KnowledgeDocument[];
  createdAt: number;
  updatedAt?: number;
}

const props = defineProps<{
  kb: KnowledgeBase;
}>();

const emit = defineEmits<{
  'refresh': [];
}>();

const uploading = ref(false);

// Filter State
const docTypeFilter = ref<string>('all');
const docTypes = computed(() => [
  { value: 'all', label: t('knowledgeSub.allTypes') },
  { value: 'website', label: t('knowledgeSub.website') },
  { value: 'url', label: t('knowledgeSub.url') },
  { value: 'directory', label: t('knowledgeSub.directory') },
  { value: 'note', label: t('knowledgeSub.note') },
  { value: 'file', label: t('knowledgeSub.file') },
]);

// Multi-select State
const selectedDocIds = ref<Set<string>>(new Set());
const selectAll = ref(false);

// Filtered Documents
const filteredDocuments = computed(() => {
  let docs = props.kb.documents || [];
  
  if (docTypeFilter.value !== 'all') {
    docs = docs.filter(doc => {
      const docType = doc.metadata?.docType || inferDocType(doc);
      return docType === docTypeFilter.value;
    });
  }
  
  return docs;
});

function inferDocType(doc: KnowledgeDocument): string {
  const filename = doc.originalName.toLowerCase();
  const mimeType = doc.mimeType;
  
  if (mimeType.startsWith('image/')) return 'file';
  if (filename.includes('http') || filename.includes('网址')) return 'url';
  if (filename.includes('网站') || filename.includes('website')) return 'website';
  if (filename.includes('目录') || filename.includes('directory')) return 'directory';
  if (filename.includes('笔记') || filename.includes('note') || filename.endsWith('.md')) return 'note';
  return 'file';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result) {
        reject(new Error(t('knowledgeSub.readFileFailed')));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error(t('knowledgeSub.extractBase64Failed')));
        return;
      }
      resolve(base64);
    };
    reader.onerror = (e) => {
      reject(new Error(t('knowledgeSub.readFileFailed')));
    };
    reader.readAsDataURL(file);
  });
}

// Multi-select Functions
function toggleSelectAll() {
  if (selectAll.value) {
    filteredDocuments.value.forEach(doc => selectedDocIds.value.add(doc.id));
  } else {
    selectedDocIds.value.clear();
  }
}

function toggleDocSelection(docId: string) {
  if (selectedDocIds.value.has(docId)) {
    selectedDocIds.value.delete(docId);
  } else {
    selectedDocIds.value.add(docId);
  }
  selectAll.value = filteredDocuments.value.length > 0 && filteredDocuments.value.every(doc => selectedDocIds.value.has(doc.id));
}

function isDocSelected(docId: string): boolean {
  return selectedDocIds.value.has(docId);
}

function clearSelection() {
  selectedDocIds.value.clear();
  selectAll.value = false;
}

// Actions
async function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!target.files || !props.kb) return;

  uploading.value = true;
  let successCount = 0;
  let failCount = 0;
  try {
    for (const file of target.files) {
      try {
        const content = await readFileAsBase64(file);
        const response = await fetch(`/api/knowledge/${props.kb.id}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            content,
            mimeType: file.type || 'text/plain',
          }),
        });
        if (response.ok) {
          successCount++;
        } else {
          failCount++;
          const errData = await response.json().catch(() => ({ error: 'Unknown' }));
          console.error(`Failed to upload ${file.name}:`, errData.error);
        }
      } catch (fileError) {
        failCount++;
        console.error(`Failed to upload ${file.name}:`, fileError);
      }
    }
    emit('refresh');
    if (failCount > 0) {
      alert(t('knowledgeSub.uploadResult', { success: successCount, failed: failCount }));
    }
  } catch (error) {
    console.error('Failed to upload:', error);
    alert(t('knowledgeSub.uploadFailed') + ' ' + (error as Error).message);
  } finally {
    uploading.value = false;
    target.value = '';
  }
}

async function deleteSelectedDocs() {
  if (selectedDocIds.value.size === 0) return;
  if (!confirm(t('knowledgeSub.deleteSelectedDocsConfirm', { n: selectedDocIds.value.size }))) return;
  
  try {
    for (const docId of selectedDocIds.value) {
      await fetch(`/api/knowledge/${props.kb.id}/documents/${docId}`, { method: 'DELETE' });
    }
    clearSelection();
    emit('refresh');
  } catch (error) {
    console.error('Failed to delete documents:', error);
  }
}

async function deleteDocument(docId: string) {
  if (!confirm(t('knowledgeSub.deleteDocConfirm'))) return;
  try {
    await fetch(`/api/knowledge/${props.kb.id}/documents/${docId}`, { method: 'DELETE' });
    emit('refresh');
  } catch (error) {
    console.error('Failed to delete document:', error);
  }
}

async function regenerateKBEmbeddings(kbId: string) {
  if (!confirm(t('knowledgeSub.regenerateConfirm'))) return;
  
  try {
    const response = await fetch(`/api/knowledge/${kbId}/regenerate-embeddings`, { method: 'POST' });
    if (response.ok) {
      const result = await response.json();
      alert(t('knowledgeSub.regenerateResult', { success: result.success, failed: result.failed }));
      emit('refresh');
    }
  } catch (error) {
    console.error('Failed to regenerate embeddings:', error);
    alert(t('knowledgeSub.regenerateFailed'));
  }
}

async function regenerateDocEmbeddings(docId: string) {
  try {
    const response = await fetch(`/api/knowledge/${props.kb.id}/documents/${docId}/regenerate-embeddings`, { method: 'POST' });
    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        alert(t('knowledgeSub.regenerateDocSuccess'));
      } else {
        alert(t('knowledgeSub.regenerateDocFailed') + ' ' + result.error);
      }
      emit('refresh');
    }
  } catch (error) {
    console.error('Failed to regenerate document embeddings:', error);
    alert(t('knowledgeSub.regenerateFailed'));
  }
}
</script>

<template>
  <div class="card">
    <div class="flex justify-between items-start mb-4">
      <div>
        <h3 class="text-xl font-semibold">{{ kb.name }}</h3>
        <p class="text-slate-400 text-sm">{{ kb.description }}</p>
      </div>
      <div class="flex gap-2">
        <button 
          class="btn btn-secondary" 
          @click="regenerateKBEmbeddings(kb.id)"
          :title="t('knowledgeSub.regenerateEmbeddingsTitle')"
        >
          {{ t('knowledgeSub.regenerateEmbeddings') }}
        </button>
        <label class="btn btn-primary cursor-pointer">
          <input type="file" multiple class="hidden" accept=".txt,.md,.json,.csv,.html,.xml,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.yaml,.yml,.js,.ts,.py,.sh,.log,.sql,.vue,.jsx,.tsx,.css,.scss,.less,.sass,.go,.java,.c,.cpp,.h,.hpp,.rs,.rb,.php,.swift,.kt,.scala,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg" @change="handleFileUpload" :disabled="uploading" />
          {{ uploading ? t('knowledgeSub.uploading') : t('knowledgeSub.uploadDocuments') }}
        </label>
        <button 
          v-if="selectedDocIds.size > 0" 
          class="btn btn-danger" 
          @click="deleteSelectedDocs"
        >
          {{ t('knowledgeSub.deleteSelectedDocs', { n: selectedDocIds.size }) }}
        </button>
      </div>
    </div>
    
    <!-- Filter and Select Controls -->
    <div class="flex items-center gap-4 mb-4 pb-4 border-b border-slate-700">
      <div class="flex items-center gap-2">
        <input 
          type="checkbox" 
          :checked="selectAll"
          @change="selectAll = !selectAll; toggleSelectAll()"
          class="w-4 h-4 rounded"
        />
        <span class="text-sm text-slate-400">{{ t('knowledgeSub.selectAllDocs') }}</span>
      </div>
      <div class="w-32">
        <CustomSelect
          :modelValue="docTypeFilter"
          :options="docTypes"
          :placeholder="t('knowledgeSub.allTypes')"
          @update:modelValue="(val) => docTypeFilter = String(val)"
        />
      </div>
      <span class="text-sm text-slate-500">
        {{ t('knowledgeSub.totalDocs', { n: filteredDocuments.length }) }}
      </span>
      <button 
        v-if="selectedDocIds.size > 0" 
        class="text-sm text-slate-400 hover:text-white ml-auto"
        @click="clearSelection"
      >
        {{ t('knowledgeSub.cancelSelection') }}
      </button>
    </div>
    
    <div v-if="filteredDocuments.length === 0" class="text-center py-8 text-slate-400">
      {{ docTypeFilter === 'all' ? t('knowledgeSub.noDocs') : t('knowledgeSub.noDocsOfType') }}
    </div>
    <div v-else class="space-y-2 max-h-96 overflow-auto">
      <div v-for="doc in filteredDocuments" :key="doc.id" class="p-4 bg-black/20 border border-white/5 rounded-2xl hover:bg-black/40 transition-colors">
        <div class="flex justify-between items-start">
          <div class="flex items-start gap-3 flex-1">
            <input 
              type="checkbox" 
              :checked="isDocSelected(doc.id)"
              @change="toggleDocSelection(doc.id)"
              class="w-4 h-4 rounded mt-1"
            />
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h5 class="font-medium">{{ doc.originalName }}</h5>
                <span class="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300">
                  {{ doc.metadata?.docType || inferDocType(doc) }}
                </span>
                <span 
                  v-if="doc.embeddingStatus" 
                  :class="[
                    'text-xs px-2 py-0.5 rounded',
                    doc.embeddingStatus === 'success' ? 'bg-green-500/20 text-green-400' : 
                    doc.embeddingStatus === 'failed' ? 'bg-red-500/20 text-red-400' : 
                    'bg-yellow-500/20 text-yellow-400'
                  ]"
                >
                  {{ doc.embeddingStatus === 'success' ? t('knowledgeSub.embeddingSuccess') : 
                     doc.embeddingStatus === 'failed' ? t('knowledgeSub.embeddingFailed') : 
                     t('knowledgeSub.embeddingPending') }}
                </span>
                <button 
                  v-if="doc.embeddingStatus === 'failed'"
                  class="text-xs text-primary-400 hover:text-primary-300"
                  @click="regenerateDocEmbeddings(doc.id)"
                  :title="t('knowledgeSub.regenerateEmbeddings')"
                >
                  {{ t('knowledgeSub.retry') }}
                </button>
              </div>
              <p class="text-xs text-slate-400">{{ formatSize(doc.size) }} | {{ t('knowledgeSub.chunks', { n: doc.chunks?.length || 0 }) }}</p>
              <p v-if="doc.embeddingError" class="text-xs text-red-400 mt-1">{{ doc.embeddingError }}</p>
            </div>
          </div>
          <button class="text-red-400 hover:text-red-300 text-sm" @click="deleteDocument(doc.id)">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
