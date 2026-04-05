<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { safetyApi, systemUpdateApi, type SafetyConfig } from '@/api';
import { useStatusStore } from '@/stores/status';
import CustomSelect from '../components/CustomSelect.vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

const statusStore = useStatusStore();

const config = ref<SafetyConfig | null>(null);
const loading = ref(false);
const saving = ref(false);
const backupsList = ref<any[]>([]);
const systemStats = ref<any>(null);
const agents = ref<any[]>([]);
const agentMemoryStats = ref<any[]>([]);
const creatingFileForAgent = ref<string | null>(null);
const viewingFile = ref<any | null>(null);
const newFile = ref<any>({
  filename: '',
  type: 'knowledge',
  content: '',
  knowledgeBaseId: '',
  documentId: '',
  sourceType: 'thread',
  threadId: '',
  officeId: '',
  mimeType: '',
  base64Content: '',
});

const memoryConfig = ref({
  maxTokens: 8192,
  recentMessageCount: 12,
  relevantMessageCount: 10,
  summaryThreshold: 30,
  similarityThreshold: 0.5,
});

const selectedScenario = ref('default');

// 场景预设配置
const scenarioPresets = {
  default: {
    maxTokens: 8192,
    recentMessageCount: 12,
    relevantMessageCount: 10,
    summaryThreshold: 30,
    similarityThreshold: 0.5,
  },
  code: {
    maxTokens: 16384,
    recentMessageCount: 20,
    relevantMessageCount: 15,
    summaryThreshold: 40,
    similarityThreshold: 0.65,
  },
  document: {
    maxTokens: 32768,
    recentMessageCount: 15,
    relevantMessageCount: 12,
    summaryThreshold: 50,
    similarityThreshold: 0.6,
  },
  conversation: {
    maxTokens: 8192,
    recentMessageCount: 10,
    relevantMessageCount: 8,
    summaryThreshold: 25,
    similarityThreshold: 0.7,
  },
  research: {
    maxTokens: 32768,
    recentMessageCount: 25,
    relevantMessageCount: 20,
    summaryThreshold: 60,
    similarityThreshold: 0.55,
  },
};

// 场景选项
const scenarioOptions = [
  { value: 'default', label: t('settings.scenarioDefault') },
  { value: 'code', label: t('settings.scenarioCode') },
  { value: 'document', label: t('settings.scenarioDocument') },
  { value: 'conversation', label: t('settings.scenarioConversation') },
  { value: 'research', label: t('settings.scenarioResearch') },
  { value: 'custom', label: t('settings.scenarioCustom') },
];

// 应用场景配置
function applyScenarioConfig() {
  if (selectedScenario.value !== 'custom') {
    const preset = scenarioPresets[selectedScenario.value as keyof typeof scenarioPresets];
    if (preset) {
      memoryConfig.value = { ...preset };
    }
  }
}

watch(memoryConfig, (newConfig) => {
  let matchedScenario = 'custom';
  for (const [key, preset] of Object.entries(scenarioPresets)) {
    if (
      newConfig.maxTokens === preset.maxTokens &&
      newConfig.recentMessageCount === preset.recentMessageCount &&
      newConfig.relevantMessageCount === preset.relevantMessageCount &&
      newConfig.summaryThreshold === preset.summaryThreshold &&
      Math.abs(newConfig.similarityThreshold - preset.similarityThreshold) < 0.01
    ) {
      matchedScenario = key;
      break;
    }
  }
  if (selectedScenario.value !== matchedScenario) {
    selectedScenario.value = matchedScenario;
  }
}, { deep: true });

const memoryStats = ref(null);
const healthStatus = ref<any>(null);
const systemSafetyHealth = ref<any>(null);
const currentSystemBackup = ref<any>(null);
const creatingBackup = ref(false);
const restoringBackup = ref(false);

// Recovery settings in minutes (for UI)
const healthCheckMinutes = ref(1);
const recoveryDelayMinutes = ref(10);

const heartbeatOptions = [
  { value: 1 * 60 * 1000, label: t('settings.oneMin') },
  { value: 2 * 60 * 1000, label: t('settings.twoMin') },
  { value: 3 * 60 * 1000, label: t('settings.threeMin') },
  { value: 4 * 60 * 1000, label: t('settings.fourMin') },
  { value: 5 * 60 * 1000, label: t('settings.fiveMin') },
  { value: 10 * 60 * 1000, label: t('settings.tenMin') },
  { value: 15 * 60 * 1000, label: t('settings.fifteenMin') },
  { value: 30 * 60 * 1000, label: t('settings.thirtyMin') },
  { value: 60 * 60 * 1000, label: t('settings.oneHour') },
  { value: 2 * 60 * 60 * 1000, label: t('settings.twoHours') },
  { value: 6 * 60 * 60 * 1000, label: t('settings.sixHours') },
  { value: 12 * 60 * 60 * 1000, label: t('settings.twelveHours') },
  { value: 24 * 60 * 60 * 1000, label: t('settings.twentyFourHours') },
];

// Watch for changes and convert to milliseconds
watch(healthCheckMinutes, (val) => {
  if (config.value) {
    config.value.healthCheckInterval = val * 60 * 1000;
  }
});

watch(recoveryDelayMinutes, (val) => {
  localStorage.setItem('recoveryDelayMinutes', String(val));
  if (config.value) {
    config.value.recoveryDelay = val * 60 * 1000;
  }
});

onMounted(async () => {
  await Promise.all([
    loadConfig(),
    loadBackups(),
    loadMemoryConfig(),
    loadMemoryStats(),
    loadSystemStats(),
    loadAgents(),
    loadAgentMemoryStats(),
    loadHealthStatus(),
    loadSystemSafetyStatus(),
  ]);
});

