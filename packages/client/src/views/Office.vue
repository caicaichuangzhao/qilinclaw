<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CustomSelect from '../components/CustomSelect.vue';
import { fetchSSE } from '../utils/stream';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface Agent {
  id: string;
  name: string;
  avatar?: string;
  defaultModel?: string;
}

interface ModelConfig {
  id: string;
  name: string;
  model: string;
  provider: string;
  enabled: boolean;
}

interface Office {
  id: string;
  name: string;
  status: 'busy' | 'loafing' | 'pending';
  agentIds: string[];
  leaderId?: string;
  currentTask?: string;
  agentConfigs?: Record<string, { configId: string }>;
  agentRoles?: Record<string, { position: string; mission: string }>;
  botChannels?: Record<string, { channelId: string; platform: string }>;
}

const offices = ref<Office[]>([]);
const agents = ref<Agent[]>([]);
const modelConfigs = ref<ModelConfig[]>([]);

const route = useRoute();
const router = useRouter();

const currentTab = ref<'busy' | 'loafing' | 'pending'>((route.query.tab as any) || 'loafing');

watch(currentTab, (val) => {
  router.replace({ query: { ...route.query, tab: val } }).catch(() => {});
});

const modelConfigOptions = computed(() => {
  return [
    { value: '', label: '— 默认模型 —' },
    ...modelConfigs.value.map(cfg => ({ value: cfg.id, label: cfg.name }))
  ];
});

const filteredOffices = computed(() => {
  return offices.value.filter(o => o.status === currentTab.value);
});

const busyOfficesCount = computed(() => offices.value.filter(o => o.status === 'busy').length);
const loafingOfficesCount = computed(() => offices.value.filter(o => o.status === 'loafing').length);
const pendingOfficesCount = computed(() => offices.value.filter(o => o.status === 'pending').length);

async function fetchOffices() {
  try {
    const res = await fetch('/api/offices');
    if (res.ok) offices.value = await res.json();
  } catch (err) {
    console.error('Failed to fetch offices:', err);
  }
}

async function fetchAgents() {
  try {
    const res = await fetch('/api/agents');
    if (res.ok) agents.value = await res.json();
  } catch (err) {
    console.error('Failed to fetch agents:', err);
  }
}

async function fetchModelConfigs() {
  try {
    const res = await fetch('/api/models/configs');
    if (res.ok) {
      const all: ModelConfig[] = await res.json();
      modelConfigs.value = all.filter(c => c.enabled);
    }
  } catch (err) {
    console.error('Failed to fetch model configs:', err);
  }
}

onMounted(async () => {
  await Promise.all([fetchAgents(), fetchOffices(), fetchModelConfigs()]);
  
  if (route.query.officeId) {
    const target = offices.value.find(o => o.id === route.query.officeId);
    if (target) {
      openOfficeChat(target);
      // Clean up the URL to avoid reopening on refresh
      router.replace({ query: { ...route.query, officeId: undefined } }).catch(() => {});
    }
  }
});

const showCreateModal = ref(false);
const isEditing = ref(false);
const editingOfficeId = ref('');
const newOfficeName = ref('');
const draggedAgent = ref<Agent | null>(null);
const newOfficeAgents = ref<Agent[]>([]);
const newOfficeLeaderId = ref('');
// per-agent configId map: { [agentId]: configId }
const newOfficeAgentConfigs = ref<Record<string, string>>({});
const newOfficeAgentRoles = ref<Record<string, { position: string; mission: string }>>({});

const showChatDrawer = ref(false);
const chatOffice = ref<Office | null>(null);

function editOffice(office: Office) {
  isEditing.value = true;
  editingOfficeId.value = office.id;
  newOfficeName.value = office.name;
  newOfficeAgents.value = agents.value.filter(a => office.agentIds.includes(a.id));
  newOfficeLeaderId.value = office.leaderId || '';
  // Restore per-agent config
  const cfgs: Record<string, string> = {};
  if (office.agentConfigs) {
    for (const [agentId, cfg] of Object.entries(office.agentConfigs)) {
      cfgs[agentId] = cfg.configId;
    }
  }
  // If no config, use agent's default model
  for (const agent of newOfficeAgents.value) {
    if (!cfgs[agent.id] && agent.defaultModel) {
      cfgs[agent.id] = agent.defaultModel;
    }
  }
  newOfficeAgentConfigs.value = cfgs;
  // Restore per-agent roles
  const roles: Record<string, { position: string; mission: string }> = {};
  if (office.agentRoles) {
    for (const [agentId, role] of Object.entries(office.agentRoles)) {
      roles[agentId] = { ...role };
    }
  }
  newOfficeAgentRoles.value = roles;

  showCreateModal.value = true;
}

const chatMessagesContainer = ref<HTMLElement | null>(null);

function scrollChatToBottom() {
  nextTick(() => {
    if (chatMessagesContainer.value) {
      chatMessagesContainer.value.scrollTop = chatMessagesContainer.value.scrollHeight;
    }
  });
}

function openOfficeChat(office: Office) {
  chatOffice.value = office;
  showChatDrawer.value = true;
}

const availableAgents = computed(() => {
  const usedAgentIds = new Set<string>();
  offices.value.forEach(o => {
    if (isEditing.value && o.id === editingOfficeId.value) return;
    o.agentIds.forEach(id => usedAgentIds.add(id));
  });
  const newOfficeAgentIds = new Set(newOfficeAgents.value.map(a => a.id));
  return agents.value.filter(a => !usedAgentIds.has(a.id) && !newOfficeAgentIds.has(a.id));
});

function onDragStart(event: DragEvent, agent: Agent) {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  draggedAgent.value = agent;
}

function onDrop(_event: DragEvent) {
  if (draggedAgent.value && !newOfficeAgents.value.find(a => a.id === draggedAgent.value!.id)) {
    newOfficeAgents.value.push(draggedAgent.value);
    // Use agent's default model if available
    if (draggedAgent.value.defaultModel) {
      newOfficeAgentConfigs.value[draggedAgent.value.id] = draggedAgent.value.defaultModel;
    }
  }
  draggedAgent.value = null;
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
}

