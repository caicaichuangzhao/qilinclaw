<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { botApi, type BotConfig } from '@/api';
import { useLLMStore } from '@/stores/models';
import { Plus, Bot as BotIcon, X } from 'lucide-vue-next';
import CustomSelect from '../components/CustomSelect.vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface Agent {
  id: string;
  name: string;
  systemPrompt: string;
}

interface LinkedAgent {
  agentId: string;
  botId: string;
  botName: string;
}

const llmStore = useLLMStore();

const bots = ref<BotConfig[]>([]);
const agents = ref<Agent[]>([]);
const linkedAgents = ref<LinkedAgent[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingBot = ref<BotConfig | null>(null);
const createdBotId = ref<string | null>(null);

const createdBot = computed(() => bots.value.find(b => b.id === createdBotId.value));

const platformOptions = [
  { value: 'discord', label: 'Discord', icon: '🎮' },
  { value: 'telegram', label: 'Telegram', icon: '✈️' },
  { value: 'feishu', label: t('bots.feishu'), icon: '🪶' },
  { value: 'dingtalk', label: t('bots.dingtalk'), icon: '📌' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'wecom', label: t('bots.wecom'), icon: '🏢' },
  { value: 'qq', label: 'QQ', icon: '🐧' },
  { value: 'slack', label: 'Slack', icon: '💬' },
  { value: 'signal', label: 'Signal', icon: '🔒' },
  { value: 'imessage', label: 'iMessage', icon: '💬' },
  { value: 'msteams', label: 'MS Teams', icon: '👥' },
  { value: 'googlechat', label: 'Google Chat', icon: '💬' },
  { value: 'mattermost', label: 'Mattermost', icon: '💬' },
  { value: 'line', label: 'LINE', icon: '💬' },
];

const formData = ref({
  name: '',
  platform: 'discord',
  enabled: true,
  config: {} as Record<string, unknown>,
  llmConfigId: '',
  agentId: '',
  systemPrompt: '',
  allowedChannels: '',
  allowedUsers: '',
});

let pollingInterval: number | null = null;
const route = useRoute();

onMounted(async () => {
  await Promise.all([loadBots(), llmStore.fetchConfigs(), loadAgents(), loadLinkedAgents()]);
  
  // Start polling for bot status updates
  pollingInterval = window.setInterval(refreshBots, 5000);

  if (route.query.agentId) {
    openCreateModal();
    // setTimeout to ensure modal is rendered and options are loaded
    setTimeout(() => {
      formData.value.agentId = route.query.agentId as string;
    }, 100);
  }
});

onUnmounted(() => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
});

watch(showModal, (val) => {
  if (!val) {
    setTimeout(() => {
      createdBotId.value = null;
      editingBot.value = null;
    }, 300); // Wait for animation
  }
});

