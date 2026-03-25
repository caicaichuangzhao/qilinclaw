```vue
<script setup lang="ts">
import { ref, onMounted, computed, onErrorCaptured, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import CustomSelect from '../components/CustomSelect.vue';
import api from '@/api';
import LocalModelSelector from './knowledge/LocalModelSelector.vue';
import KnowledgeList from './knowledge/KnowledgeList.vue';
import DocumentManager from './knowledge/DocumentManager.vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

const router = useRouter();
const route = useRoute();

// Types
interface KnowledgeDocument {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  chunks: Array<{ id: string; content: string }>;
  embeddingStatus?: string;
  embeddingError?: string;
  metadata: { 
    uploadedAt: number; 
    tags: string[]; 
    docType?: string; 
  };
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  documents: KnowledgeDocument[];
  createdAt: number;
}

interface Agent {
  id: string;
  name: string;
  avatar?: string;
}

interface Thread {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt?: number;
}

interface EmbeddingConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  dimension: number;
}

onErrorCaptured((err, _instance, info) => {
  console.error('[KNOWLEDGE RENDER CRASH]', err, info);
  alert(`Render Crash: ${err.message}\n${err.stack}`);
  return false;
});

// State
const activeTab = ref<'knowledge' | 'history' | 'offices'>((route.query.tab as any) || 'knowledge');

watch(activeTab, (val) => {
  router.replace({ query: { ...route.query, tab: val } }).catch(() => {});
});


// Knowledge Base State
const knowledgeBases = ref<KnowledgeBase[]>([]);
const selectedKB = ref<KnowledgeBase | null>(null);
// Office Conversations State
const offices = ref<any[]>([]);
const selectedOffice = ref<any | null>(null);
const officeMessages = ref<any[]>([]);
const loadingOffices = ref(false);

// History State (using Threads)
const agents = ref<Agent[]>([]);
const threads = ref<Thread[]>([]);
const selectedThread = ref<Thread | null>(null);
const threadMessages = ref<Array<{role: string; content: string; timestamp: number}>>([]);

// Thread Multi-select State
const selectedThreadIds = ref<Set<string>>(new Set());
const selectAllThreads = ref(false);

// Search State
const searchQuery = ref('');

const searching = ref(false);
const globalSearchResults = ref<Array<{
  type: 'knowledge' | 'thread' | 'office';
  content: string;
  source: string;
  similarity: number;
  documentId?: string;
  conversationId?: string;
  officeId?: string;
  officeName?: string;
  role?: string;
  timestamp?: number;
}>>([]);

// Stats
const stats = computed(() => ({
  knowledgeBases: knowledgeBases.value.length,
  documents: knowledgeBases.value.reduce((acc, kb) => acc + (kb.documents?.length || 0), 0),
  threads: threads.value.length,
  totalChunks: knowledgeBases.value.reduce(
    (acc, kb) => acc + (kb.documents || []).reduce((a, d) => a + (d.chunks?.length || 0), 0),
    0
  ),
}));

// Office Conversations Functions
async function loadOffices() {
  try {
    loadingOffices.value = true;
    const res = await fetch('/api/offices');
    if (res.ok) {
      offices.value = await res.json();
    }
  } catch (error) {
    console.error('Failed to load offices:', error);
  } finally {
    loadingOffices.value = false;
  }
}

async function selectOfficeConversation(office: any) {
  selectedOffice.value = office;
  try {
    const res = await fetch(`/api/offices/${office.id}/messages`);
    if (res.ok) {
      officeMessages.value = await res.json();
    }
  } catch (error) {
    console.error('Failed to load office messages:', error);
  }
}

onMounted(async () => {
  await Promise.all([
    loadKnowledgeBases(), 
    loadAgents(), 
    loadOffices()
  ]);
});

// Knowledge Base Functions
async function loadKnowledgeBases() {
  try {
    const response = await fetch('/api/knowledge');
    if (response.ok) {
      knowledgeBases.value = await response.json();
      // If a KB is currently selected, refresh its object reference so reactivity updates the document manager list
      if (selectedKB.value) {
        const updatedSelf = knowledgeBases.value.find(kb => kb.id === selectedKB.value?.id);
        if (updatedSelf) {
          selectedKB.value = updatedSelf;
        } else {
          selectedKB.value = null; // KB was deleted remotely
        }
      }
    }
  } catch (error) {
    console.error('Failed to load knowledge bases:', error);
  }
}

// Thread Functions (History)
async function loadAgents() {
  try {
    const response = await fetch('/api/agents');
    if (response.ok) {
      agents.value = await response.json();
      // Load threads after agents are loaded
      await loadAllThreads();
    }
  } catch (error) {
    console.error('Failed to load agents:', error);
  }
}

async function loadAllThreads() {
  try {
    // Load all threads from all agents
    const allThreads: Thread[] = [];
    for (const agent of agents.value) {
      const response = await fetch(`/api/agents/${agent.id}/threads`);
      if (response.ok) {
        const agentThreads = await response.json();
        for (const thread of agentThreads) {
          allThreads.push({
            ...thread,
            agentName: agent.name,
          });
        }
      }
    }
    threads.value = allThreads.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch (error) {
    console.error('Failed to load threads:', error);
  }
}

async function updateThreadTitle(thread: Thread, newTitle: string) {
  try {
    await fetch(`/api/threads/${thread.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    thread.title = newTitle;
  } catch (error) {
    console.error('Failed to update thread title:', error);
  }
}