function getAgentRole(agentId: string, field: 'position' | 'mission'): string {
  return newOfficeAgentRoles.value[agentId]?.[field] || '';
}

function setAgentRole(agentId: string, field: 'position' | 'mission', value: string) {
  if (!newOfficeAgentRoles.value[agentId]) {
    newOfficeAgentRoles.value[agentId] = { position: '', mission: '' };
  }
  newOfficeAgentRoles.value[agentId][field] = value;
}

function removeNewAgent(agent: Agent) {
  newOfficeAgents.value = newOfficeAgents.value.filter(a => a.id !== agent.id);
  if (newOfficeLeaderId.value === agent.id) {
    newOfficeLeaderId.value = '';
  }
  delete newOfficeAgentConfigs.value[agent.id];

}

function toggleLeader(agent: Agent) {
  newOfficeLeaderId.value = newOfficeLeaderId.value === agent.id ? '' : agent.id;
}

function resetModal() {
  showCreateModal.value = false;
  isEditing.value = false;
  editingOfficeId.value = '';
  newOfficeName.value = '';
  newOfficeAgents.value = [];
  newOfficeLeaderId.value = '';
  newOfficeAgentConfigs.value = {};

  draggedAgent.value = null;
}

async function saveOffice() {
  if (!newOfficeName.value.trim()) {
    alert(t('office.enterOfficeName'));
    return;
  }

  // Build agentConfigs from per-agent selections
  const agentConfigs: Record<string, { configId: string }> = {};
  for (const [agentId, configId] of Object.entries(newOfficeAgentConfigs.value)) {
    if (configId) agentConfigs[agentId] = { configId };
  }

  // Build agentRoles from per-agent role info
  const agentRoles: Record<string, { position: string; mission: string }> = {};
  for (const [agentId, role] of Object.entries(newOfficeAgentRoles.value)) {
    if (role.position || role.mission) {
      agentRoles[agentId] = { position: role.position || '', mission: role.mission || '' };
    }
  }

  try {
    const url = isEditing.value ? `/api/offices/${editingOfficeId.value}` : '/api/offices';
    const method = isEditing.value ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newOfficeName.value.trim(),
        status: isEditing.value ? undefined : 'loafing',
        agentIds: newOfficeAgents.value.map(a => a.id),
        leaderId: newOfficeLeaderId.value || undefined,
        agentConfigs: Object.keys(agentConfigs).length > 0 ? agentConfigs : undefined,
        agentRoles: Object.keys(agentRoles).length > 0 ? agentRoles : undefined,
      })
    });

    if (res.ok) {
      await fetchOffices();
      resetModal();
      if (!isEditing.value) {
        currentTab.value = 'loafing';
      }
    } else {
      alert(isEditing.value ? t('office.editFailed') : t('office.createFailed'));
    }
  } catch (err) {
    console.error('Save office error:', err);
    alert(t('office.networkError'));
  }
}

async function deleteOffice(office: Office) {
  if (!confirm(t('office.deleteConfirm', { name: office.name }))) return;
  
  try {
    const res = await fetch(`/api/offices/${office.id}`, {
      method: 'DELETE',
    });
    
    if (res.ok) {
      await fetchOffices();
      if (chatOffice.value?.id === office.id) {
        showChatDrawer.value = false;
        chatOffice.value = null;
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`${t('office.deleteFailed')}: ${err.error || 'Unknown'}`);
    }
  } catch (err) {
    console.error('Delete office error:', err);
    alert(t('office.networkError'));
  }
}

// ── Task dispatch ──────────────────────────────────────────────────────────
const showDispatchModal = ref(false);
const dispatchOffice = ref<Office | null>(null);
const dispatchTaskInput = ref('');
const isDispatching = ref(false);

interface DispatchLog {
  type: string;
  message?: string;
  member?: string;
  subtask?: string;
  result?: string;
  approved?: boolean;
  feedback?: string;
  plan?: string;
  summary?: string;
  attempt?: number;
  assignments?: Array<{ member: string; subtask: string }>;
}

const dispatchLogs = ref<DispatchLog[]>([]);

// Reject task modal
const showRejectModal = ref(false);
const rejectOffice = ref<Office | null>(null);
const rejectFeedback = ref('');

// Task summary modal
const showSummaryModal = ref(false);
const summaryOffice = ref<Office | null>(null);
const summaryContent = ref('');
const summaryLoading = ref(false);

function openDispatchModal(office: Office) {
  dispatchOffice.value = office;
  dispatchTaskInput.value = office.currentTask || '';
  dispatchLogs.value = [];
  isDispatching.value = false;
  showDispatchModal.value = true;
}