async function loadLinkedAgents() {
  try {
    const response = await fetch('/api/bots/linked-agents');
    if (response.ok) {
      linkedAgents.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load linked agents:', error);
  }
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

async function loadBots() {
  loading.value = true;
  await refreshBots();
  loading.value = false;
}

async function refreshBots() {
  try {
    const response = await botApi.getAll();
    bots.value = response.data;
    
    // Auto-close modal if the newly created WhatsApp bot is now running
    if (createdBotId.value) {
      const current = bots.value.find(b => b.id === createdBotId.value);
      if (current?.isRunning) {
        setTimeout(() => {
          if (showModal.value && createdBotId.value === current.id) {
            showModal.value = false;
            createdBotId.value = null;
            alert(t('bots.connectionSuccess') + ` "${current.name}"`);
          }
        }, 1500);
      }
    }
  } catch (error) {
    console.error('Failed to load bots:', error);
  }
}

function openCreateModal() {
  if (agents.value.length === 0) loadAgents();
  if (llmStore.configs.length === 0) llmStore.fetchConfigs();
  if (linkedAgents.value.length === 0) loadLinkedAgents();

  editingBot.value = null;
  formData.value = {
    name: '',
    platform: 'discord',
    enabled: true,
    config: { mode: 'websocket' },
    llmConfigId: llmStore.defaultConfigId || '',
    agentId: '',
    systemPrompt: '',
    allowedChannels: '',
    allowedUsers: '',
  };
  showModal.value = true;
  createdBotId.value = null;
}

function openEditModal(bot: BotConfig) {
  if (agents.value.length === 0) loadAgents();
  if (llmStore.configs.length === 0) llmStore.fetchConfigs();
  if (linkedAgents.value.length === 0) loadLinkedAgents();

  createdBotId.value = null;
  editingBot.value = bot;
  formData.value = {
    name: bot.name,
    platform: bot.platform,
    enabled: bot.enabled,
    config: { ...bot.config },
    llmConfigId: bot.llmConfigId,
    agentId: (bot as any).agentId || '',
    systemPrompt: bot.systemPrompt || '',
    allowedChannels: bot.allowedChannels?.join(', ') || '',
    allowedUsers: bot.allowedUsers?.join(', ') || '',
  };
  showModal.value = true;
}

function onPlatformChange() {
  const platform = formData.value.platform;
  // Initialize defaults based on the new platform
  formData.value.config = {};
  if (platform === 'feishu') formData.value.config.mode = 'websocket';
  else if (platform === 'dingtalk') formData.value.config.mode = 'stream';
}

const webhookUrl = computed(() => {
  if (!editingBot.value) return null;
  const platform = editingBot.value.platform;
  const requireWebhook = (p: string) => {
    return (p === 'feishu' && editingBot.value?.config.mode === 'webhook') ||
           (p === 'dingtalk' && editingBot.value?.config.mode === 'webhook') ||
           ['discord', 'slack', 'line', 'messenger', 'whatsapp', 'imessage', 'msteams', 'googlechat', 'mattermost'].includes(p);
  };
    
  if (!requireWebhook(platform)) return null;
  // Display the current domain + webhook path
  return `${window.location.origin}/api/webhooks/${platform}/${editingBot.value.id}`;
});

async function saveBot() {
  if (!formData.value.agentId) {
    alert(t('bots.selectAgentAlert'));
    return;
  }
  try {
    const config: Partial<BotConfig> = {
      name: formData.value.name,
      platform: formData.value.platform as BotConfig['platform'],
      enabled: formData.value.enabled,
      config: formData.value.config,
      llmConfigId: formData.value.llmConfigId,
      agentId: formData.value.agentId || undefined,
      systemPrompt: formData.value.systemPrompt || undefined,
      allowedChannels: formData.value.allowedChannels
        ? formData.value.allowedChannels.split(',').map((s: string) => s.trim())
        : undefined,
      allowedUsers: formData.value.allowedUsers
        ? formData.value.allowedUsers.split(',').map((s: string) => s.trim())
        : undefined,
    };

    if (editingBot.value) {
      const response = await botApi.update(editingBot.value.id, config);
      if (response.status === 400 && 'data' in response && 'error' in (response.data as any)) {
        alert((response.data as any).error || t('common.error'));
        return;
      }
      alert(t('bots.saveAndReconnect') + ` "${formData.value.name}"`);
      showModal.value = false;
    } else {
      const response = await botApi.create(config);
      if (response.status === 400 && 'data' in response && 'error' in (response.data as any)) {
        alert((response.data as any).error || t('common.error'));
        return;
      }
      
      if (formData.value.platform === 'whatsapp') {
        createdBotId.value = (response.data as any).id;
      } else {
        alert(t('bots.createAndConnect') + ` "${formData.value.name}"`);
        showModal.value = false;
      }
    }

    await loadBots();
    await loadLinkedAgents();
  } catch (error: any) {
    console.error('Failed to save bot:', error);
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || t('common.error');
    alert(errorMsg);
  }
}

async function deleteBot(id: string) {
  if (!confirm(t('models.deleteConfirm'))) return;
  try {
    await botApi.delete(id);
    await loadBots();
  } catch (error) {
    console.error('Failed to delete bot:', error);
  }
}

async function toggleBot(bot: BotConfig) {
  try {
    if (bot.enabled) {
      await botApi.stop(bot.id);
    } else {
      await botApi.start(bot.id);
    }
    await loadBots();
  } catch (error) {
    console.error('Failed to toggle bot:', error);
  }
}

const platformConfigFields = computed(() => {
  switch (formData.value.platform) {
    case 'discord':
      return [{ key: 'token', label: 'Bot Token', type: 'password', placeholder: '请输入 Bot Token' }];
    case 'telegram':
      return [{ key: 'token', label: 'Bot Token', type: 'password', placeholder: '请输入 Bot Token' }];
    case 'feishu':
      return [
        { key: 'appId', label: 'App ID', type: 'text', placeholder: 'cli_...' },
        { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '••••••••••••••••' },
        { key: 'mode', label: '连接模式', type: 'select', options: [{ value: 'websocket', label: 'WebSocket长连接（无需公网）' }, { value: 'webhook', label: 'Webhook回调（需要公网）' }] },
      ];
    case 'dingtalk':
      return [
        { key: 'clientId', label: 'Client ID (AppKey)', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret (AppSecret)', type: 'password' },
        { key: 'mode', label: t('bots.connectionMode'), type: 'select', options: [{ value: 'stream', label: t('bots.streamMode') }, { value: 'webhook', label: t('bots.webhookMode') }] },
      ];

    case 'whatsapp':
      return [
        { key: '_info', label: t('bots.connectionNote'), type: 'info', description: t('bots.whatsappNote') }
      ];
    case 'slack':
      return [
        { key: 'botToken', label: 'Bot User OAuth Token', type: 'password' },
        { key: 'signingSecret', label: 'Signing Secret (For Webhooks, Optional)', type: 'password' },
      ];
    case 'line':
      return [
        { key: 'channelAccessToken', label: 'Channel Access Token', type: 'password' },
        { key: 'channelSecret', label: 'Channel Secret (Optional)', type: 'password' },
      ];
    case 'messenger':
      return [
        { key: 'pageAccessToken', label: 'Page Access Token', type: 'password' },
        { key: 'verifyToken', label: 'Verify Token', type: 'text' },
      ];
    case 'signal':
      return [
        { key: 'endpoint', label: 'Signal REST API Endpoint', type: 'text', placeholder: 'http://127.0.0.1:8080' },
        { key: 'phoneNumber', label: 'Registered Phone Number', type: 'text', placeholder: '+1234567890' },
      ];
    case 'imessage':
      return [
        { key: 'serverUrl', label: 'BlueBubbles Server URL', type: 'text', placeholder: 'https://xxx.ngrok.io' },
        { key: 'password', label: 'BlueBubbles Password', type: 'password' },
      ];
    case 'msteams':
      return [
        { key: 'botId', label: 'Microsoft Bot ID (App ID)', type: 'text' },
        { key: 'botPassword', label: 'Microsoft Bot Password', type: 'password' },
      ];
    case 'googlechat':
      return [
        { key: 'credentialsJson', label: 'Service Account JSON (Full Text)', type: 'password', placeholder: '{"type":"service_account",...}' },
      ];
    case 'mattermost':
      return [
        { key: 'serverUrl', label: 'Mattermost Server URL', type: 'text', placeholder: 'https://mattermost.example.com' },
        { key: 'botToken', label: 'Bot Personal Access Token', type: 'password' },
      ];
    case 'wecom':
      return [
        { key: 'botId', label: 'Bot ID', type: 'text', placeholder: '请输入企业微信机器人 Bot ID' },
        { key: 'botSecret', label: 'Secret', type: 'password', placeholder: '请输入企业微信机器人 Secret' },
      ];
    case 'qq':
      return [
        { key: '_info', label: t('bots.configGuide'), type: 'info', description: t('bots.qqGuideDesc') },
        { key: 'appId', label: 'Bot AppID', type: 'text', placeholder: 'e.g. 102893083' },
        { key: 'token', label: 'Bot Token', type: 'password', placeholder: 'Enter Token' },
        { key: 'appSecret', label: '机器人密钥 (AppSecret)', type: 'password', placeholder: '请输入 AppSecret' },
        { key: '_doc', label: t('bots.qqHelp'), type: 'info', description: 'Docs: https://q.qq.com/wiki/botadmin/' },
      ];
    default:
      return [];
  }
});

function isAgentLinked(agentId: string): boolean {
  if (editingBot.value) {
    const linked = linkedAgents.value.find(l => l.agentId === agentId);
    return linked !== undefined && linked.botId !== editingBot.value.id;
  }
  return linkedAgents.value.some(l => l.agentId === agentId);
}

function getLinkedBotInfo(agentId: string): string | null {
  const linked = linkedAgents.value.find(l => l.agentId === agentId);
  if (linked && (!editingBot.value || linked.botId !== editingBot.value.id)) {
    return `${t('bots.agentLinkedOther', { name: linked.botName })}`;
  }
  return null;
}

function getPlatformLabel(platform: string): string {
  return platformOptions.find(p => p.value === platform)?.label || platform;
}

function getPlatformIcon(platform: string): string {
  return platformOptions.find(p => p.value === platform)?.icon || '🤖';
}

const llmOptions = computed(() => {
  const options = [{ value: '', label: t('bots.defaultConfig') }];
  llmStore.configs.forEach(config => {
    options.push({ value: config.id, label: config.name });
  });
  return options;
});

const agentOptions = computed(() => {
  const options: any[] = [];
  agents.value.forEach(agent => {
    options.push({ 
      value: agent.id, 
      label: `${agent.name}${isAgentLinked(agent.id) ? ` (${t('bots.linkedOther')})` : ''}`,
      disabled: isAgentLinked(agent.id)
    } as any);
  });
  return options;
});

function copyWebhookUrl() {
  if (webhookUrl.value) {
    window.navigator.clipboard.writeText(webhookUrl.value);
    window.alert(t('common.copied') + ' Webhook URL');
  }
}
</script>

<template>
  <div class="flex-1 bg-white/[0.02] border border-white/[0.05] rounded-[2rem] backdrop-blur-2xl flex flex-col overflow-hidden shadow-2xl relative h-full">
    
    <!-- Page Header -->
    <header class="h-24 flex items-center justify-between px-8 border-b border-white/[0.05] shrink-0">
      <div>
        <h1 class="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500 mb-1 flex items-center gap-2">{{ t('bots.title') }}</h1>
        <p class="text-zinc-500 text-sm">{{ t('bots.subtitle') }}</p>
      </div>
      <div class="flex gap-4">
        <button @click="openCreateModal" class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20 active:scale-95">
          <Plus :size="16" /> {{ t('bots.addBot') }}
        </button>
      </div>
    </header>

    <!-- Bots Grid -->
    <div class="p-8 flex-1 overflow-y-auto custom-scrollbar">
      <div v-if="loading" class="text-center py-12 flex justify-center">
        <div class="animate-spin h-8 w-8 border-4 border-amber-500/50 border-t-amber-500 rounded-full mx-auto"></div>
      </div>
      <div v-else-if="bots.length === 0" class="flex flex-col items-center justify-center h-64 text-zinc-500">
        <BotIcon :size="48" class="text-zinc-600 mb-4 opacity-50" />
        <p class="mb-4 text-zinc-400">{{ t('bots.noBots') }}</p>
        <button @click="openCreateModal" class="flex items-center gap-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm font-bold transition-colors border border-white/[0.05]">
          <Plus :size="16" /> {{ t('bots.addFirst') }}
        </button>
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div
          v-for="bot in bots"
          :key="bot.id"
          class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-5 shadow-inner hover:border-white/[0.1] transition-colors"
        >
          <div class="flex justify-between items-start mb-6">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-2xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-zinc-300 text-lg">
                {{ getPlatformIcon(bot.platform) }}
              </div>
              <div>
                <h4 class="font-bold text-white text-lg">{{ bot.name }}</h4>
                <p class="text-xs text-zinc-500">{{ getPlatformLabel(bot.platform) }}</p>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span :class="`px-2.5 py-1 flex items-center gap-1.5 border rounded-md text-xs font-bold max-w-fit ${
                bot.isRunning 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : bot.enabled 
                    ? (bot.lastError ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20')
                    : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
              }`">
                <div v-if="bot.isRunning" class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                <div v-else-if="bot.enabled" :class="`w-1.5 h-1.5 rounded-full ${bot.lastError ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`"></div>
                <div v-else class="w-1.5 h-1.5 rounded-full bg-zinc-400"></div>
                {{ bot.isRunning ? t('bots.running') : (bot.enabled ? (bot.lastError ? t('bots.connectionFailed') : t('bots.startingUp')) : t('bots.stopped')) }}
              </span>
            </div>
          </div>
          
          <div v-if="bot.enabled && !bot.isRunning && bot.lastError" class="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2">
            <span class="mt-0.5">⚠️</span>
            <div class="flex-1 break-words font-mono opacity-80" style="white-space: pre-wrap">{{ bot.lastError }}</div>
          </div>

          <!-- QR Code Display for WhatsApp -->
          <div v-if="bot.platform === 'whatsapp' && bot.statusData?.qrCode && !bot.isRunning" class="mb-5 p-4 rounded-2xl bg-white/[0.05] border border-white/[0.1] flex flex-col items-center gap-3">
            <p class="text-xs text-amber-500 font-bold flex items-center gap-2">
              <span class="animate-pulse">📱</span> {{ t('bots.scanQR') }}
            </p>
            <div class="p-2 bg-white rounded-lg shadow-xl shadow-amber-500/10">
              <img :src="(bot.statusData as any).qrCode" alt="WhatsApp QR Code" class="w-48 h-48" />
            </div>
            <p class="text-[10px] text-zinc-500 text-center">{{ t('bots.qrNote') }}</p>
          </div>

          <div class="flex gap-2">
            <button @click="openEditModal(bot)" class="flex-1 py-2 bg-white/[0.05] hover:bg-amber-500/20 hover:text-amber-400 text-zinc-300 rounded-xl text-sm font-bold transition-colors border border-white/[0.05]">{{ t('common.edit') }}</button>
            <button @click="toggleBot(bot)" :class="`flex-1 py-2 ${bot.enabled ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'} rounded-xl text-sm transition-colors font-bold`">
              {{ bot.enabled ? t('bots.stop') : t('bots.start') }}
            </button>
            <button @click="deleteBot(bot.id)" class="flex-1 py-2 bg-white/[0.05] hover:bg-red-500/10 hover:text-red-400 text-zinc-400 rounded-xl text-sm font-bold transition-colors border border-white/[0.05]">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div class="bg-[#1e2330] w-full max-w-lg rounded-2xl shadow-2xl border border-white/[0.05] flex flex-col max-h-[90vh] overflow-hidden" @click.stop>
        
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/[0.05]">
          <h2 class="text-lg font-bold text-white">{{ editingBot ? t('bots.editBot') : t('bots.addBot') }}</h2>
          <button @click="showModal = false" class="text-zinc-400 hover:text-amber-400 transition-colors">
            <X :size="20" />
          </button>
        </div>

        <div v-if="createdBotId && createdBot" class="flex-1 overflow-y-auto p-10 flex flex-col items-center justify-center space-y-6 text-center">
          <div v-if="!createdBot.isRunning">
            <div v-if="createdBot.statusData?.qrCode" class="animate-in zoom-in duration-300">
              <h3 class="text-xl font-bold text-amber-500 mb-2">{{ t('bots.scanWhatsApp') }}</h3>
              <p class="text-sm text-zinc-400 mb-6 px-4">{{ t('bots.scanWhatsAppDesc') }}</p>
              
              <div class="p-4 bg-white rounded-3xl shadow-2xl shadow-amber-500/20 inline-block mb-6 border-4 border-amber-500/20">
                <img :src="(createdBot.statusData as any).qrCode" alt="WhatsApp QR" class="w-64 h-64 grayscale-0 contrast-125" />
              </div>
              
              <div class="flex items-center justify-center gap-3 text-amber-400/80 text-sm font-medium">
                <div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
                {{ t('bots.waitingScan') }}
              </div>
            </div>
            <div v-else class="flex flex-col items-center py-12">
              <div class="animate-spin h-12 w-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full mb-6"></div>
              <h3 class="text-xl font-bold text-white mb-2">{{ t('bots.preparingQR') }}</h3>
              <p class="text-sm text-zinc-500">{{ t('bots.preparingQRDesc') }}</p>
            </div>
          </div>
          <div v-else class="animate-in fade-in zoom-in duration-500">
            <div class="w-20 h-20 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center mb-6 mx-auto">
              <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h3 class="text-2xl font-bold text-emerald-400 mb-2">{{ t('bots.connectionSuccess') }}</h3>
            <p class="text-sm text-zinc-400">{{ t('bots.botReady') }}</p>
          </div>
          
          <div class="pt-8 w-full">
            <button @click="showModal = false" class="w-full py-3 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm font-bold transition-colors border border-white/[0.05]">
              {{ createdBot.isRunning ? t('bots.done') : t('bots.waitInList') }}
            </button>
          </div>
        </div>

        <form v-else @submit.prevent="saveBot" class="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar flex flex-col">
          
          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('bots.name') }}</label>
            <input
              v-model="formData.name"
              type="text"
              required
              :placeholder="t('bots.namePlaceholder')"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('bots.platform') }}</label>
            <CustomSelect
              v-model="formData.platform"
              :options="platformOptions"
              :disabled="!!editingBot"
              :placeholder="t('bots.selectPlatform')"
              @change="onPlatformChange"
            />
          </div>

          <div v-for="field in platformConfigFields" :key="field.key">
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ field.label }}</label>
            
            <div v-if="field.type === 'select'">
              <CustomSelect
                :modelValue="formData.config[field.key] as string"
                @update:modelValue="(val) => formData.config[field.key] = val"
                :options="(field as any).options"
                placeholder="--"
              />
            </div>
            
            <div v-else-if="field.type === 'info'" class="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-xs text-amber-200/70 leading-relaxed">
              {{ (field as any).description }}
            </div>
            
            <input
              v-else
              :value="formData.config[field.key]"
              @input="(e) => formData.config[field.key] = (e.target as HTMLInputElement).value"
              :type="field.type"
              :placeholder="(field as any).placeholder || ''"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('bots.modelConfig') }}</label>
            <CustomSelect
              v-model="formData.llmConfigId"
              :options="llmOptions"
              :placeholder="t('bots.defaultConfig')"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('bots.linkAgent') }}</label>
            <CustomSelect
              v-model="formData.agentId"
              :options="agentOptions"
              :placeholder="t('bots.mustSelectAgent')"
              searchable
            />
            <p class="text-[10px] text-zinc-500 mt-1">{{ t('bots.linkAgentDesc') }}</p>
            <p v-if="formData.agentId && getLinkedBotInfo(formData.agentId)" class="text-[10px] text-yellow-400 mt-1">
              ⚠️ {{ getLinkedBotInfo(formData.agentId) }}
            </p>
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('bots.systemPrompt') }}</label>
            <textarea
              v-model="formData.systemPrompt"
              rows="3"
              :placeholder="t('bots.systemPromptPlaceholder')"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-3 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors resize-none h-24 placeholder-zinc-600"
            ></textarea>
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">
              {{ t('bots.allowedChannels') }}
            </label>
            <input
              v-model="formData.allowedChannels"
              type="text"
              :placeholder="t('bots.allowedChannelsPlaceholder')"
              class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600"
            />
          </div>

          <div v-if="webhookUrl" class="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <label class="block text-xs font-bold text-amber-500 mb-1">{{ t('bots.webhookUrl') }}</label>
            <p class="text-[10px] text-amber-500/80 mb-2">请复制并在 {{ getPlatformLabel(editingBot!.platform) }} 后台中配置此 URL</p>
            <div class="flex items-center gap-2">
              <input
                :value="webhookUrl"
                type="text"
                readonly
                class="flex-1 bg-black/40 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-400 outline-none w-full font-mono selection:bg-amber-500/30"
              />
              <button
                type="button"
                @click="copyWebhookUrl"
                class="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
              >
                {{ t('common.copy') }}
              </button>
            </div>
          </div>

          <!-- spacer -->
          <div class="flex-1 min-h-4"></div>

          <div class="flex justify-between gap-4 mt-4 pt-4 border-t border-white/[0.05]">
            <button type="button" class="flex-1 py-2.5 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm font-bold transition-colors border border-white/[0.05]" @click="showModal = false">
              {{ t('common.cancel') }}
            </button>
            <button type="submit" class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-sm font-bold transition-colors shadow-lg shadow-amber-500/20">
              {{ editingBot ? t('bots.saveAndReconnect') : t('bots.createAndConnect') }}
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
</style>