function startEditTitle(thread: Thread) {
  const newTitle = prompt(t('knowledge.editTitle'), thread.title);
  if (newTitle !== null && newTitle.trim()) {
    updateThreadTitle(thread, newTitle.trim());
  }
}

async function selectThread(thread: Thread) {
  selectedThread.value = thread;
  try {
    const response = await fetch(`/api/threads/${thread.id}`);
    if (response.ok) {
      const threadData = await response.json();
      threadMessages.value = threadData.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));
    }
  } catch (error) {
    console.error('Failed to load thread messages:', error);
  }
}

async function deleteThread(threadId: string) {
  if (!confirm(t('knowledge.deleteTopicConfirm'))) return;
  try {
    await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
    selectedThread.value = null;
    await loadAllThreads();
  } catch (error) {
    console.error('Failed to delete thread:', error);
  }
}

function continueConversation(thread: Thread) {
  router.push({ path: '/agents', query: { agent: thread.agentId, thread: thread.id } });
}

// Thread Multi-select Functions
function toggleSelectAllThreads() {
  if (selectAllThreads.value) {
    threads.value.forEach(t => selectedThreadIds.value.add(t.id));
  } else {
    selectedThreadIds.value.clear();
  }
}

function toggleThreadSelection(threadId: string) {
  if (selectedThreadIds.value.has(threadId)) {
    selectedThreadIds.value.delete(threadId);
  } else {
    selectedThreadIds.value.add(threadId);
  }
  selectAllThreads.value = threads.value.every(t => selectedThreadIds.value.has(t.id));
}

function isThreadSelected(threadId: string): boolean {
  return selectedThreadIds.value.has(threadId);
}

async function deleteSelectedThreads() {
  if (selectedThreadIds.value.size === 0) return;
  if (!confirm(t('knowledge.deleteSelectedConfirm', { count: selectedThreadIds.value.size }))) return;
  
  try {
    for (const threadId of selectedThreadIds.value) {
      await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
    }
    selectedThreadIds.value.clear();
    selectAllThreads.value = false;
    selectedThread.value = null;
    await loadAllThreads();
  } catch (error) {
    console.error('Failed to delete threads:', error);
  }
}