async function dispatchTask() {
  if (!dispatchTaskInput.value.trim() || !dispatchOffice.value) return;
  if (!dispatchOffice.value.leaderId) {
    alert(t('office.selectLeader'));
    return;
  }

  isDispatching.value = true;
  dispatchLogs.value = [];

  const currentOffice = dispatchOffice.value;

  // Immediately switch to busy tab so user sees the status change
  currentTab.value = 'busy';
  let dispatchStarted = false;

  try {
    await fetchSSE(`/api/offices/${currentOffice.id}/dispatch-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: dispatchTaskInput.value.trim() }),
      onChunk: async (data: any) => {
        // Refresh offices once on first chunk so 'busy' status shows
        if (!dispatchStarted) {
          dispatchStarted = true;
          await fetchOffices();
        }
        dispatchLogs.value.push(data);
        if (data.type === 'done' || data.type === 'error') {
          await fetchOffices();
          // Auto-open chat drawer to show task progress
          showDispatchModal.value = false;
          const updated = offices.value.find(o => o.id === currentOffice.id);
          if (updated) {
            openOfficeChat(updated);
            // Switch to the correct tab based on final status
            currentTab.value = updated.status === 'pending' ? 'pending' : updated.status;
          }
        }
      },
      onError: (errMessage: any) => {
        console.error('Dispatch task SSE error:', errMessage);
        alert(t('office.dispatchFailed'));
      }
    });
  } catch (err) {
    console.error('Dispatch task error:', err);
    dispatchLogs.value.push({ type: 'error', message: t('office.serviceError') });
    await fetchOffices(); // Refresh to show actual status
  } finally {
    isDispatching.value = false;
  }
}

async function acceptOfficeTask(office: Office) {
  if (!confirm(t('office.acceptConfirm', { name: office.name }))) return;
  try {
    // Get task summary from office messages history
    const msgsRes = await fetch(`/api/offices/${office.id}/messages`);
    let archiveContent = office.currentTask || '已完成任务';
    if (msgsRes.ok) {
      const msgs = await msgsRes.json();
      // Collect all assistant messages to form a complete task archive
      const taskMsgs = msgs.filter((m: any) => m.role === 'assistant' || m.role === 'user');
      archiveContent = taskMsgs.map((m: any) => `[${m.role === 'user' ? '用户' : m.agentId || 'Agent'}]: ${m.content}`).join('\n\n---\n\n');
    }

    const kbRes = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `[验收归档] ${office.name} - ${(office.currentTask || '').slice(0, 40)}`,
        description: `来自办公室「${office.name}」的已完成任务归档`,
      })
    });

    if (kbRes.ok) {
      const kb = await kbRes.json();
      const base64Content = btoa(unescape(encodeURIComponent(archiveContent)));
      await fetch(`/api/knowledge/${kb.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: base64Content, filename: `${office.name}.md`, mimeType: 'text/plain' })
      });
    }

    await fetch(`/api/offices/${office.id}/close-task`, { method: 'POST' });
    await fetchOffices();
    alert(t('office.acceptSuccess'));
  } catch (err) {
    console.error('Failed to accept task:', err);
    alert(t('office.acceptFailed'));
  }
}

async function viewTaskResults(office: Office) {
  summaryOffice.value = office;
  summaryContent.value = '';
  summaryLoading.value = true;
  showSummaryModal.value = true;
  try {
    const res = await fetch(`/api/offices/${office.id}/memory`);
    if (res.ok) {
      const memory = await res.json();
      summaryContent.value = memory.taskSummary || t('office.noTaskSummary');
    } else {
      summaryContent.value = t('office.cannotGetSummary');
    }
  } catch {
    summaryContent.value = t('office.loadFailed');
  } finally {
    summaryLoading.value = false;
  }
}

async function rejectOfficeTask(office: Office) {
  rejectOffice.value = office;
  rejectFeedback.value = '';
  showRejectModal.value = true;
}

async function confirmRejectTask() {
  if (!rejectOffice.value) return;
  const office = rejectOffice.value;
  const feedback = rejectFeedback.value.trim() || t('office.rejectDefault');
  const task = office.currentTask;
  showRejectModal.value = false;
  try {
    const res = await fetch(`/api/offices/${office.id}/reject-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    if (res.ok) {
      await fetchOffices();
      currentTab.value = 'busy';
      // Open dispatch modal pre-filled so user can one-click re-dispatch
      const updated = offices.value.find(o => o.id === office.id);
      if (updated && task) {
        dispatchOffice.value = updated;
        dispatchTaskInput.value = task;
        dispatchLogs.value = [];
        isDispatching.value = false;
        showDispatchModal.value = true;
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`${t('office.rejectFailed')}: ${err.error || 'Unknown'}`);
    }
  } catch (err) {
    console.error('Failed to reject task:', err);
    alert(t('office.rejectTaskFailed'));
  }
}

function getAgentDetails(id: string) {
  return agents.value.find(a => a.id === id) || { name: '未知 Agent', avatar: '' };
}

function getConfigName(configId: string) {
  const cfg = modelConfigs.value.find(c => c.id === configId);
  return cfg ? cfg.name : '默认';
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  agentId?: string;
}

const chatInput = ref('');
const isChatSending = ref(false);
const officeMessages = ref<Record<string, ChatMessage[]>>({});
const officeChatFiles = ref<File[]>([]);
const officeChatFileInput = ref<HTMLInputElement | null>(null);

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) officeChatFiles.value.push(file);
    }
  }
}

function isImageType(type: string): boolean {
  return type.startsWith('image/');
}

function isVideoType(type: string): boolean {
  return type.startsWith('video/');
}

function isAudioType(type: string): boolean {
  return type.startsWith('audio/');
}

async function sendOfficeMessage() {
  if (!chatInput.value.trim() || !chatOffice.value) return;

  const officeId = chatOffice.value.id;
  const content = chatInput.value.trim();

  let targetAgentId = '';
  let targetAgentName = '';

  for (const aid of chatOffice.value.agentIds) {
    const details = getAgentDetails(aid);
    if (content.includes(`@${details.name}`)) {
      targetAgentId = aid;
      targetAgentName = details.name;
      break;
    }
  }

  if (!targetAgentId) {
    if (chatOffice.value.agentIds.length > 0) {
      targetAgentId = chatOffice.value.agentIds[0]; // Default to first agent
      targetAgentName = getAgentDetails(targetAgentId).name;
    } else {
      alert('办公室内没有可对话的Agent');
      return;
    }
  }

  const userMsg: ChatMessage = {
    role: 'user',
    content: content,
  };

  if (!officeMessages.value[officeId]) {
    officeMessages.value[officeId] = [];
  }
  officeMessages.value[officeId].push(userMsg);

  const currentMsgObj = {
    role: 'assistant',
    content: '',
    name: targetAgentName
  };
  officeMessages.value[officeId].push(currentMsgObj as ChatMessage);

  chatInput.value = '';
  isChatSending.value = true;

  try {
    await fetchSSE(`/api/offices/${officeId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: targetAgentId,
        content: content,
        attachments: []
      }),
      onChunk: (data: any) => {
        if (data.type === 'chunk' && data.delta) {
          currentMsgObj.content += data.delta;
        } else if (data.type === 'error') {
          currentMsgObj.content = `Error: ${data.message}`;
        }
      },
      onError: (errMessage: any) => {
        currentMsgObj.content = `Error: ${errMessage}`;
      }
    });
  } catch(err) {
    currentMsgObj.content = t('office.chatError');
  } finally {
    isChatSending.value = false;
  }
}