async function loadHealthStatus() {
  try {
    const response = await fetch('/api/health');
    if (response.ok) {
      healthStatus.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load health status:', error);
  }
}

async function loadConfig() {
  loading.value = true;
  try {
    const response = await safetyApi.get();
    config.value = response.data;
    
    // Initialize minutes from milliseconds
    if (config.value?.healthCheckInterval) {
      healthCheckMinutes.value = Math.round(config.value.healthCheckInterval / 60000);
    }
    
    // Initialize recovery delay
    if (config.value?.recoveryDelay) {
      recoveryDelayMinutes.value = Math.round(config.value.recoveryDelay / 60000);
    } else {
      // Load from localStorage if not in config
      const savedRecoveryDelay = localStorage.getItem('recoveryDelayMinutes');
      if (savedRecoveryDelay) {
        recoveryDelayMinutes.value = parseInt(savedRecoveryDelay, 10);
      }
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  if (!config.value) return;
  saving.value = true;
  try {
    await safetyApi.update({
      ...config.value,
      recoveryDelay: recoveryDelayMinutes.value * 60 * 1000, // Convert minutes to milliseconds for saving
    });
    await loadHealthStatus();
    await statusStore.fetchStatus();
    alert(t('settings.settingsSaved'));
  } catch (error) {
    console.error('Failed to save config:', error);
  } finally {
    saving.value = false;
  }
}

async function forceHealthCheck() {
  try {
    const response = await fetch('/api/health/check', { method: 'POST' });
    if (response.ok) {
      healthStatus.value = await response.json();
    }
    await statusStore.fetchStatus();
  } catch (error) {
    console.error('Failed to force health check:', error);
  }
}

async function scheduleRecovery() {
  try {
    const delayMs = recoveryDelayMinutes.value * 60 * 1000;
    const response = await fetch('/api/system-safety/schedule-recovery', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delayMs })
    });
    if (response.ok) {
      await statusStore.fetchStatus();
    }
  } catch (error) {
    console.error('Failed to schedule recovery:', error);
  }
}

async function loadSystemSafetyStatus() {
  try {
    const [healthRes, backupRes] = await Promise.all([
      fetch('/api/system-safety/health'),
      fetch('/api/system-safety/backup'),
    ]);
    if (healthRes.ok) {
      systemSafetyHealth.value = await healthRes.json();
    }
    if (backupRes.ok) {
      currentSystemBackup.value = await backupRes.json();
    }
    await statusStore.fetchStatus();
  } catch (error) {
    console.error('Failed to load system safety status:', error);
  }
}

async function createSystemBackup() {
  if (!confirm(t('settings.createBackupConfirm'))) return;
  
  creatingBackup.value = true;
  try {
    const response = await fetch('/api/system-safety/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'manual', description: t('settings.manualBackupDesc') }),
    });
    if (response.ok) {
      const backup = await response.json();
      currentSystemBackup.value = backup;
      alert(t('settings.backupCreated') + `\nSize: ${formatBytes(backup.size)}\nFiles: ${backup.filesCount}`);
    }
  } catch (error) {
    console.error('Failed to create backup:', error);
    alert(t('settings.backupFailed'));
  } finally {
    creatingBackup.value = false;
  }
}

async function restoreSystemBackup() {
  if (!currentSystemBackup.value) return;
  
  if (!confirm(t('settings.restoreWarning'))) return;
  
  restoringBackup.value = true;
  try {
    const response = await fetch('/api/system-safety/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: currentSystemBackup.value.id }),
    });
    const result = await response.json();
    
    if (result.success) {
      alert('✅ ' + result.message + '\n\n请重启服务器以应用更改。');
    } else {
      alert('❌ ' + result.message);
    }
  } catch (error) {
    console.error('Failed to restore backup:', error);
    alert(t('settings.restoreFailed'));
  } finally {
    restoringBackup.value = false;
  }
}

// System GitHub Update 
const updateStatus = ref<{ hasUpdate: boolean; commitsBehind: number; latestCommitHash?: string; latestCommitMessage?: string } | null>(null);
const checkingUpdate = ref(false);
const pullingUpdate = ref(false);

async function checkSystemUpdate() {
  checkingUpdate.value = true;
  updateStatus.value = null;
  try {
    const response = await systemUpdateApi.check();
    updateStatus.value = response.data;
    if (!response.data.hasUpdate) {
      alert('当前已经是最新开源版本，无需更新！');
    }
  } catch (error: any) {
    alert(error.response?.data?.error || error.message);
  } finally {
    checkingUpdate.value = false;
  }
}

async function performSystemUpdate() {
  if (!confirm('💡 注意：如果本地有未自己修改过的代码，将会被自动 stash。\n\n确定从 GitHub 拉取线上最新主分支代码并升级覆盖吗？')) return;
  pullingUpdate.value = true;
  try {
    const response = await systemUpdateApi.pull();
    alert('✅ 更新执行结果输出：\n\n' + response.data.log + '\n\n(可能需要重启服务以完全加载热更新功能)');
    updateStatus.value = null;
  } catch (error: any) {
    alert('❌ 更新失败拉取终止：\n\n' + (error.response?.data?.error || error.message));
  } finally {
    pullingUpdate.value = false;
  }
}

async function loadBackups() {
  try {
    const response = await fetch('/api/safety/backups');
    if (response.ok) {
      backupsList.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load backups:', error);
  }
}

async function createManualBackup() {
  try {
    const response = await fetch('/api/safety/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'manual', description: t('settings.manualBackupDesc') }),
    });
    if (response.ok) {
      alert(t('settings.backupCreated'));
      await loadBackups();
    }
  } catch (error) {
    console.error('Failed to create backup:', error);
    alert(t('settings.backupFailed'));
  }
}

async function restoreSnapshot(id: string) {
  if (!confirm(t('settings.restoreConfirm'))) return;
  try {
    const response = await fetch(`/api/safety/restore/${id}`, { method: 'POST' });
    if (response.ok) {
      const data = await response.json();
      alert(data.message || t('settings.restoreSuccess'));
    }
  } catch (error) {
    console.error('Failed to restore snapshot:', error);
    alert(t('settings.restoreFailed'));
  }
}

async function deleteBackup(id: string) {
  if (!confirm(t('settings.deleteBackupConfirm'))) return;
  try {
    await fetch(`/api/safety/backups/${id}`, { method: 'DELETE' });
    await loadBackups();
  } catch (error) {
    console.error('Failed to delete backup:', error);
  }
}

async function loadSystemStats() {
  try {
    const response = await fetch('/api/system/stats');
    if (response.ok) {
      systemStats.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load system stats:', error);
  }
}

async function loadMemoryConfig() {
  try {
    const response = await fetch('/api/memory/config');
    if (response.ok) {
      const data = await response.json();
      if (data) {
        memoryConfig.value = { ...memoryConfig.value, ...data };
      }
    }
  } catch (error) {
    console.error('Failed to load memory config:', error);
  }
}

async function saveMemoryConfig() {
  try {
    await fetch('/api/memory/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memoryConfig.value),
    });
    alert(t('settings.memorySaved'));
  } catch (error) {
    console.error('Failed to save memory config:', error);
  }
}