async function exportSelectedToKnowledge() {
  if (selectedThreadIds.value.size === 0) return;
  
  const selectedThreads = threads.value.filter(th => selectedThreadIds.value.has(th.id));
  const content = selectedThreads.map(th => `# ${th.title || 'Untitled'}\n\nID: ${th.id}\nAgent: ${th.agentName}\nUpdated: ${new Date(th.updatedAt || 0).toLocaleString()}\n`).join('\n---\n\n');
  
  // Create and download file
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `threads-export-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  
  selectedThreadIds.value.clear();
  selectAllThreads.value = false;
}

// Highlight search keywords in content
function highlightKeywords(content: string, query: string, maxLen: number = 200): string {
  if (!query || !content) return escapeHtml(content.slice(0, maxLen));
  const truncated = content.slice(0, maxLen);
  const suffix = content.length > maxLen ? '...' : '';
  // Split query into keywords
  const keywords = query.split(/[\s,，。！？、；：]+/).filter(k => k.length > 0);
  if (keywords.length === 0) return escapeHtml(truncated) + suffix;
  
  // Escape HTML first, then wrap keywords
  let result = escapeHtml(truncated);
  for (const kw of keywords) {
    const escaped = escapeHtml(kw);
    const regex = new RegExp(escapeRegex(escaped), 'gi');
    result = result.replace(regex, `<span class="text-amber-400 font-bold">${escaped}</span>`);
  }
  return result + suffix;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}



async function globalSearch() {
  if (!searchQuery.value.trim()) return;
  searching.value = true;
  globalSearchResults.value = [];
  
  try {
    // Search knowledge base
    const kbResponse = await fetch('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery.value, limit: 5 }),
    });
    
    // Search threads
    const threadResponse = await fetch('/api/memory/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery.value, limit: 5 }),
    });
    
    // Search office messages
    const officeResponse = await fetch('/api/offices/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery.value, limit: 5 }),
    });
    
    const results: typeof globalSearchResults.value = [];
    
    if (kbResponse.ok) {
      const kbResults = await kbResponse.json();
      results.push(...kbResults.map((r: any) => ({
        type: 'knowledge' as const,
        content: r.content,
        source: r.source,
        similarity: r.similarity,
      })));
    }
    
    if (threadResponse.ok) {
      const threadResults = await threadResponse.json();
      results.push(...threadResults.map((r: any) => ({
        type: 'thread' as const,
        content: r.content,
        source: t('knowledge.conversationRecord'),
        similarity: r.similarity,
        conversationId: r.conversationId,
        role: r.role,
        timestamp: r.timestamp,
      })));
    }
    
    if (officeResponse.ok) {
      const officeResults = await officeResponse.json();
      results.push(...officeResults.map((r: any) => ({
        type: 'office' as const,
        content: r.result.entry.content,
        source: r.officeName || t('knowledge.officeConversation'),
        similarity: r.result.similarity,
        officeId: r.officeId,
        officeName: r.officeName,
        role: r.result.entry.metadata.role,
        timestamp: r.result.entry.metadata.timestamp,
      })));
    }
    
    // Sort by similarity
    globalSearchResults.value = results.sort((a, b) => b.similarity - a.similarity);
  } catch (error) {
    console.error('Failed to global search:', error);
  } finally {
    searching.value = false;
  }
}

function jumpToKnowledge(result: typeof globalSearchResults.value[0]) {
  // Find the knowledge base containing this document
  for (const kb of knowledgeBases.value) {
    const doc = kb.documents.find(d => d.originalName === result.source);
    if (doc) {
      selectedKB.value = kb;
      break;
    }
  }
}

function jumpToThread(result: typeof globalSearchResults.value[0]) {
  if (result.conversationId) {
    const thread = threads.value.find(t => t.id === result.conversationId);
    if (thread) {
      selectThread(thread);
    }
  }
}

function jumpToOffice(result: typeof globalSearchResults.value[0]) {
  if (result.officeId) {
    router.push({ path: '/office' });
  }
}

// Utility Functions
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
</script>

<template>
  <div class="h-full overflow-auto p-6">
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500">{{ t('knowledge.title') }}</h1>
        <p class="text-slate-400 mt-2">{{ t('knowledge.subtitle') }}</p>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 w-full">
        <div class="card text-center flex items-center justify-center h-24">
          <div>
            <p class="text-3xl font-bold text-primary-400">{{ stats.knowledgeBases }}</p>
            <p class="text-slate-400 text-base">{{ t('knowledge.knowledgeBases') }}</p>
          </div>
        </div>
        <div class="card text-center flex items-center justify-center h-24">
          <div>
            <p class="text-3xl font-bold text-primary-400">{{ stats.documents }}</p>
            <p class="text-slate-400 text-base">{{ t('knowledge.documents') }}</p>
          </div>
        </div>
        <div class="card text-center flex items-center justify-center h-24">
          <div>
            <p class="text-3xl font-bold text-primary-400">{{ stats.threads }}</p>
            <p class="text-slate-400 text-base">{{ t('knowledge.threadHistory') }}</p>
          </div>
        </div>
      </div>

      <!-- Embedding Config -->
      <LocalModelSelector />

      <!-- Search -->
      <div class="card mb-6" style="position: relative; z-index: 10;">
        <h3 class="text-lg font-semibold mb-4">{{ t('knowledge.semanticSearch') }}</h3>
        <div class="flex gap-4">
          <input v-model="searchQuery" type="text" class="input flex-1" :placeholder="t('knowledge.searchPlaceholder')" @keydown.enter="globalSearch" />
          <button class="btn btn-primary" @click="globalSearch" :disabled="searching">
            {{ searching ? t('knowledge.searching') : t('common.search') }}
          </button>
        </div>
        
        <!-- Search Results -->
        <div v-if="globalSearchResults.length > 0" class="mt-4 space-y-4">
          <!-- Knowledge Results -->
          <div v-if="globalSearchResults.some(r => r.type === 'knowledge')">
            <h4 class="text-sm font-medium text-slate-400 mb-2">{{ t('knowledge.kbResults') }}</h4>
            <div class="space-y-2">
              <div v-for="(result, idx) in globalSearchResults.filter(r => r.type === 'knowledge')" :key="'kb-'+idx" 
                   class="p-4 bg-black/20 border border-white/5 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                   @click="jumpToKnowledge(result)">
                <p class="text-sm" v-html="highlightKeywords(result.content, searchQuery, 200)"></p>
                <div class="flex justify-between items-center mt-1">
                  <span class="text-xs text-slate-400">{{ t('knowledge.source') }}: {{ result.source }}</span>
                  <span class="text-xs text-primary-400">{{ t('knowledge.similarity') }}: {{ (result.similarity * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Thread Results -->
          <div v-if="globalSearchResults.some(r => r.type === 'thread')">
            <h4 class="text-sm font-medium text-slate-400 mb-2">{{ t('knowledge.threadResults') }}</h4>
            <div class="space-y-2">
              <div v-for="(result, idx) in globalSearchResults.filter(r => r.type === 'thread')" :key="'th-'+idx"
                   class="p-4 bg-black/20 border border-white/5 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                   @click="jumpToThread(result)">
                <p class="text-sm" v-html="highlightKeywords(result.content, searchQuery, 200)"></p>
                <div class="flex justify-between items-center mt-1">
                  <span class="text-xs text-slate-400">{{ result.role === 'user' ? t('common.user') : t('common.assistant') }} · {{ result.timestamp ? formatDate(result.timestamp) : '' }}</span>
                  <span class="text-xs text-primary-400">{{ t('knowledge.similarity') }}: {{ (result.similarity * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Office Results -->
          <div v-if="globalSearchResults.some(r => r.type === 'office')">
            <h4 class="text-sm font-medium text-slate-400 mb-2">{{ t('knowledge.officeResults') }}</h4>
            <div class="space-y-2">
              <div v-for="(result, idx) in globalSearchResults.filter(r => r.type === 'office')" :key="'of-'+idx"
                   class="p-4 bg-black/20 border border-white/5 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                   @click="jumpToOffice(result)">
                <p class="text-sm" v-html="highlightKeywords(result.content, searchQuery, 200)"></p>
                <div class="flex justify-between items-center mt-1">
                  <span class="text-xs text-slate-400">{{ result.role === 'user' ? t('common.user') : result.role === 'assistant' ? t('common.assistant') : t('common.system') }} · {{ result.officeName || t('knowledge.officeConversation') }} · {{ result.timestamp ? formatDate(result.timestamp) : '' }}</span>
                  <span class="text-xs text-primary-400">{{ t('knowledge.similarity') }}: {{ (result.similarity * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="searchQuery && !searching" class="mt-4 text-center text-slate-500">
          {{ t('knowledge.searchHint') }}
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-slate-700 mb-4">
        <button
          :class="['px-6 py-3 text-sm font-bold border-b-2 transition-colors', activeTab === 'knowledge' ? 'border-amber-500 text-amber-500' : 'border-transparent text-slate-400 hover:text-white']"
          @click="activeTab = 'knowledge'"
        >
          {{ t('knowledge.knowledgeTab') }}
        </button>
        <button
          :class="['px-6 py-3 text-sm font-bold border-b-2 transition-colors', activeTab === 'history' ? 'border-amber-500 text-amber-500' : 'border-transparent text-slate-400 hover:text-white']"
          @click="activeTab = 'history'"
        >
          {{ t('knowledge.historyTab') }}
        </button>
        <button
          :class="['px-6 py-3 text-sm font-bold border-b-2 transition-colors', activeTab === 'offices' ? 'border-blue-500 text-blue-500' : 'border-transparent text-slate-400 hover:text-white']"
          @click="activeTab = 'offices'"
        >
          {{ t('knowledge.officesTab') }}
        </button>
      </div>

      <!-- Knowledge Base Tab -->
      <div v-if="activeTab === 'knowledge'" class="grid grid-cols-12 gap-6">
        <!-- KB List -->
        <div class="col-span-4">
          <KnowledgeList
            v-model="selectedKB"
            :knowledge-bases="knowledgeBases"
            @refresh="loadKnowledgeBases"
          />
        </div>

        <!-- KB Details -->
        <div class="col-span-8">
          <DocumentManager
            v-if="selectedKB"
            :kb="selectedKB"
            @refresh="loadKnowledgeBases"
          />
          <div v-else class="card text-center py-12">
            <p class="text-slate-400">{{ t('knowledge.selectKbDetail') }}</p>
          </div>
        </div>
      </div>

      <!-- History Tab -->
      <div v-if="activeTab === 'history'" class="grid grid-cols-12 gap-6">
        <!-- Thread List -->
        <div class="col-span-4">
          <div class="card">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-semibold">{{ t('knowledge.historyTopics') }}</h3>
              <div v-if="selectedThreadIds.size > 0" class="flex gap-2">
                <button class="btn btn-danger btn-sm" @click="deleteSelectedThreads">
                  {{ t('knowledge.deleteCount', { count: selectedThreadIds.size }) }}
                </button>
                <button class="btn btn-secondary btn-sm" @click="exportSelectedToKnowledge">
                  {{ t('common.export') }}
                </button>
              </div>
            </div>
            
            <!-- Multi-select Controls -->
            <div v-if="threads.length > 0" class="flex items-center gap-4 mb-3 pb-3 border-b border-slate-700">
              <label class="flex items-center gap-2 text-sm text-slate-400">
                <input 
                  type="checkbox" 
                  :checked="selectAllThreads"
                  @change="selectAllThreads = !selectAllThreads; toggleSelectAllThreads()"
                  class="w-4 h-4 rounded"
                />
                {{ t('common.selectAll') }}
              </label>
              <span class="text-xs text-slate-500">{{ t('knowledge.total') }} {{ threads.length }} {{ t('knowledge.topics') }}</span>
            </div>
            
            <div v-if="threads.length === 0" class="text-center py-4 text-slate-400">{{ t('knowledge.noHistoryTopics') }}</div>
            <div v-else class="space-y-2 max-h-[500px] overflow-auto">
              <div
                v-for="thread in threads"
                :key="thread.id"
                :class="['p-4 rounded-2xl cursor-pointer transition-all border', selectedThread?.id === thread.id ? 'bg-amber-500/10 border-amber-500/20 shadow-inner' : 'bg-black/20 border-white/5 hover:border-white/10']"
                @click="selectThread(thread)"
              >
                <div class="flex justify-between items-start">
                  <div class="flex items-start gap-3 flex-1">
                    <input 
                      type="checkbox" 
                      :checked="isThreadSelected(thread.id)"
                      @change="toggleThreadSelection(thread.id)"
                      class="w-4 h-4 rounded mt-0.5"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-medium truncate">{{ thread.title || t('knowledge.untitledTopic') }}</p>
                        <button class="text-slate-400 hover:text-primary-400 text-xs" @click.stop="startEditTitle(thread)" title="编辑标题">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                      </div>
                      <p class="text-xs text-slate-400">{{ thread.agentName }} · {{ thread.messageCount || 0 }} {{ t('common.messages') }}</p>
                      <p class="text-xs text-slate-500 mt-1">{{ formatDate(thread.updatedAt || 0) }}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button 
                      class="text-primary-400 hover:text-primary-300 text-xs px-2 py-1 rounded bg-primary-500/20" 
                      @click.stop="continueConversation(thread)" 
                      title="继续对话"
                    >
                      {{ t('common.continue') }}
                    </button>
                    <button class="text-red-400 hover:text-red-300 text-sm" @click.stop="deleteThread(thread.id)">{{ t('common.delete') }}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Thread Details -->
        <div class="col-span-8">
          <div v-if="selectedThread" class="card">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-semibold">{{ t('knowledge.topicDetail') }}</h3>
              <button 
                class="btn btn-primary text-sm" 
                @click="continueConversation(selectedThread)"
              >
                {{ t('knowledge.continueConversation') }}
              </button>
            </div>
            <div v-if="threadMessages.length === 0" class="text-center py-4 text-slate-400">{{ t('knowledge.noMessages') }}</div>
            <div v-else class="space-y-4 max-h-[500px] overflow-auto custom-scrollbar p-2">
              <div
                v-for="(msg, index) in threadMessages"
                :key="index"
                class="flex flex-col"
                :class="msg.role === 'user' ? 'items-end' : 'items-start'"
              >
                <div class="flex items-center gap-2 mb-1 px-1">
                  <span v-if="msg.role === 'assistant'" class="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                    {{ selectedThread?.agentName || 'AI' }}
                  </span>
                  <span v-else class="text-[10px] font-bold text-amber-500 uppercase tracking-wider">{{ t('common.user') }}</span>
                  <span class="text-[9px] text-slate-600">{{ new Date(msg.timestamp).toLocaleString() }}</span>
                </div>
                <div 
                  :class="[
                    'max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm',
                    msg.role === 'user' 
                      ? 'bg-amber-500/15 text-amber-100 border border-amber-500/10 rounded-tr-none' 
                      : 'bg-white/[0.03] text-slate-200 border border-white/5 rounded-tl-none'
                  ]"
                >
                  <div class="whitespace-pre-wrap">{{ msg.content }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Office Conversations Tab -->
      <div v-if="activeTab === 'offices'" class="grid grid-cols-12 gap-6">
        <!-- Office List -->
        <div class="col-span-4">
          <div class="card">
            <h3 class="text-lg font-semibold mb-4">{{ t('knowledge.officeRooms') }}</h3>
            <div v-if="loadingOffices" class="text-center py-4 text-slate-400 italic">{{ t('common.loading') }}</div>
            <div v-else-if="offices.length === 0" class="text-center py-4 text-slate-400">{{ t('knowledge.noOffices') }}</div>
            <div v-else class="space-y-2 max-h-[500px] overflow-auto">
              <div
                v-for="office in offices"
                :key="office.id"
                :class="['p-4 rounded-2xl cursor-pointer transition-all border', selectedOffice?.id === office.id ? 'bg-blue-500/10 border-blue-500/20 shadow-inner' : 'bg-black/20 border-white/5 hover:border-white/10']"
                @click="selectOfficeConversation(office)"
              >
                <div class="flex justify-between items-center">
                  <div>
                    <h4 class="font-medium text-white">{{ office.name }}</h4>
                    <p class="text-xs text-slate-400">{{ office.agentIds?.length || 0 }} {{ t('knowledge.members') }} · {{ office.status === 'busy' ? t('knowledge.busy') : t('knowledge.idle') }}</p>
                  </div>
                  <div class="w-2 h-2 rounded-full" :class="office.status === 'busy' ? 'bg-amber-400 animate-pulse' : 'bg-blue-400'"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Office Conversation Details -->
        <div class="col-span-8">
          <div v-if="selectedOffice" class="card">
            <div class="flex justify-between items-center mb-4 pb-4 border-b border-white/5">
              <div>
                <h3 class="text-lg font-semibold">{{ selectedOffice.name }} - {{ t('knowledge.conversationRecords') }}</h3>
                <p class="text-xs text-slate-500 mt-1">{{ t('knowledge.recordsNote') }}</p>
              </div>
              <button 
                class="py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-xl transition-colors" 
                @click="router.push({ path: '/office', query: { officeId: selectedOffice.id } })"
              >
                {{ t('knowledge.enterOffice') }}
              </button>
            </div>
            <div v-if="officeMessages.length === 0" class="text-center py-12 text-slate-500 italic">
              {{ t('knowledge.noConversationRecords') }}
            </div>
            <div v-else class="space-y-4 max-h-[550px] overflow-auto custom-scrollbar p-2">
              <div
                v-for="msg in officeMessages"
                :key="msg.id"
                class="flex flex-col"
                :class="msg.role === 'user' ? 'items-end' : 'items-start'"
              >
                <div class="flex items-center gap-2 mb-1 px-1">
                  <span v-if="msg.role === 'assistant'" class="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                    {{ agents.find(a => a.id === msg.agentId)?.name || t('knowledge.groupMember') }}
                  </span>
                  <span v-else class="text-[10px] font-bold text-amber-500 uppercase tracking-wider">{{ t('common.user') }}</span>
                  <span class="text-[9px] text-slate-600">{{ new Date(msg.timestamp).toLocaleString() }}</span>
                </div>
                <div 
                  :class="[
                    'max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm',
                    msg.role === 'user' 
                      ? 'bg-amber-500/15 text-amber-100 border border-amber-500/10 rounded-tr-none' 
                      : 'bg-white/[0.03] text-slate-200 border border-white/5 rounded-tl-none'
                  ]"
                >
                  <div class="whitespace-pre-wrap">{{ msg.content }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="card text-center py-20 flex flex-col items-center justify-center border-dashed border-2 border-white/5">
            <div class="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
              <svg class="w-8 h-8 text-blue-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"></path></svg>
            </div>
            <p class="text-slate-500">从左侧选择一个办公室查看对话记录</p>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