async function loadOfficeMessages(office: Office) {
  try {
    const res = await fetch(`/api/offices/${office.id}/messages`);
    if (res.ok) {
      officeMessages.value[office.id] = await res.json();
      scrollChatToBottom();
    }
  } catch (err) {
    console.error('Failed to load office messages:', err);
  }
}

watch(chatOffice, (newOffice) => {
  if (newOffice) {
    loadOfficeMessages(newOffice);
  }
});
</script>

<template>
<div class="h-full flex flex-col p-6 space-y-6 overflow-auto relative">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500">
        {{ t('office.title') }}
      </h1>
      <p class="text-slate-400 mt-2">{{ t('office.subtitle') }}</p>
    </div>
    <button @click="showCreateModal = true" class="py-2 px-6 text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors shadow-lg shadow-amber-500/20">
      {{ t('office.createOffice') }}
    </button>
  </div>

  <!-- 状态统计卡片 -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div
      @click="currentTab = 'busy'"
      :class="['border rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-[1.02]', currentTab === 'busy' ? 'bg-amber-500/10 border-amber-500/40' : 'bg-white/[0.02] border-white/[0.05] hover:border-white/10']"
    >
      <div class="text-4xl font-bold text-amber-400 mb-1">{{ busyOfficesCount }}</div>
      <div class="text-xs text-slate-400 font-semibold tracking-wide uppercase">{{ t('office.busyCount') }}</div>
    </div>
    <div
      @click="currentTab = 'loafing'"
      :class="['border rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-[1.02]', currentTab === 'loafing' ? 'bg-blue-500/10 border-blue-500/40' : 'bg-white/[0.02] border-white/[0.05] hover:border-white/10']"
    >
      <div class="text-4xl font-bold text-blue-400 mb-1">{{ loafingOfficesCount }}</div>
      <div class="text-xs text-slate-400 font-semibold tracking-wide uppercase">{{ t('office.idleCount') }}</div>
    </div>
    <div
      @click="currentTab = 'pending'"
      :class="['border rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-[1.02]', currentTab === 'pending' ? 'bg-green-500/10 border-green-500/40' : 'bg-white/[0.02] border-white/[0.05] hover:border-white/10']"
    >
      <div class="text-4xl font-bold text-green-400 mb-1">{{ pendingOfficesCount }}</div>
      <div class="text-xs text-slate-400 font-semibold tracking-wide uppercase">{{ t('office.pendingCount') }}</div>
    </div>
  </div>

  <!-- 办公室列表 -->
  <div class="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 flex-1 flex flex-col min-h-[280px]">
    <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
      <span v-if="currentTab === 'busy'" class="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block"></span>
      <span v-if="currentTab === 'loafing'" class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>
      <span v-if="currentTab === 'pending'" class="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
      {{ currentTab === 'busy' ? t('office.busyOffices') : currentTab === 'loafing' ? t('office.idleOffices') : t('office.pendingOffices') }}
    </h2>

    <div v-if="filteredOffices.length === 0" class="flex-1 flex flex-col items-center justify-center text-slate-600">
      <p class="text-sm">{{ t('office.noOfficesInStatus') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <div
        v-for="office in filteredOffices"
        :key="office.id"
        class="bg-[#1e2330] border border-white/[0.05] rounded-2xl p-4 flex flex-col hover:border-white/10 transition-all"
      >
        <!-- 标题行 -->
        <div class="flex items-start justify-between mb-3 gap-2">
          <h3 class="text-white font-bold text-base leading-tight truncate">{{ office.name }}</h3>
          <span
            class="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border"
            :class="{
              'bg-amber-500/15 text-amber-400 border-amber-500/25': office.status === 'busy',
              'bg-blue-500/15 text-blue-400 border-blue-500/25': office.status === 'loafing',
              'bg-green-500/15 text-green-400 border-green-500/25': office.status === 'pending'
            }"
          >
            <div v-if="office.status === 'busy'" class="dot-animation large h-3 mr-1.5 text-amber-400">
              <span></span><span></span><span></span>
            </div>
            <span v-else-if="office.status === 'loafing'" class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
            <span v-else class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
            <span :class="{ 'font-bold animate-pulse': office.status === 'busy' }">
              {{ office.status === 'busy' ? t('office.aiWorking') : office.status === 'loafing' ? t('office.idle') : t('office.pending') }}
            </span>
          </span>
        </div>

        <!-- 成员列表 -->
        <div class="flex-1 mb-3">
          <div class="flex flex-wrap gap-1.5 mb-2">
            <span
              v-for="agentId in office.agentIds"
              :key="agentId"
              class="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] border"
              :class="agentId === office.leaderId ? 'bg-amber-500/15 text-amber-300 border-amber-500/25 font-bold' : 'bg-white/[0.04] text-slate-400 border-white/[0.06]'"
            >
              <span v-if="agentId === office.leaderId">👑</span>
              {{ getAgentDetails(agentId).name }}
              <span v-if="office.agentConfigs?.[agentId]?.configId" class="opacity-50">· {{ getConfigName(office.agentConfigs?.[agentId]?.configId ?? '') }}</span>
            </span>
            <span v-if="office.agentIds.length === 0" class="text-xs text-slate-600 italic">{{ t('office.noMembers') }}</span>
          </div>
          <div v-if="office.currentTask" class="text-[11px] text-slate-500 line-clamp-2 bg-black/20 rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
            📌 {{ office.currentTask }}
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-1.5 flex-wrap justify-end">
          <button
            v-if="office.status === 'pending'"
            @click="acceptOfficeTask(office)"
            class="py-1.5 px-3 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-bold rounded-xl border border-green-500/20 transition-colors"
          >{{ t('office.accept') }}</button>
          <button
            v-if="office.status !== 'busy'"
            @click="openDispatchModal(office)"
            class="py-1.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-bold rounded-xl border border-amber-500/20 transition-colors"
          >{{ t('office.dispatchTask') }}</button>
          <button
            @click="openOfficeChat(office)"
            class="py-1.5 px-3 bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 text-xs rounded-xl border border-white/[0.06] transition-colors"
          >💬</button>
          <button
            @click="editOffice(office)"
            class="py-1.5 px-3 bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 text-xs rounded-xl border border-white/[0.06] transition-colors"
          >✏️</button>
          <button
            @click="deleteOffice(office)"
            title="解散办公室"
            class="py-1.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs rounded-xl border border-red-500/20 transition-colors"
          >🗑️</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 待验收任务墙（pending tab专属） -->
  <div v-if="currentTab === 'pending' && filteredOffices.length > 0" class="bg-white/[0.02] border border-green-500/10 rounded-2xl p-5">
    <h2 class="text-sm font-bold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-green-400 inline-block"></span> {{ t('office.pendingWall') }}
    </h2>
    <div class="space-y-2">
      <div
        v-for="office in filteredOffices"
        :key="office.id"
        class="bg-[#1e2330] border border-green-500/15 rounded-xl p-3 flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="font-bold text-white text-sm">{{ office.name }}</span>
            <span v-if="office.leaderId" class="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded-lg">
              👑 {{ getAgentDetails(office.leaderId).name }}
            </span>
          </div>
          <p class="text-slate-500 text-xs truncate">{{ office.currentTask || t('office.taskCompleted') }}</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button
            @click="viewTaskResults(office)"
            class="py-1.5 px-3 text-xs font-bold bg-blue-500/15 hover:bg-blue-500/30 text-blue-400 rounded-xl border border-blue-500/25 transition-colors"
          >{{ t('office.viewResults') }}</button>
          <button
            @click="rejectOfficeTask(office)"
            class="py-1.5 px-3 text-xs font-bold bg-red-500/15 hover:bg-red-500/30 text-red-400 rounded-xl border border-red-500/25 transition-colors"
          >{{ t('office.rejectTask') }}</button>
          <button
            @click="acceptOfficeTask(office)"
            class="py-1.5 px-3 text-xs font-bold bg-green-500/15 hover:bg-green-500/30 text-green-400 rounded-xl border border-green-500/25 transition-colors"
          >{{ t('office.acceptTask') }}</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 驳回任务弹窗 -->
  <div v-if="showRejectModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="bg-[#1a1c23] border border-red-500/20 rounded-2xl shadow-2xl w-full max-w-md p-6">
      <h3 class="text-lg font-bold text-red-400 mb-1">❌ {{ t('office.rejectTaskTitle') }}</h3>
      <p class="text-slate-500 text-xs mb-4">办公室「{{ rejectOffice?.name }}」的任务将被退回，可重新下发</p>
      <div class="mb-4">
        <label class="block text-xs font-bold text-slate-400 mb-2">{{ t('office.rejectReason') }}</label>
        <textarea
          v-model="rejectFeedback"
          :placeholder="t('office.rejectPlaceholder')"
          class="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-red-500/50 transition-colors resize-none h-28"
        ></textarea>
      </div>
      <div class="flex justify-end gap-3">
        <button
          @click="showRejectModal = false"
          class="px-4 py-2 text-sm font-bold text-slate-400 bg-white/[0.05] hover:bg-white/[0.1] rounded-xl border border-white/[0.06] transition-colors"
        >{{ t('common.cancel') }}</button>
        <button
          @click="confirmRejectTask"
          class="px-5 py-2 text-sm font-bold text-white bg-red-500/80 hover:bg-red-500 rounded-xl transition-colors shadow-lg shadow-red-500/20"
        >{{ t('office.confirmReject') }}</button>
      </div>
    </div>
  </div>

  <!-- 任务总结弹窗 -->
  <div v-if="showSummaryModal && summaryOffice" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="bg-[#1a1c23] border border-blue-500/20 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden" style="max-height: 80vh">
      <div class="px-5 py-4 border-b border-white/[0.06] flex justify-between items-center shrink-0">
        <div>
          <h3 class="text-base font-bold text-white">📋 {{ t('office.taskSummary') }}</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ summaryOffice.name }} ·
            组长：<span class="text-amber-400">{{ summaryOffice.leaderId ? getAgentDetails(summaryOffice.leaderId).name : '未指定' }}</span>
          </p>
        </div>
        <button @click="showSummaryModal = false" class="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <div class="p-6 flex-1 overflow-y-auto custom-scrollbar">
        <div v-if="summaryLoading" class="flex items-center justify-center py-12 text-slate-500">
          <svg class="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
          {{ t('common.loading') }}
        </div>
        <div v-else class="prose prose-invert prose-sm max-w-none text-slate-200 whitespace-pre-wrap leading-relaxed">{{ summaryContent }}</div>
      </div>
      <div class="px-5 py-4 border-t border-white/[0.06] flex justify-end gap-2 shrink-0 bg-black/20">
        <button @click="openOfficeChat(summaryOffice!); showSummaryModal = false" class="px-4 py-2 rounded-xl text-sm font-bold text-amber-400 hover:text-amber-300 hover:bg-white/[0.06] transition-colors">
          💬 查看完整对话
        </button>
        <button @click="showSummaryModal = false" class="px-5 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>

  <!-- 组建/编辑办公室弹窗 -->
  <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="bg-[#1a1c23] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden" style="max-height: 88vh">
      <!-- 头部 -->
      <div class="px-6 py-4 border-b border-white/[0.06] flex justify-between items-center shrink-0">
        <div>
          <h3 class="text-lg font-bold text-white">{{ isEditing ? t('office.editOffice') : t('office.createOrEditOffice') }}</h3>
          <p class="text-xs text-slate-500 mt-0.5">从左侧拖拽 Agent 到右侧，为每位成员指定模型和角色</p>
        </div>
        <button @click="resetModal" class="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <div class="flex flex-col gap-4 p-5 overflow-y-auto flex-1 custom-scrollbar">
        <!-- 名称 -->
        <div>
          <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{{ t('office.officeName') }}</label>
          <input
            v-model="newOfficeName"
            type="text"
            :placeholder="t('office.officeNamePlaceholder')"
            class="w-full bg-black/30 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>

        <!-- 拖拽区域 -->
        <div class="flex gap-3 min-h-[360px]">
          <!-- 左侧：可选 Agents -->
          <div class="w-44 shrink-0 flex flex-col bg-black/20 rounded-xl border border-white/[0.05] p-3">
            <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">{{ t('office.availableAgents') }}</p>
            <div class="flex-1 space-y-1.5 overflow-y-auto custom-scrollbar">
              <div
                v-for="agent in availableAgents"
                :key="agent.id"
                draggable="true"
                @dragstart="onDragStart($event, agent)"
                class="flex items-center gap-2 p-2 rounded-xl border border-white/[0.04] bg-white/[0.02] cursor-grab hover:bg-white/[0.05] hover:border-amber-500/25 transition-all active:cursor-grabbing select-none"
              >
                <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
                  {{ agent.name.charAt(0) }}
                </div>
                <span class="text-sm text-slate-300 truncate font-medium">{{ agent.name }}</span>
              </div>
              <div v-if="availableAgents.length === 0" class="text-center text-xs text-slate-600 py-6">
                {{ t('office.noAvailableAgents') }}
              </div>
            </div>
          </div>

          <!-- 右侧：办公室成员卡片区 -->
          <div
            class="flex-1 rounded-xl border-2 border-dashed p-3 transition-all flex flex-col overflow-hidden"
            :class="draggedAgent ? 'border-amber-500/50 bg-amber-500/[0.04]' : 'border-white/[0.08] bg-black/10'"
            @dragover="onDragOver"
            @drop="onDrop"
          >
            <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              {{ t('office.assignedAgents') }}
              <span v-if="newOfficeLeaderId" class="ml-2 text-amber-400 normal-case font-normal">· 👑 {{ newOfficeAgents.find(a => a.id === newOfficeLeaderId)?.name }} {{ t('office.leader') }}</span>
            </p>

            <div v-if="newOfficeAgents.length === 0" class="flex-1 flex flex-col items-center justify-center text-slate-600 pointer-events-none">
              <svg class="w-8 h-8 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"></path></svg>
              <p class="text-sm">{{ t('office.dragHint') }}</p>
            </div>

            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto custom-scrollbar">
              <div
                v-for="agent in newOfficeAgents"
                :key="agent.id"
                class="rounded-xl border p-3 flex flex-col gap-2.5 transition-all"
                :class="newOfficeLeaderId === agent.id ? 'bg-amber-500/[0.08] border-amber-500/30' : 'bg-white/[0.02] border-white/[0.06]'"
                style="box-sizing: border-box;"
              >
                <!-- 头部：头像 + 名称 + 角色标签 + 操作 -->
                <div class="flex items-center gap-2">
                  <div
                    class="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-lg"
                    :class="newOfficeLeaderId === agent.id ? 'bg-gradient-to-br from-amber-400 to-amber-600' : 'bg-gradient-to-br from-slate-600 to-slate-800'"
                  >
                    {{ agent.name.charAt(0) }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-sm font-bold text-white leading-tight">{{ agent.name }}</span>
                      <span
                        v-if="newOfficeLeaderId === agent.id"
                        class="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-lg font-bold"
                      >👑 {{ t('office.leader') }}</span>
                      <span v-else class="text-[10px] text-slate-600 border border-white/[0.06] px-1.5 py-0.5 rounded-lg">{{ t('common.assistant') }}</span>
                    </div>
                  </div>
                  <!-- 设为/取消组长 -->
                  <button
                    @click="toggleLeader(agent)"
                    :title="newOfficeLeaderId === agent.id ? '取消组长' : '设为组长'"
                    class="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-all shrink-0"
                    :class="newOfficeLeaderId === agent.id ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'text-slate-600 hover:text-amber-400 hover:bg-amber-500/10'"
                  >👑</button>
                  <!-- 移除 -->
                  <button
                    @click="removeNewAgent(agent)"
                    class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                    title="移除"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>

                <!-- 模型选择 -->
                <div class="flex items-center gap-2 bg-black/20 rounded-lg px-2.5 py-1.5 border border-white/[0.04] min-w-0">
                  <svg class="w-3 h-3 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                  <CustomSelect
                    v-model="newOfficeAgentConfigs[agent.id]"
                    :options="modelConfigOptions"
                    :placeholder="t('office.selectModel')"
                    class="flex-1 min-w-0"
                  />
                </div>

                <!-- 岗位 -->
                <div>
                  <label class="block text-[10px] text-slate-500 mb-1 ml-1">岗位</label>
                  <input
                    :value="getAgentRole(agent.id, 'position')"
                    type="text"
                    :placeholder="t('office.positionPlaceholder')"
                    class="w-full bg-black/40 border border-white/[0.05] rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
                    @input="(e) => setAgentRole(agent.id, 'position', (e.target as HTMLInputElement).value)"
                  />
                </div>

                <!-- 岗位使命 -->
                <div>
                  <label class="block text-[10px] text-slate-500 mb-1 ml-1">岗位使命</label>
                  <textarea
                    :value="getAgentRole(agent.id, 'mission')"
                    :placeholder="t('office.missionPlaceholder')"
                    rows="2"
                    class="w-full bg-black/40 border border-white/[0.05] rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600 resize-none"
                    @input="(e) => setAgentRole(agent.id, 'mission', (e.target as HTMLTextAreaElement).value)"
                  ></textarea>
                </div>

                <!-- 机器人配置入口 -->
                <div v-if="newOfficeLeaderId === agent.id" class="mt-2 text-center bg-black/40 border border-white/[0.05] rounded-xl p-3">
                  <p class="text-[10px] text-slate-500 mb-2">对接机器人对话频道</p>
                  <button 
                    @click.stop="$router.push({ name: 'Bots', query: { agentId: agent.id } })"
                    class="px-4 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 shadow-md shadow-amber-500/5 text-amber-500 rounded-lg text-xs font-medium transition-colors border border-amber-500/30"
                  >
                    配置机器人接入
                  </button>
                  <p class="text-[9px] text-slate-600 mt-2 text-left">跳转直接关联当前 Agent 的人设添加机器人的接入。</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="px-5 py-4 border-t border-white/[0.06] flex justify-end gap-2 shrink-0 bg-black/20">
        <button @click="resetModal" class="px-5 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
          {{ t('office.cancelCreate') }}
        </button>
        <button @click="saveOffice" class="px-6 py-2 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-lg shadow-amber-500/20">
          {{ isEditing ? t('office.saveOffice') : t('office.saveOffice') }}
        </button>
      </div>
    </div>
  </div>

  <!-- 对话抽屉 -->
  <div v-if="showChatDrawer && chatOffice" class="fixed inset-y-0 right-0 w-[720px] bg-[#1a1c23] border-l border-white/[0.06] shadow-2xl z-50 flex flex-col">
    <div class="px-5 py-4 border-b border-white/[0.06] flex justify-between items-center bg-black/20 shrink-0">
      <h3 class="text-base font-bold text-white flex items-center gap-2 truncate">
        <span class="text-amber-500">💬</span> {{ chatOffice.name }}
      </h3>
      <button @click="showChatDrawer = false; chatOffice = null" class="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all shrink-0">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>

    <div ref="chatMessagesContainer" class="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar flex flex-col">
      <div v-if="!officeMessages[chatOffice.id] || officeMessages[chatOffice.id].length === 0" class="flex-1 flex flex-col items-center justify-center text-slate-600 text-sm">
        No messages yet, @AgentName to start
      </div>
      <div v-for="(msg, idx) in officeMessages[chatOffice.id]" :key="idx">
        <!-- 用户消息 -->
        <div v-if="msg.role === 'user'" class="flex justify-end">
          <div class="flex items-start gap-2 max-w-[85%] min-w-0">
            <div class="flex flex-col items-end min-w-0">
              <div class="text-[11px] text-slate-500 font-bold mr-1 mb-1">{{ t('common.user') }}</div>
              <div class="bg-amber-500/20 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 border border-amber-500/25 text-sm whitespace-pre-wrap break-words overflow-hidden">{{ msg.content }}</div>
            </div>
            <div class="w-8 h-8 rounded-full bg-amber-500/30 flex items-center justify-center text-amber-400 text-sm font-bold shrink-0 mt-5">👤</div>
          </div>
        </div>
        <!-- Agent消息 -->
        <div v-else class="flex justify-start">
          <div class="flex items-start gap-2 max-w-[85%] min-w-0">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-5"
              :style="{ background: `hsl(${((msg.agentId || msg.name || '').split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) * 37) % 360}, 50%, 25%)` }">
              <img v-if="msg.agentId && getAgentDetails(msg.agentId).avatar" :src="getAgentDetails(msg.agentId).avatar" class="w-8 h-8 rounded-full object-cover" />
              <span v-else class="text-white/80">{{ (msg.agentId ? getAgentDetails(msg.agentId).name : (msg.name || '?'))[0] }}</span>
            </div>
            <div class="flex flex-col">
              <div class="text-[11px] text-amber-500/70 font-bold ml-1 mb-1">{{ msg.agentId ? getAgentDetails(msg.agentId).name : (msg.name || t('common.assistant')) }}</div>
              <div v-if="(msg as any).attachments && (msg as any).attachments.length > 0" class="flex flex-wrap gap-2 mb-1">
                <template v-for="(att, aIdx) in (msg as any).attachments" :key="aIdx">
                  <img v-if="isImageType(att.type)" :src="att.dataUrl" :alt="att.name" class="max-w-[180px] max-h-36 rounded-xl border border-white/10" />
                  <video v-else-if="isVideoType(att.type)" :src="att.dataUrl" controls class="max-w-[180px] max-h-36 rounded-xl border border-white/10" />
                  <audio v-else-if="isAudioType(att.type)" :src="att.dataUrl" controls class="w-full" />
                  <a v-else :href="att.dataUrl" :download="att.name" target="_blank" class="flex items-center gap-2 bg-white/5 border border-white/10 hover:border-amber-500/50 hover:bg-white/10 rounded-lg px-3 py-1.5 text-xs transition-colors cursor-pointer group">
                    <span class="text-amber-400 group-hover:scale-110 transition-transform">📎</span>
                    <span class="text-slate-300 group-hover:text-white underline-offset-2 group-hover:underline">{{ att.name }}</span>
                  </a>
                </template>
              </div>
              <div class="bg-white/[0.04] text-slate-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5 border border-white/[0.06] text-sm whitespace-pre-wrap break-words overflow-hidden">
                {{ msg.content }}
                <span v-if="msg.content === '' && msg.role === 'assistant'" class="inline-block w-2 h-4 bg-amber-500 animate-pulse ml-1"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="p-4 border-t border-white/[0.06] bg-black/20 shrink-0">
      <div class="flex flex-col gap-2">
        <div class="text-[11px] text-slate-500 flex flex-wrap gap-1 items-center">
          <span>@</span>
          <button v-for="aid in chatOffice.agentIds" :key="aid" @click="chatInput += `@${getAgentDetails(aid).name} `" class="text-amber-500/70 hover:text-amber-400 transition-colors">{{ getAgentDetails(aid).name }}</button>
        </div>
        <div v-if="officeChatFiles.length > 0" class="flex flex-wrap gap-1.5">
          <div v-for="(file, fIdx) in officeChatFiles" :key="fIdx" class="flex items-center gap-1 bg-black/40 border border-white/[0.08] px-2 py-1 rounded-lg text-xs">
            <span class="text-amber-400">📎</span>
            <span class="truncate max-w-[80px] text-slate-300">{{ file.name }}</span>
            <button @click="officeChatFiles.splice(fIdx, 1)" class="text-slate-500 hover:text-red-400 ml-1">×</button>
          </div>
        </div>
        <div class="flex gap-2 items-end">
          <button @click="officeChatFileInput?.click()" class="w-10 h-10 flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 hover:text-amber-400 rounded-xl transition-colors border border-white/[0.08] shrink-0" title="上传文件">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
          </button>
          <input ref="officeChatFileInput" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.pptx,.ppt" class="hidden" @change="(e) => officeChatFiles.push(...Array.from((e.target as HTMLInputElement).files || []))" />
          <textarea
            v-model="chatInput"
            @keydown.enter.prevent="sendOfficeMessage"
            @paste="handlePaste"
            :placeholder="t('office.chatPlaceholder')"
            class="flex-1 bg-black/30 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 resize-none h-12 custom-scrollbar min-w-0"
          ></textarea>
          <button
            @click="sendOfficeMessage"
            :disabled="(!chatInput.trim() && officeChatFiles.length === 0) || isChatSending"
            class="w-10 h-10 flex items-center justify-center bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl transition-colors shadow-lg shadow-amber-500/20 shrink-0" title="发送"
          >
            <svg class="w-5 h-5" :class="{'animate-spin': isChatSending}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path v-if="!isChatSending" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
              <path v-else d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 下发任务弹窗 -->
  <div v-if="showDispatchModal && dispatchOffice" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="bg-[#1a1c23] border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden" style="max-height: 88vh">
      <div class="px-5 py-4 border-b border-white/[0.06] flex justify-between items-center shrink-0">
        <div>
          <h3 class="text-base font-bold text-white">🚀 {{ t('office.dispatchTaskTitle') }}</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ dispatchOffice.name }} ·
            组长：<span class="text-amber-400">{{ dispatchOffice.leaderId ? getAgentDetails(dispatchOffice.leaderId).name : '未指定' }}</span>
            · {{ dispatchOffice.agentIds.length }} 人
          </p>
        </div>
        <button @click="showDispatchModal = false" class="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <div class="p-5 flex flex-col gap-4 flex-1 overflow-y-auto custom-scrollbar">
        <div>
          <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{{ t('office.taskDescription') }}</label>
          <textarea
            v-model="dispatchTaskInput"
            :disabled="isDispatching"
            rows="3"
            :placeholder="t('office.taskPlaceholder')"
            class="w-full bg-black/30 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-50 transition-colors"
          ></textarea>
        </div>

        <!-- 执行日志 -->
        <div v-if="dispatchLogs.length > 0" class="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">
          <div
            v-for="(log, idx) in dispatchLogs"
            :key="idx"
            class="text-xs rounded-xl px-3 py-2 border"
            :class="{
              'bg-white/[0.02] border-white/[0.05] text-slate-400': log.type === 'status',
              'bg-amber-500/[0.06] border-amber-500/15 text-amber-300': log.type === 'decomposed',
              'bg-blue-500/[0.06] border-blue-500/15 text-blue-300': log.type === 'member_result',
              'bg-purple-500/[0.06] border-purple-500/15 text-purple-300': log.type === 'review_result',
              'bg-green-500/[0.06] border-green-500/15 text-green-300': log.type === 'done',
              'bg-red-500/[0.06] border-red-500/15 text-red-300': log.type === 'error',
            }"
          >
            <div v-if="log.type === 'status'" class="flex items-center gap-1.5">
              <span v-if="isDispatching" class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
              {{ log.message }}
            </div>
            <div v-else-if="log.type === 'decomposed'">
              <div class="font-bold mb-1">📋 任务分解</div>
              <div class="text-amber-400/70 mb-1">{{ log.plan }}</div>
              <div v-for="(a, i) in log.assignments" :key="i" class="text-slate-300">{{ i + 1 }}. <b>{{ a.member }}</b>：{{ a.subtask }}</div>
            </div>
            <div v-else-if="log.type === 'member_result'">
              <div class="font-bold mb-0.5">⚙️ {{ log.member }}（第{{ log.attempt }}次）</div>
              <div class="text-blue-300/70 line-clamp-2">{{ log.result }}</div>
            </div>
            <div v-else-if="log.type === 'review_result'">
              <div class="font-bold">{{ log.approved ? '✅' : '❌' }} {{ log.member }} {{ log.approved ? '通过' : '退回' }}</div>
              <div v-if="log.feedback" class="text-purple-300/70 mt-0.5">{{ log.feedback }}</div>
            </div>
            <div v-else-if="log.type === 'done'">
              <div class="font-bold mb-1">🎉 {{ log.message }}</div>
              <div v-if="log.summary" class="text-green-300/70 line-clamp-3">{{ log.summary }}</div>
            </div>
            <div v-else-if="log.type === 'error'">❌ {{ log.message }}</div>
          </div>
        </div>
      </div>

      <div class="px-5 py-4 border-t border-white/[0.06] flex justify-end gap-2 shrink-0 bg-black/20">
        <button @click="showDispatchModal = false" class="px-5 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
          {{ t('common.close') }}
        </button>
        <button
          @click="dispatchTask"
          :disabled="isDispatching || !dispatchTaskInput.trim()"
          class="px-6 py-2 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <svg v-if="isDispatching" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
          {{ isDispatching ? t('office.dispatching') : '🚀 ' + t('office.dispatch') }}
        </button>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