async function loadMemoryStats() {
  try {
    const response = await fetch('/api/memory/stats');
    if (response.ok) {
      memoryStats.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load memory stats:', error);
  }
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return bytes.toFixed(0) + ' ' + units[i];
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatUptime(uptime: number) {
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  return t('settings.hoursMinutes', { hours, minutes });
}

function getBackupTypeLabel(type: string) {
  const labels: Record<string, string> = {
    'auto': t('settings.autoBackupLabel'),
    'manual': t('settings.manualBackupLabel'),
    'pre-change': t('settings.preChangeBackup'),
  };
  return labels[type] || type;
}

function getBackupTypeClass(type: string) {
  const classes: Record<string, string> = {
    'auto': 'bg-amber-500/20 text-amber-400',
    'manual': 'bg-green-500/20 text-green-400',
    'pre-change': 'bg-yellow-500/20 text-yellow-400',
  };
  return classes[type] || 'bg-slate-500/20 text-slate-400';
}

async function loadAgents() {
  try {
    const response = await fetch('/api/agents');
    if (response.ok) {
      agents.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load agents:', error);
  }
}

async function loadAgentMemoryStats() {
  try {
    // 先加载所有agents
    const agentsResponse = await fetch('/api/agents');
    if (!agentsResponse.ok) return;
    const allAgents = await agentsResponse.json();
    agents.value = allAgents;

    // 加载已初始化的记忆配置
    const statsResponse = await fetch('/api/memory/agents/stats');
    const existingStats: Map<string, any> = new Map();
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      for (const stat of stats) {
        existingStats.set(stat.agentId, stat);
      }
    }

    // 为每个agent创建统计信息（如果没有的话）
    const allStats = [];
    for (const agent of allAgents) {
      if (existingStats.has(agent.id)) {
        allStats.push(existingStats.get(agent.id));
      } else {
        // 为未初始化的agent创建默认统计
        allStats.push({
          agentId: agent.id,
          files: [],
          totalSize: 0,
          config: {
            agentId: agent.id,
            enabled: true,
            heartbeatIntervalMs: 60 * 60 * 1000,
            autoExtract: true,
            memoryFiles: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
    }

    // 加载办公室共享记忆（office-前缀的虚拟agent）+ 标记属于办公室的agent
    const officesResponse = await fetch('/api/offices');
    if (officesResponse.ok) {
      const allOffices = await officesResponse.json();
      // Build agent→office map for display
      const agentOfficeMap = new Map<string, string>();
      for (const office of allOffices) {
        for (const agentId of (office.agentIds || [])) {
          agentOfficeMap.set(agentId, office.name);
        }
        // Add office shared memory entry
        const officeAgentId = `office-${office.id}`;
        if (existingStats.has(officeAgentId)) {
          const stat = existingStats.get(officeAgentId);
          stat._isOffice = true;
          stat._officeName = office.name;
          allStats.push(stat);
        }
      }
      // Tag individual agent entries with their office name
      for (const stat of allStats) {
        if (!stat._isOffice && agentOfficeMap.has(stat.agentId)) {
          stat._belongsToOffice = agentOfficeMap.get(stat.agentId);
        }
      }
    }

    agentMemoryStats.value = allStats;
  } catch (error) {
    console.error('Failed to load agent memory stats:', error);
  }
}

function getAgentName(agentId: string): string {
  // Handle office shared memory entries
  if (agentId.startsWith('office-')) {
    return agentId; // Will be overridden by _officeName in template
  }
  const agent = agents.value.find(a => a.id === agentId);
  return agent?.name || agentId;
}

function formatHeartbeatInterval(ms: number): string {
  const minutes = ms / 60000;
  if (minutes < 60) return t('settings.minutes', { n: minutes });
  const hours = minutes / 60;
  if (hours < 24) return t('settings.hours', { n: hours });
  return t('settings.days', { n: hours / 24 });
}

async function toggleAgentMemory(agentId: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  try {
    await fetch(`/api/agents/${agentId}/memory/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await loadAgentMemoryStats();
  } catch (error) {
    console.error('Failed to toggle agent memory:', error);
  }
}

async function toggleAgentAutoExtract(agentId: string, event: Event) {
  const autoExtract = (event.target as HTMLInputElement).checked;
  try {
    await fetch(`/api/agents/${agentId}/memory/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoExtract }),
    });
    await loadAgentMemoryStats();
  } catch (error) {
    console.error('Failed to toggle auto extract:', error);
  }
}

async function updateAgentHeartbeat(agentId: string, value: number | string) {
  const heartbeatIntervalMs = typeof value === 'string' ? parseInt(value) : value;
  try {
    await fetch(`/api/agents/${agentId}/memory/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heartbeatIntervalMs }),
    });
    await loadAgentMemoryStats();
  } catch (error) {
    console.error('Failed to update heartbeat:', error);
  }
}

async function clearAgentMemory(agentId: string) {
  if (!confirm(t('settings.clearMemoryConfirm'))) return;
  try {
    await fetch(`/api/agents/${agentId}/memory`, { method: 'DELETE' });
    await loadAgentMemoryStats();
    alert(t('settings.memoryCleared'));
  } catch (error) {
    console.error('Failed to clear agent memory:', error);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileColorClass(type: string): string {
  const classes: Record<string, string> = {
    'knowledge': 'bg-amber-500/20 text-amber-400',
    'preference': 'bg-green-500/20 text-green-400',
    'conversation': 'bg-amber-500/20 text-amber-400',
    'custom': 'bg-slate-500/20 text-slate-400',
  };
  return classes[type] || classes['custom'];
}

function getFileTypeName(type: string): string {
  const names: Record<string, string> = {
    'knowledge': t('settings.knowledgeFileType'),
    'preference': t('settings.preferenceFileType'),
    'conversation': t('settings.conversationFileType'),
    'custom': t('settings.customFileType'),
  };
  return names[type] || type;
}

function showCreateFileModal(agentId: string) {
  creatingFileForAgent.value = agentId;
  newFile.value = { filename: '', type: 'knowledge', content: '', knowledgeBaseId: '', documentId: '', sourceType: 'thread', threadId: '', officeId: '' };
  if (knowledgeBases.value.length === 0) {
    loadKnowledgeBases();
  }
  if (globalThreads.value.length === 0) {
    loadGlobalConversations();
  }
}

async function viewMemoryFile(fileId: string) {
  try {
    const response = await fetch(`/api/agents/0/memory/files/${fileId}`);
    if (response.ok) {
      viewingFile.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load file:', error);
  }
}

async function deleteMemoryFile(agentId: string, fileId: string) {
  if (!confirm(t('settings.deleteMemoryFileConfirm'))) return;
  try {
    await fetch(`/api/agents/${agentId}/memory/files/${fileId}`, { method: 'DELETE' });
    await loadAgentMemoryStats();
  } catch (error) {
    console.error('Failed to delete file:', error);
  }
}

async function createMemoryFile() {
  if (!creatingFileForAgent.value) return;

  if (newFile.value.type === 'knowledge') {
    if (!newFile.value.documentId) {
      alert(t('settings.selectKbDoc'));
      return;
    }
    // Fetch document content
    const res = await fetch(`/api/knowledge/${newFile.value.knowledgeBaseId}/documents/${newFile.value.documentId}/content`);
    if (res.ok) {
       const data = await res.json();
       newFile.value.content = data.content;
       if (!newFile.value.filename) newFile.value.filename = `kb-${newFile.value.documentId}.md`;
    } else {
       alert(t('settings.getKbDocFailed'));
       return;
    }
  } else if (newFile.value.type === 'conversation') {
    if (newFile.value.sourceType === 'thread') {
      if (!newFile.value.threadId) {
        alert(t('settings.selectTopic'));
        return;
      }
      const res = await fetch(`/api/threads/${newFile.value.threadId}`);
      if (res.ok) {
          const threadData = await res.json();
          const chatText = threadData.messages.map((m: any) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
          newFile.value.content = chatText;
          if (!newFile.value.filename) newFile.value.filename = `chat-${newFile.value.threadId}.md`;
      } else {
          alert(t('settings.getHistoryFailed'));
          return;
      }
    } else if (newFile.value.sourceType === 'office') {
      if (!newFile.value.officeId) {
        alert(t('settings.selectGroup'));
        return;
      }
      const res = await fetch(`/api/offices/${newFile.value.officeId}/messages`);
      if (res.ok) {
          const officeMsgs = await res.json();
          const chatText = officeMsgs.map((m: any) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
          newFile.value.content = chatText;
          if (!newFile.value.filename) newFile.value.filename = `office-${newFile.value.officeId}.md`;
      } else {
          alert(t('settings.getGroupFailed'));
          return;
      }
    }
  } else if (newFile.value.type === 'custom') {
    if (!newFile.value.filename || (!newFile.value.content && !newFile.value.base64Content)) {
      alert(t('settings.uploadOrProvideContent'));
      return;
    }
  } else {
    // preference or other
    if (!newFile.value.filename || !newFile.value.content) {
      alert(t('settings.fillNameAndContent'));
      return;
    }
  }

  try {
    const payload: any = { ...newFile.value };
    // cleanup temp states
    delete payload.knowledgeBaseId;
    delete payload.documentId;
    delete payload.sourceType;
    delete payload.threadId;
    delete payload.officeId;

    await fetch(`/api/agents/${creatingFileForAgent.value}/memory/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    creatingFileForAgent.value = null;
    await loadAgentMemoryStats();
  } catch (error) {
    console.error('Failed to create file:', error);
    alert(t('settings.createFileFailed'));
  }
}

// Memory Dialog Support Methods
const knowledgeBases = ref<any[]>([]);
const knowledgeDocuments = ref<any[]>([]);
const globalThreads = ref<any[]>([]);
const globalOffices = ref<any[]>([]);

async function loadKnowledgeBases() {
  try {
    const res = await fetch('/api/knowledge');
    if (res.ok) knowledgeBases.value = await res.json();
  } catch (err) { console.error('Failed to load KB:', err); }
}

async function loadGlobalConversations() {
  try {
    const res = await fetch('/api/threads');
    if (res.ok) globalThreads.value = await res.json();
  } catch (err) { console.error('Failed to load global threads:', err); }

  try {
    const res = await fetch('/api/offices');
    if (res.ok) globalOffices.value = await res.json();
  } catch (err) { console.error('Failed to load global offices:', err); }
}

async function handleKnowledgeBaseSelect(kbId: string | number) {
  newFile.value.knowledgeBaseId = String(kbId);
  newFile.value.documentId = '';
  try {
    const res = await fetch(`/api/knowledge/${kbId}/documents`);
    if (res.ok) knowledgeDocuments.value = await res.json();
  } catch (err) { console.error('Failed to load docs:', err); }
}

function handleCustomFileUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  newFile.value.filename = file.name;
  newFile.value.mimeType = file.type || 'application/octet-stream';
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result as string;
    // Extract base64 part
    const base64 = dataUrl.split(',')[1];
    newFile.value.base64Content = base64;
    newFile.value.content = ''; // Clear text content 
  };
  reader.readAsDataURL(file);
}
</script>

<template>
  <div class="h-full overflow-auto p-6">
    <div class="max-w-4xl mx-auto">
      <div class="mb-8">
        <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500">{{ t('settings.title') }}</h1>
        <p class="text-slate-400 mt-2">{{ t('settings.subtitle') }}</p>
      </div>

      <div v-if="loading" class="text-center py-12">
        <div class="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"></div>
      </div>

      <div v-else-if="config" class="space-y-6">

        <!-- Browser Extension Banner -->
        <div class="relative overflow-hidden rounded-[2rem] p-6 border border-amber-500/30 bg-gradient-to-br from-amber-950/40 via-black/30 to-amber-900/20 shadow-lg shadow-amber-500/5">
          <!-- Glow accent -->
          <div class="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-amber-600/10 rounded-full blur-2xl pointer-events-none"></div>

          <div class="relative flex items-start gap-4">
            <!-- Icon -->
            <div class="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/30">
              🦊
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3 mb-1">
                <h3 class="text-lg font-bold text-amber-300">QilinClaw Browser Bridge</h3>
                <span class="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-semibold rounded-full border border-amber-500/30">{{ t('settings.browserPlugin') }}</span>
              </div>
              <p class="text-slate-400 text-sm mb-4">
                {{ t('settings.browserExtDesc') }}
              </p>

              <!-- Steps -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div class="flex items-start gap-2.5 bg-black/20 rounded-xl p-3 border border-white/[0.04]">
                  <span class="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center border border-amber-500/30">1</span>
                  <div>
                    <p class="text-white text-xs font-semibold mb-0.5">{{ t('settings.loadPlugin') }}</p>
                    <p class="text-slate-500 text-xs leading-relaxed">{{ t('settings.loadPluginDesc') }}</p>
                  </div>
                </div>
                <div class="flex items-start gap-2.5 bg-black/20 rounded-xl p-3 border border-white/[0.04]">
                  <span class="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center border border-amber-500/30">2</span>
                  <div>
                    <p class="text-white text-xs font-semibold mb-0.5">{{ t('settings.connectServer') }}</p>
                    <p class="text-slate-500 text-xs leading-relaxed">{{ t('settings.connectServerDesc') }}</p>
                  </div>
                </div>
                <div class="flex items-start gap-2.5 bg-black/20 rounded-xl p-3 border border-white/[0.04]">
                  <span class="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center border border-amber-500/30">3</span>
                  <div>
                    <p class="text-white text-xs font-semibold mb-0.5">{{ t('settings.startUsing') }}</p>
                    <p class="text-slate-500 text-xs leading-relaxed">{{ t('settings.startUsingDesc') }}</p>
                  </div>
                </div>
              </div>

              <!-- Capabilities -->
              <div class="flex flex-wrap gap-2">
                <span v-for="cap in [t('settings.capNavigation'), t('settings.capClick'), t('settings.capForm'), t('settings.capScreenshot'), t('settings.capScroll'), t('settings.capHistory'), t('settings.capJS')]" :key="cap"
                  class="px-2.5 py-1 bg-white/[0.03] border border-white/[0.06] rounded-lg text-xs text-slate-400 hover:border-amber-500/30 hover:text-amber-400 transition-colors cursor-default">
                  {{ cap }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <!-- End Browser Extension Banner -->

        <div class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-white">{{ t('settings.requestLimit') }}</h3>
            <button class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20" @click="saveConfig" :disabled="saving">
              {{ saving ? t('settings.saving') : t('settings.saveSettings') }}
            </button>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-zinc-400 mb-2">{{ t('settings.reqPerMinute') }}</label>
              <input v-model.number="config.maxRequestsPerMinute" type="number" class="input w-full" min="1" />
            </div>
            <div>
              <label class="block text-sm text-zinc-400 mb-2">{{ t('settings.reqPerHour') }}</label>
              <input v-model.number="config.maxRequestsPerHour" type="number" class="input w-full" min="1" />
            </div>
          </div>
        </div>

        <div class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-white">{{ t('settings.fileSafety') }}</h3>
            <button class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20" @click="saveConfig" :disabled="saving">
              {{ saving ? t('settings.saving') : t('settings.saveSettings') }}
            </button>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-slate-400 mb-2">{{ t('settings.maxFileSizeLabel') }}</label>
              <input v-model.number="config.maxFileSize" type="number" class="input" min="1" />
              <p class="text-slate-500 text-sm mt-1">{{ t('settings.currentSize') }}: {{ formatBytes(config.maxFileSize) }}</p>
            </div>
            <div>
              <label class="block text-sm text-slate-400 mb-2">{{ t('settings.maxConcurrent') }}</label>
              <input v-model.number="config.maxConcurrentOperations" type="number" class="input" min="1" />
            </div>
            <div class="flex items-center gap-2">
              <input v-model="config.enableAutoBackup" type="checkbox" id="autoBackup" class="w-4 h-4" />
              <label for="autoBackup" class="text-sm">{{ t('settings.enableAutoBackupLabel') }}</label>
            </div>
            <div v-if="config.enableAutoBackup">
              <label class="block text-sm text-zinc-400 mb-2">{{ t('settings.maxBackupsPerFile') }}</label>
              <input v-model.number="config.maxBackupsPerFile" type="number" class="input" min="1" max="100" />
            </div>
          </div>
        </div>

        <div class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-white">{{ t('settings.autoRecoverySection') }}</h3>
            <button class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20" @click="saveConfig" :disabled="saving">
              {{ saving ? t('settings.saving') : t('settings.saveSettings') }}
            </button>
          </div>
          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <input v-model="config.autoRecoveryEnabled" type="checkbox" id="autoRecovery" class="w-4 h-4 accent-amber-500 text-amber-500 ring-amber-500" />
              <label for="autoRecovery" class="text-sm font-bold text-white">{{ t('settings.enableAutoRecoveryLabel') }}</label>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-zinc-400 mb-2">{{ t('settings.healthCheckInterval') }}</label>
                <input v-model.number="healthCheckMinutes" type="number" class="input w-full" min="1" max="60" />
              </div>
              <div>
                <label class="block text-sm text-zinc-400 mb-2">{{ t('settings.autoRecoveryDelay') }}</label>
                <input v-model.number="recoveryDelayMinutes" type="number" class="input w-full" min="1" max="60" />
              </div>
            </div>
            <p class="text-xs text-slate-500">
              {{ t('settings.autoRecoveryDesc', { n: recoveryDelayMinutes }) }}
            </p>
            
            <!-- Health Status Display -->
            <div class="bg-white/[0.03] border border-white/[0.05] p-4 rounded-2xl">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-bold text-zinc-300">{{ t('settings.systemStatus') }}</span>
                <span :class="[
                  'text-sm font-bold',
                  statusStore.healthStatus === 'healthy' ? 'text-emerald-400' :
                  statusStore.healthStatus === 'degraded' ? 'text-amber-400' :
                  statusStore.healthStatus === 'recovering' ? 'text-amber-400' :
                  'text-rose-400'
                ]">
                  {{ statusStore.statusText }}
                </span>
              </div>
              
              <!-- Recovery Countdown -->
              <div v-if="statusStore.recoveryCountdown" class="mb-2 p-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-sm text-amber-400 font-bold">
                {{ t('settings.recoveryCountdown', { time: statusStore.recoveryCountdown }) }}
              </div>
              
              <!-- Last Error -->
              <div v-if="statusStore.lastError" class="mb-2 p-2 bg-red-500/20 rounded text-sm text-red-400">
                <div class="font-medium">{{ t('settings.lastError') }}:</div>
                <div class="text-xs mt-1">[{{ statusStore.lastError.context }}] {{ statusStore.lastError.message }}</div>
              </div>
              
              <!-- Component Status -->
              <div v-if="statusStore.status?.components" class="mb-2">
                <div class="text-xs text-slate-500 mb-1">{{ t('settings.componentStatus') }}:</div>
                <div class="grid grid-cols-2 gap-1">
                  <div v-for="(component, name) in statusStore.status.components" :key="name" class="flex items-center gap-1 text-xs">
                    <span :class="[
                      'w-1.5 h-1.5 rounded-full',
                      component.status === 'ok' ? 'bg-green-500' :
                      component.status === 'warning' ? 'bg-yellow-500' :
                      component.status === 'partial' ? 'bg-yellow-500' :
                      'bg-red-500'
                    ]"></span>
                    <span class="text-slate-400">{{ 
                      name === 'database' ? t('settings.compDatabase') : 
                      name === 'bots' ? t('settings.compBots') : 
                      name === 'memory' ? t('settings.compMemory') : 
                      name === 'network' ? t('settings.compNetwork') :
                      name === 'gateway' ? t('settings.compGateway') : name 
                    }}</span>
                    <span :class="[
                      component.status === 'ok' ? 'text-green-400' :
                      component.status === 'warning' ? 'text-yellow-400' :
                      'text-red-400'
                    ]">({{ component.status }})</span>
                  </div>
                </div>
              </div>
              
              <div class="grid grid-cols-2 gap-2 text-xs text-slate-400">
                <div>{{ t('settings.uptime') }}: {{ formatUptime(statusStore.uptime) }}</div>
                <div>{{ t('settings.recoveryCount') }}: {{ statusStore.recoveryInfo?.attemptCount || 0 }}</div>
                <div>{{ t('settings.memoryUsage') }}: {{ formatBytes(statusStore.memoryUsage?.heapUsed || 0) }}</div>
                <div>{{ t('settings.activeBots') }}: {{ statusStore.activeBots?.length || 0 }}</div>
              </div>
              
              <div v-if="healthStatus?.issues && healthStatus.issues.length > 0" class="mt-2 text-sm bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                <div class="text-rose-400 mb-1 font-bold">{{ t('settings.issueList') }}:</div>
                <ul class="text-rose-300/80 list-disc list-inside">
                  <li v-for="(issue, idx) in healthStatus.issues" :key="idx">{{ issue }}</li>
                </ul>
              </div>
              
              <div class="flex gap-2 mt-4 text-sm">
                <button 
                  class="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-lg font-bold transition-colors border border-white/[0.05]" 
                  @click="forceHealthCheck"
                >
                  {{ t('settings.checkNow') }}
                </button>
                <button 
                  v-if="statusStore.lastError && !statusStore.recoveryCountdown"
                  class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-bold transition-colors shadow-lg shadow-amber-500/20" 
                  @click="scheduleRecovery"
                >
                  {{ t('settings.scheduleRecovery', { n: recoveryDelayMinutes }) }}
                </button>
              </div>
            </div>
          </div>
        </div>



        <div class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
          <div class="flex justify-between items-start mb-6">
            <div>
              <h3 class="text-lg font-bold text-white">{{ t('settings.contextMemoryConfig') }}</h3>
              <p class="text-zinc-500 text-sm mt-1">{{ t('settings.contextMemoryDesc') }}</p>
            </div>
            <button class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20 shrink-0" @click="saveMemoryConfig">{{ t('settings.saveMemoryConfig') }}</button>
          </div>
          <div class="space-y-4">
            <!-- 场景选择 -->
            <div>
              <label class="block text-sm text-zinc-400 font-bold mb-2">{{ t('settings.scenario') }}</label>
              <CustomSelect 
                v-model="selectedScenario" 
                :options="scenarioOptions"
                @change="applyScenarioConfig"
              />
            </div>
            
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-zinc-400 font-bold mb-2">{{ t('settings.maxTokens') }}</label>
                <input v-model.number="memoryConfig.maxTokens" type="number" class="input w-full" min="512" max="128000" />
                <p class="text-zinc-500 text-xs mt-1">{{ t('settings.maxTokensHint') }}</p>
              </div>
              <div>
                <label class="block text-sm text-zinc-400 font-bold mb-2">{{ t('settings.recentMessages') }}</label>
                <input v-model.number="memoryConfig.recentMessageCount" type="number" class="input w-full" min="2" max="50" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-zinc-400 font-bold mb-2">{{ t('settings.relevantMessages') }}</label>
                <input v-model.number="memoryConfig.relevantMessageCount" type="number" class="input w-full" min="1" max="30" />
              </div>
              <div>
                <label class="block text-sm text-zinc-400 font-bold mb-2">{{ t('settings.summaryThreshold') }}</label>
                <input v-model.number="memoryConfig.summaryThreshold" type="number" class="input w-full" min="10" max="200" />
                <p class="text-zinc-500 text-xs mt-1">{{ t('settings.summaryThresholdHint') }}</p>
              </div>
            </div>
            <div>
              <div class="flex justify-between items-center mb-2">
                 <label class="block text-sm text-zinc-400 font-bold">{{ t('settings.similarityThreshold') }}</label>
                 <span class="text-amber-400 font-bold text-sm">{{ (memoryConfig.similarityThreshold * 100).toFixed(0) }}%</span>
              </div>
              <input v-model.number="memoryConfig.similarityThreshold" type="range" class="w-full accent-amber-500" min="0.5" max="1" step="0.05" />
            </div>
          </div>
        </div>

        <div v-if="memoryStats" class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
          <h3 class="text-lg font-bold text-white mb-2">{{ t('settings.memoryFileManagement') }}</h3>
          <p class="text-zinc-500 text-sm mb-6">{{ t('settings.memoryFileDesc') }}</p>
          
          <div v-if="agentMemoryStats.length === 0" class="text-zinc-500 text-center py-8 bg-white/[0.02] border border-white/[0.05] rounded-2xl">
            {{ t('settings.noMemoryData') }}
          </div>
          
          <div v-else class="space-y-4">
            <div v-for="agentStats in agentMemoryStats" :key="agentStats.agentId" class="bg-white/[0.03] border border-white/[0.05] p-5 rounded-2xl relative group">
              <!-- Glow effect on hover -->
              <div class="absolute -inset-1 bg-gradient-to-r from-amber-500/10 to-orange-500/10 blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
              
              <div class="relative">
              <div class="flex items-center justify-between mb-4 border-b border-white/[0.05] pb-3">
                  <h4 class="font-bold text-white text-md flex items-center gap-2">
                    <span v-if="agentStats._isOffice" class="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-lg font-bold">{{ t('settings.officeTag') }}</span>
                    {{ agentStats._isOffice ? agentStats._officeName : getAgentName(agentStats.agentId) }}
                    <span v-if="agentStats._belongsToOffice" class="text-[10px] bg-orange-500/15 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded-lg font-bold">🏢 {{ agentStats._belongsToOffice }}</span>
                  </h4>
                  <div class="flex items-center gap-3">
                    <span :class="['text-xs font-bold', agentStats.config.enabled ? 'text-emerald-400' : 'text-zinc-500']">
                      {{ agentStats.config.enabled ? t('settings.enabled') : t('settings.disabled') }}
                    </span>
                    <button 
                      class="text-amber-400 hover:text-amber-300 transition-colors text-xs font-bold"
                      @click="showCreateFileModal(agentStats.agentId)"
                    >
                      {{ t('settings.addFile') }}
                    </button>
                  </div>
                </div>
                
                <div v-if="agentStats.files && agentStats.files.length > 0" class="space-y-2 mb-4">
                  <div 
                    v-for="file in agentStats.files" 
                    :key="file.id" 
                    class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-black/40 border-l-[3px] border border-white/[0.05] rounded-xl text-sm hover:border-r-white/[0.1] hover:bg-white/[0.02] transition-colors gap-2"
                    :class="[
                       file.type === 'knowledge' ? 'border-l-amber-500' :
                       file.type === 'preference' ? 'border-l-green-500' :
                       'border-l-slate-500'
                    ]"
                  >
                    <div class="flex items-center gap-3 truncate max-w-[70%]">
                      <span class="text-zinc-200 font-medium truncate flex items-center gap-2"><span class="text-zinc-500">📄</span> {{ file.filename }}</span>
                      <span class="text-zinc-500 text-xs shrink-0">{{ formatFileSize(file.size) }}</span>
                      <span :class="getFileColorClass(file.type)" class="text-[10px] px-2 py-0.5 rounded-md font-bold shrink-0">
                        {{ getFileTypeName(file.type) }}
                      </span>
                    </div>
                    
                    <div class="flex items-center gap-2">
                       <button class="text-zinc-400 hover:text-amber-400 transition-colors p-1" title="查看内容" @click="viewMemoryFile(file.id)">
                         👁
                       </button>
                       <button class="text-zinc-500 hover:text-rose-400 transition-colors p-1" title="删除文件" @click="deleteMemoryFile(agentStats.agentId, file.id)">
                         🗑
                       </button>
                    </div>
                  </div>
                </div>
                
                <div v-else class="text-zinc-500 text-sm py-3 text-center bg-black/20 rounded-xl border border-white/[0.02] mb-4">
                  {{ t('settings.noMemoryFiles') }}
                </div>

                <div class="flex flex-wrap items-center gap-4 text-xs bg-black/40 p-3 rounded-xl border border-white/[0.02]">
                  <label class="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="checkbox" 
                      :checked="agentStats.config.enabled"
                      @change="(e) => toggleAgentMemory(agentStats.agentId, e)"
                      class="rounded text-amber-500 accent-amber-500"
                    />
                    <span :class="['font-bold', agentStats.config.enabled ? 'text-zinc-300' : 'text-zinc-500']">{{ t('settings.enableMemory') }}</span>
                  </label>
                <div class="flex items-center gap-1">
                  <label class="text-zinc-400 font-bold">{{ t('settings.heartbeat') }}</label>
                  <div class="w-32">
                    <CustomSelect 
                      :modelValue="agentStats.config.heartbeatIntervalMs"
                      :options="heartbeatOptions"
                      @change="(val) => updateAgentHeartbeat(agentStats.agentId, val)"
                    />
                  </div>
                </div>
                <div class="text-slate-500">
                  {{ t('settings.totalSize') }} {{ formatFileSize(agentStats.totalSize || 0) }}
                </div>
              </div>
             </div>
            </div>
          </div>

          <!-- Create File Modal -->
          <div v-if="creatingFileForAgent" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-slate-800 p-6 rounded-lg w-full max-w-lg border border-amber-500/20 shadow-xl shadow-black/50">
              <h3 class="text-lg font-bold text-amber-500 mb-4 border-b border-amber-500/10 pb-2">{{ t('settings.createMemoryFile') }}</h3>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm text-slate-300 font-bold mb-1">{{ t('settings.fileType') }}</label>
                  <CustomSelect
                    v-model="newFile.type"
                    :options="[
                      { value: 'knowledge', label: t('settings.importFromKB') },
                      { value: 'conversation', label: t('settings.importFromConversation') },
                      { value: 'preference', label: t('settings.userPreference') },
                      { value: 'custom', label: t('settings.customFileUpload') }
                    ]"
                  />
                </div>
                
                <div v-if="newFile.type === 'knowledge'" class="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                  <div>
                    <label class="block text-xs text-slate-400 mb-1">{{ t('settings.selectKB') }}</label>
                    <CustomSelect
                      :modelValue="newFile.knowledgeBaseId"
                      :options="knowledgeBases.map(kb => ({ value: kb.id, label: kb.name }))"
                      :placeholder="t('settings.selectKBPlaceholder')"
                      @update:modelValue="handleKnowledgeBaseSelect"
                    />
                  </div>
                  <div v-if="newFile.knowledgeBaseId">
                    <label class="block text-xs text-slate-400 mb-1">{{ t('settings.selectDocument') }}</label>
                    <CustomSelect
                      v-model="newFile.documentId"
                      :options="knowledgeDocuments.map(doc => ({ value: doc.id, label: doc.originalName }))"
                      :placeholder="t('settings.selectDocPlaceholder')"
                    />
                  </div>
                </div>

                <div v-else-if="newFile.type === 'conversation'" class="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                  <div>
                    <label class="block text-xs text-slate-400 mb-1">{{ t('settings.sourceCategory') }}</label>
                    <CustomSelect
                      v-model="newFile.sourceType"
                      :options="[
                        { value: 'thread', label: t('settings.historyThreads') },
                        { value: 'office', label: t('settings.officeChats') }
                      ]"
                    />
                  </div>
                  <div v-if="newFile.sourceType === 'thread'">
                    <label class="block text-xs text-slate-400 mb-1">{{ t('settings.selectThread') }}</label>
                    <CustomSelect
                      v-model="newFile.threadId"
                      :options="globalThreads.map(th => ({ value: th.thread.id, label: `${th.agentName} - ${th.thread.title || 'Untitled'}` }))"
                      :placeholder="t('settings.selectThreadPlaceholder')"
                    />
                  </div>
                  <div v-if="newFile.sourceType === 'office'">
                    <label class="block text-xs text-slate-400 mb-1">{{ t('settings.selectOffice') }}</label>
                    <CustomSelect
                      v-model="newFile.officeId"
                      :options="globalOffices.map(o => ({ value: o.id, label: o.name }))"
                      :placeholder="t('settings.selectOfficePlaceholder')"
                    />
                  </div>
                </div>

                <div v-else-if="newFile.type === 'custom'" class="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                  <div class="relative overflow-hidden rounded-lg border-2 border-dashed border-amber-500/30 hover:border-amber-500/60 bg-amber-500/5 transition-colors group p-6 text-center cursor-pointer">
                    <input 
                       type="file" 
                       class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                       @change="handleCustomFileUpload"
                    />
                    <div class="text-amber-500/80 group-hover:text-amber-400 font-bold mb-1">
                      {{ newFile.base64Content ? t('settings.fileSelected') : t('settings.uploadArea') }}
                    </div>
                    <div class="text-xs text-slate-500 truncate px-4">
                      {{ newFile.filename || t('settings.supportedFormats') }}
                    </div>
                  </div>
                  <div v-if="newFile.base64Content && newFile.filename" class="text-xs text-emerald-400 font-bold px-2 py-1 bg-emerald-400/10 rounded inline-block">
                    {{ t('settings.readyToSend') }} {{ newFile.filename }}
                  </div>
                </div>

                <div v-else class="space-y-3">
                  <div>
                    <label class="block text-sm text-slate-300 font-bold mb-1">{{ t('settings.fileName') }}</label>
                    <input v-model="newFile.filename" type="text" class="w-full bg-black/40 border border-white/10 text-zinc-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-3 py-2 transition-colors outline-none" :placeholder="t('settings.fileNamePlaceholder')" />
                  </div>
                  <div>
                    <label class="block text-sm text-slate-300 font-bold mb-1">{{ t('settings.memoryContent') }}</label>
                    <textarea v-model="newFile.content" class="w-full bg-black/40 border border-white/10 text-zinc-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg px-3 py-2 transition-colors outline-none h-40 custom-scrollbar" :placeholder="t('settings.memoryContentPlaceholder')"></textarea>
                  </div>
                </div>
              </div>
              <div class="flex justify-end gap-3 mt-6">
                <button class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-bold" @click="creatingFileForAgent = null">{{ t('settings.cancelCreate') }}</button>
                <button class="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg transition-colors text-sm font-bold shadow-lg shadow-amber-500/20" @click="createMemoryFile">{{ t('settings.createAndLoad') }}</button>
              </div>
            </div>
          </div>

          <!-- View File Modal -->
          <div v-if="viewingFile" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-slate-800 p-6 rounded-lg w-full max-w-2xl">
              <h3 class="text-lg font-semibold mb-4">{{ viewingFile.filename }}</h3>
              <pre class="bg-slate-900 p-4 rounded text-sm overflow-auto max-h-96 whitespace-pre-wrap">{{ viewingFile.content }}</pre>
              <div class="flex justify-end mt-4">
                <button class="btn btn-secondary" @click="viewingFile = null">{{ t('common.close') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <h3 class="text-lg font-semibold mb-4">{{ t('settings.safetyBackup') }}</h3>
          <p class="text-slate-400 text-sm mb-4">{{ t('settings.safetyBackupDesc') }}</p>
          
          <div class="flex gap-4 mb-4">
            <button class="btn btn-primary" @click="createSystemBackup" :disabled="creatingBackup">
              {{ creatingBackup ? t('settings.creatingBackup') : t('settings.createBackup') }}
            </button>
            <button class="btn btn-secondary" @click="loadSystemSafetyStatus">
              {{ t('settings.refreshStatus') }}
            </button>
          </div>

          <div v-if="systemSafetyHealth" class="bg-slate-700/50 p-4 rounded mb-4">
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-medium">{{ t('settings.systemHealth') }}</h4>
              <span :class="systemSafetyHealth.isResponsive ? 'text-green-400' : 'text-red-400'" class="text-sm">
                {{ systemSafetyHealth.isResponsive ? t('settings.normal') : t('settings.unresponsive') }}
              </span>
            </div>
            <div class="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span class="text-slate-400">{{ t('settings.uptimeLabel') }}</span>
                <span>{{ formatUptime(systemSafetyHealth.uptime) }}</span>
              </div>
              <div>
                <span class="text-slate-400">{{ t('settings.consecutiveFailures') }}</span>
                <span :class="systemSafetyHealth.consecutiveFailures > 0 ? 'text-yellow-400' : 'text-green-400'">
                  {{ systemSafetyHealth.consecutiveFailures }} 次
                </span>
              </div>
              <div>
                <span class="text-slate-400">{{ t('settings.lastHeartbeat') }}</span>
                <span>{{ formatDate(systemSafetyHealth.lastHeartbeat) }}</span>
              </div>
              <div>
                <span class="text-slate-400">{{ t('settings.serverLabel') }}</span>
                <span :class="systemSafetyHealth.serverRunning ? 'text-green-400' : 'text-red-400'">
                  {{ systemSafetyHealth.serverRunning ? t('settings.running') : t('settings.stopped') }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="currentSystemBackup" class="bg-slate-700/50 p-4 rounded mb-4">
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-medium">{{ t('settings.currentBackup') }}</h4>
              <span class="text-xs px-2 py-1 rounded" :class="getBackupTypeClass(currentSystemBackup.type)">
                {{ getBackupTypeLabel(currentSystemBackup.type) }}
              </span>
            </div>
            <div class="grid grid-cols-3 gap-4 text-sm mb-3">
              <div>
                <span class="text-slate-400">{{ t('settings.backupTime') }}</span>
                <span>{{ formatDate(currentSystemBackup.timestamp) }}</span>
              </div>
              <div>
                <span class="text-slate-400">{{ t('settings.backupSize') }}</span>
                <span>{{ formatBytes(currentSystemBackup.size) }}</span>
              </div>
              <div>
                <span class="text-slate-400">{{ t('settings.fileCount') }}</span>
                <span>{{ currentSystemBackup.filesCount }}</span>
              </div>
            </div>
            <div class="text-sm text-slate-400 mb-3">{{ currentSystemBackup.description }}</div>
            <button 
              class="btn btn-warning text-sm" 
              @click="restoreSystemBackup"
              :disabled="restoringBackup"
            >
              {{ restoringBackup ? t('settings.restoring') : t('settings.restoreBackup') }}
            </button>
          </div>

          <div v-else class="text-slate-400 text-center py-4">
            {{ t('settings.noBackup') }}
          </div>
        </div>

        <!-- Update Panel -->
        <div class="card border border-amber-500/20 bg-amber-500/5">
          <h3 class="text-lg font-semibold mb-4 text-amber-500">📥 GitHub 开源端极速同步</h3>
          <p class="text-slate-400 text-sm mb-4">通过防冲突底座直连远端 GitHub 仓库 (caicaichuangzhao/qilinclaw) ，检测落后的代码并一键覆盖更新。无痛接收最新开源能力。</p>
          
          <div class="flex gap-4 mb-4">
            <button class="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded transition-colors font-medium flex items-center gap-2" @click="checkSystemUpdate" :disabled="checkingUpdate || pullingUpdate">
               <span v-if="checkingUpdate" class="animate-spin text-amber-500">↻</span> 
               {{ checkingUpdate ? '正在探测远端日志...' : '检测是否有新版本代码' }}
            </button>
          </div>

          <div v-if="updateStatus?.hasUpdate" class="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl mt-4 max-w-2xl">
            <div class="flex items-start gap-3">
              <span class="text-2xl mt-0.5">🚀</span>
              <div>
                <h4 class="font-bold text-amber-500 text-lg mb-1">发现新代码可用！</h4>
                <p class="text-slate-300 text-sm mb-2">
                  本地节点落后开源上游主库 <strong class="text-amber-400 text-lg">{{ updateStatus.commitsBehind }}</strong> 个功能提交。
                </p>
                <div class="bg-black/40 rounded p-2 text-xs text-emerald-400 my-3 font-mono border border-emerald-500/20">
                  <span class="text-slate-500 mr-2">[{{"latestCommitHash" in updateStatus ? updateStatus.latestCommitHash : "Hash"}}]</span> {{ "latestCommitMessage" in updateStatus ? updateStatus.latestCommitMessage : "" }}
                </div>
                <button 
                  class="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold px-6 py-2 rounded-lg shadow-lg shadow-amber-500/20 transition-all transform active:scale-95"
                  @click="performSystemUpdate"
                  :disabled="pullingUpdate"
                >
                  {{ pullingUpdate ? '正在与 Github 并发同步文件中...' : '立即拉取源码热更新' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
