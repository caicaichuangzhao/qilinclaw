<script setup lang="ts">
import { ref, computed, onMounted, provide } from 'vue';
import { useRouter } from 'vue-router';
import { useStatusStore } from '@/stores/status';
import { useLLMStore } from '@/stores/models';
import { useI18n } from '@/i18n';
import { 
  Bot, MessageSquare, BookOpen, Cpu, BarChart3, Server, Zap, RefreshCw, Activity
} from 'lucide-vue-next';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import VChart, { THEME_KEY } from 'vue-echarts';

use([CanvasRenderer, BarChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent]);

const router = useRouter();
provide(THEME_KEY, 'dark');
const { t } = useI18n();

interface Agent {
  id: string;
  name: string;
  systemPrompt: string;
  updatedAt: number;
}

interface Thread {
  id: string;
  agentId: string;
  title: string;
  messageCount: number;
  updatedAt: number;
}

interface KnowledgeBase {
  id: string;
  name: string;
  documents: Array<{ chunks: unknown[] }>;
}



const statusStore = useStatusStore();
const llmStore = useLLMStore();

const agents = ref<Agent[]>([]);
const threads = ref<Thread[]>([]);
const knowledgeBases = ref<KnowledgeBase[]>([]);
const showDiagnostics = ref(false);

const isRefreshing = ref(false);

// Usage Stats
const now = Date.now();
interface TopModelItem {
  model: string;
  calls: number;
  tokens: number;
}
interface TopAgentItem {
  agentId: string;
  calls: number;
  tokens: number;
}
const usageStats = ref({
  totalCalls: 0,
  totalTokens: 0,
  totalCost: 0,
  period: { start: now - 86400000, end: now }, // Default to today
  topModels: [] as TopModelItem[],
  topAgents: [] as TopAgentItem[]
});

const formatLocalDate = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const selectedRange = ref('today');
// Date binding refs
const customStartDate = ref(formatLocalDate(new Date(usageStats.value.period.start)));
const customEndDate = ref(formatLocalDate(new Date(usageStats.value.period.end)));

const rangeOptions = computed(() => [
  { key: 'today', label: t('dashboard.today'), days: 1 },
  { key: 'week', label: t('dashboard.last7Days'), days: 7 },
  { key: 'month', label: t('dashboard.last30Days'), days: 30 },
]);

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

async function fetchUsageStats(startDate: number, endDate: number) {
  try {
    const response = await fetch(`/api/usage/stats?startDate=${startDate}&endDate=${endDate}`);
    if (response.ok) {
      usageStats.value = await response.json();
      usageStats.value.period = { start: startDate, end: endDate }; // Update period to reflect actual query
    }
  } catch (err) {
    console.error('Failed to load usage stats:', err);
  }
}

const setDateRange = (days: number, key: string) => {
  selectedRange.value = key;
  const end = new Date();
  end.setHours(23, 59, 59, 999); // End of today
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  start.setHours(0, 0, 0, 0); // Start of the day

  customStartDate.value = formatLocalDate(start);
  customEndDate.value = formatLocalDate(end);
  fetchUsageStats(start.getTime(), end.getTime());
};

const onCustomDateChange = () => {
  selectedRange.value = 'custom';
  const start = new Date(customStartDate.value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(customEndDate.value);
  end.setHours(23, 59, 59, 999);
  fetchUsageStats(start.getTime(), end.getTime());
};

onMounted(async () => {
  await Promise.all([
    statusStore.fetchStatus(),
    llmStore.fetchConfigs(),
    loadData(),
  ]);
  setDateRange(1, 'today'); // Load today's stats by default
});

async function loadData() {
  try {
    const [agentsRes, kbRes] = await Promise.all([
      fetch('/api/agents'),
      fetch('/api/knowledge'),
    ]);
    if (agentsRes.ok) {
      agents.value = await agentsRes.json();
      const allThreads: Thread[] = [];
      for (const agent of agents.value) {
        const threadsRes = await fetch(`/api/agents/${agent.id}/threads`);
        if (threadsRes.ok) {
          const agentThreads = await threadsRes.json();
          allThreads.push(...agentThreads.map((t: Thread) => ({ ...t, agentId: agent.id })));
        }
      }
      threads.value = allThreads.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    }
    if (kbRes.ok) {
      knowledgeBases.value = await kbRes.json();
    }
  } catch (error) {
    console.error('Failed to load data:', error);
  }
}

const handleRefresh = async () => {
  isRefreshing.value = true;
  await Promise.all([
    statusStore.fetchStatus(),
    llmStore.fetchConfigs(),
    loadData(),
  ]);
  // Re-fetch usage stats based on current selection
  if (selectedRange.value === 'custom') {
    onCustomDateChange();
  } else {
    const opt = rangeOptions.value.find(r => r.key === selectedRange.value);
    if (opt) setDateRange(opt.days, opt.key);
  }
  isRefreshing.value = false;
};



const stats = computed(() => [
  { label: t('dashboard.aiAssistants'), value: agents.value.length || '0', color: 'text-amber-400', icon: Bot },
  { label: t('dashboard.topics'), value: threads.value.length || '0', color: 'text-amber-400', icon: MessageSquare },
  { label: t('dashboard.knowledgeBases'), value: knowledgeBases.value.length || '0', color: 'text-amber-400', icon: BookOpen },
  { label: t('dashboard.modelConfigs'), value: llmStore.configs.filter(c => c.enabled).length || '0', color: 'text-amber-400', icon: Cpu },
]);

const uptimeFormatted = computed(() => {
  const uptimeMs = statusStore.status?.uptime || 0;
  const seconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return t('dashboard.uptimeFormat', { hours: String(hours), minutes: String(minutes) });
});

// Safe typed wrappers to avoid vue-tsc errors on dynamically typed statusStore object
const memoryStats = computed(() => {
  const mem = (statusStore.status as any)?.memory;
  if (!mem) return { heapUsed: 0, systemTotal: 0, systemFree: 0 };
  return {
    heapUsed: mem.heapUsed || 0,
    systemTotal: mem.systemTotal || 0,
    systemFree: mem.systemFree || 0
  };
});

const recentThreads = computed(() => threads.value.slice(0, 5));

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return t('dashboard.justNow');
  if (diff < 3600000) return t('dashboard.minutesAgo', { n: String(Math.floor(diff / 60000)) });
  if (diff < 86400000) return t('dashboard.hoursAgo', { n: String(Math.floor(diff / 3600000)) });
  return date.toLocaleDateString();
}

function getAgentName(agentId: string): string {
  const agent = agents.value.find(a => a.id === agentId);
  return agent?.name || t('dashboard.unknownAgent');
}

function continueThread(thread: { id: string; agentId: string }) {
  router.push({ path: '/agents', query: { agent: thread.agentId, thread: thread.id } });
}

const componentNameMap = computed(() => ({
  database: t('dashboard.database'),
  bots: t('dashboard.bots'),
  memory: t('dashboard.memory'),
  network: t('dashboard.network'),
  gateway: t('dashboard.gateway'),
}));

const agentChartOption = computed(() => {
  const agentsList = usageStats.value.topAgents.slice(0, 7);
  const xAxisData = agentsList.map(item => getAgentName(item.agentId));
  const seriesData = agentsList.map(item => item.tokens);

  return {
    backgroundColor: 'transparent',
    tooltip: { 
      trigger: 'axis', 
      backgroundColor: 'rgba(0,0,0,0.8)', 
      textStyle: { color: '#fff' },
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)'
    },
    grid: { left: '2%', right: '2%', bottom: '2%', top: '15%', containLabel: true },
    xAxis: {
      type: 'category',
      data: xAxisData,
      axisLabel: { color: '#9ca3af', interval: 0, rotate: agentsList.length > 5 ? 20 : 0 },
      axisLine: { lineStyle: { color: '#3f3f46' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#9ca3af' },
      splitLine: { lineStyle: { color: '#3f3f46', type: 'dashed' } }
    },
    series: [
      {
        name: t('dashboard.tokenConsumed'),
        type: 'bar',
        barWidth: '35%',
        itemStyle: {
          color: '#fbbf24',
          borderRadius: [4, 4, 0, 0]
        },
        data: seriesData
      }
    ]
  };
});
</script>

<template>
  <div class="flex-1 bg-white/[0.02] border border-white/[0.05] rounded-[2rem] backdrop-blur-2xl flex flex-col overflow-hidden shadow-2xl relative h-full">
    <!-- PageHeader -->
    <header class="h-24 flex items-center justify-between px-8 border-b border-white/[0.05] shrink-0">
      <div>
        <h1 class="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500 mb-1 flex items-center gap-2">{{ t('dashboard.title') }}</h1>
        <p class="text-zinc-500 text-sm">{{ t('dashboard.subtitle') }}</p>
      </div>
      <div class="flex gap-4">
        <button @click="handleRefresh" class="p-2.5 bg-white/[0.03] hover:bg-white/[0.08] rounded-xl border border-white/[0.05] text-zinc-400 hover:text-amber-400 transition-colors">
          <RefreshCw :size="18" :class="isRefreshing ? 'animate-spin text-amber-400' : ''" />
        </button>
      </div>
    </header>

    <div class="p-8 flex-1 overflow-y-auto custom-scrollbar space-y-6">

      <!-- 4 Top Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div v-for="stat in stats" :key="stat.label" class="bg-black/20 border border-white/[0.05] rounded-3xl p-6 flex items-center gap-5 shadow-inner hover:bg-white/[0.02] transition-colors cursor-default">
          <div :class="['p-3 bg-white/[0.05] rounded-2xl', stat.color]">
            <component :is="stat.icon" :size="24" />
          </div>
          <div>
            <div :class="['font-black text-white leading-none text-3xl mb-1', stat.color]">{{ stat.value }}</div>
            <div class="text-zinc-500 text-sm font-bold">{{ stat.label }}</div>
          </div>
        </div>
      </div>

      <!-- Model Usage -->
      <div class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
        <div class="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 class="text-amber-400" :size="20" /> {{ t('dashboard.modelUsage') }}
          </h3>
          <div class="flex items-center gap-4 border-b border-white/[0.05] pb-4 mb-4">
            <div class="flex gap-2">
              <button
                v-for="range in rangeOptions"
                :key="range.key"
                class="px-3 py-1.5 rounded-lg text-sm transition-all border font-bold"
                :class="selectedRange === range.key
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-white/[0.02] text-zinc-400 border-white/[0.05] hover:border-white/[0.1] hover:text-white'"
                @click="setDateRange(range.days, range.key)"
              >
                {{ range.label }}
              </button>
            </div>

            <div class="h-6 w-px bg-white/[0.1] mx-2"></div>

            <div class="flex items-center gap-2 text-sm text-zinc-400 font-medium">
               <input
                 type="date"
                 v-model="customStartDate"
                 @change="onCustomDateChange"
                 class="bg-black/40 border border-white/[0.05] rounded-md px-2 py-1 outline-none focus:border-amber-500/40 text-amber-500"
               />
               <span>{{ t('common.to') }}</span>
               <input
                 type="date"
                 v-model="customEndDate"
                 @change="onCustomDateChange"
                 class="bg-black/40 border border-white/[0.05] rounded-md px-2 py-1 outline-none focus:border-amber-500/40 text-amber-500"
               />
            </div>
          </div>
        </div>

        <div v-if="!usageStats || usageStats.totalCalls === 0" class="flex flex-col items-center justify-center text-zinc-500 pb-8 pt-4">
          <p class="font-medium text-zinc-400">{{ t('dashboard.noUsageData') }}</p>
          <p class="text-sm mt-1">{{ t('dashboard.noUsageDataHint') }}</p>
        </div>

        <div v-else class="space-y-6">
          <!-- Horizontal Metrics -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div class="bg-black/40 rounded-2xl p-6 border border-white/[0.05] flex flex-col justify-center shadow-inner hover:bg-white/[0.02] transition-colors relative overflow-hidden group">
               <div class="absolute -right-4 -top-4 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all"></div>
               <div class="text-zinc-500 font-bold mb-2">{{ t('dashboard.totalCalls') }}</div>
               <div class="text-3xl font-black text-amber-400">{{ usageStats.totalCalls }} <span class="text-lg text-amber-500/50">{{ t('common.times') }}</span></div>
             </div>
             <div class="bg-black/40 rounded-2xl p-6 border border-white/[0.05] flex flex-col justify-center shadow-inner hover:bg-white/[0.02] transition-colors relative overflow-hidden group">
               <div class="absolute -right-4 -top-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
               <div class="text-zinc-500 font-bold mb-2">{{ t('dashboard.totalTokens') }}</div>
               <div class="text-3xl font-black text-emerald-400">{{ usageStats.totalTokens > 10000 ? (usageStats.totalTokens/10000).toFixed(1) + ' w' : usageStats.totalTokens }}</div>
             </div>
             <div class="bg-black/40 rounded-2xl p-6 border border-white/[0.05] flex flex-col justify-center shadow-inner hover:bg-white/[0.02] transition-colors relative overflow-hidden group">
               <div class="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
               <div class="text-zinc-500 font-bold mb-2">{{ t('dashboard.estimatedCost') }}</div>
               <div class="text-3xl font-black text-blue-400">$ {{ (usageStats.totalCost || 0).toFixed(4) }}</div>
             </div>
          </div>

          <!-- Charts and Rankings -->
          <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <!-- Left: ECharts -->
            <div class="xl:col-span-2 bg-black/40 rounded-2xl p-6 border border-white/[0.05] shadow-inner flex flex-col">
               <h4 class="text-sm font-bold text-zinc-400 mb-4 flex items-center gap-2">{{ t('dashboard.agentTokenRank') }}</h4>
               <div class="flex-1 min-h-[300px] relative">
                 <v-chart class="absolute inset-0 w-full h-full" :option="agentChartOption" autoresize />
               </div>
            </div>
            
            <!-- Right: Model Ranking -->
            <div class="xl:col-span-1 bg-black/40 rounded-2xl p-6 border border-white/[0.05] shadow-inner flex flex-col">
              <h4 class="text-sm font-bold text-zinc-400 mb-4 flex items-center gap-2">{{ t('dashboard.modelRank') }}</h4>
              <div class="flex-1 overflow-y-auto custom-scrollbar space-y-3">
                <div v-if="!usageStats.topModels.length" class="text-center text-zinc-500 text-sm py-4">
                  {{ t('dashboard.noModelData') }}
                </div>
                <div 
                  v-for="(item, idx) in usageStats.topModels.slice(0, 6)" 
                  :key="item.model"
                  class="flex items-center gap-3 p-3 bg-white/[0.02] rounded-xl border border-white/[0.02] hover:bg-white/[0.05] transition-colors"
                >
                  <div class="w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                       :class="idx === 0 ? 'bg-amber-500/20 text-amber-400' : idx === 1 ? 'bg-slate-300/20 text-slate-300' : idx === 2 ? 'bg-orange-400/20 text-orange-400' : 'bg-white/5 text-zinc-500'">
                    {{ idx + 1 }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold text-zinc-200 truncate" :title="item.model">{{ item.model.split('/').pop() }}</div>
                    <div class="text-xs text-zinc-500 mt-0.5">{{ t('dashboard.callCount', { count: String(item.calls) }) }}</div>
                  </div>
                  <div class="text-right shrink-0">
                    <div class="text-sm font-bold text-emerald-400">{{ item.tokens > 10000 ? (item.tokens/10000).toFixed(1) + 'w' : item.tokens }}</div>
                    <div class="text-[10px] text-zinc-500">Tokens</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- System Status & Recent Topics -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">

        <!-- System Status -->
        <div class="flex-1 bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-bold text-white flex items-center gap-2">
              <Server class="text-zinc-400" :size="20" /> {{ t('dashboard.systemStatus') }}
            </h3>
            <button @click="showDiagnostics = !showDiagnostics" class="text-xs bg-white/[0.05] hover:bg-white/[0.1] px-3 py-1.5 rounded-lg text-zinc-300 transition-colors">
              {{ showDiagnostics ? t('dashboard.hideDetails') : t('dashboard.showDetails') }}
            </button>
          </div>

          <div class="space-y-4 text-sm">
            <div class="flex justify-between py-2 border-b border-white/[0.02]">
              <span class="text-zinc-400">{{ t('dashboard.runningStatus') }}</span>
              <span :class="[
                'font-bold',
                statusStore.healthStatus === 'healthy' ? 'text-emerald-400' :
                statusStore.healthStatus === 'degraded' ? 'text-amber-400' :
                statusStore.healthStatus === 'recovering' ? 'text-amber-400' :
                'text-rose-400'
              ]">{{ statusStore.statusText }}</span>
            </div>
            
            <div class="flex justify-between py-2 border-b border-white/[0.02]">
              <span class="text-zinc-400">{{ t('dashboard.uptime') }}</span>
              <span class="text-zinc-200 font-mono">{{ uptimeFormatted }}</span>
            </div>
            
            <div v-if="memoryStats.systemTotal > 0" class="text-right">
              <span class="text-zinc-400">{{ t('dashboard.memoryUsage') }}</span>
              <div class="font-bold text-white mt-1">{{ formatBytes(memoryStats.heapUsed) }} / {{ formatBytes(memoryStats.systemTotal) }}</div>
              <div class="text-xs text-zinc-500 mt-1">{{ t('dashboard.free') }}: {{ formatBytes(memoryStats.systemFree) }}</div>
            </div>
            <div class="mt-4 pt-4 border-t border-white/[0.02]">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-amber-400">💡</span>
                <span class="text-zinc-300 font-bold text-base">{{ t('dashboard.helpTitle') }}</span>
              </div>
              <ul class="text-sm text-zinc-400 space-y-2 list-disc list-inside">
                <li>{{ t('dashboard.helpKnowledge') }}</li>
                <li>{{ t('dashboard.helpAgents') }}</li>
                <li>{{ t('dashboard.helpOffice') }}</li>
                <li>{{ t('dashboard.helpBots') }}</li>
              </ul>
            </div>

            <div class="pt-2">
              <div class="grid grid-cols-2 gap-3" v-if="statusStore.status?.components">
                <div v-for="(component, name) in statusStore.status.components" :key="name" class="flex items-center gap-2">
                  <div :class="[
                    'w-2 h-2 rounded-full',
                    component.status === 'ok' ? 'bg-emerald-400' :
                    component.status === 'warning' || component.status === 'partial' ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' :
                    'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                  ]"></div>
                  <span class="text-zinc-300 uppercase truncate text-sm" :title="String(name)">{{ (componentNameMap as any)[name] || name }}</span>
                </div>
                </div>
              </div>
            </div>
          </div>

        <!-- Recent Topics -->
        <div class="flex-1 bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner flex flex-col">
          <h3 class="text-lg font-bold text-white flex items-center gap-2 mb-6">
            <MessageSquare class="text-zinc-400" :size="20" /> {{ t('dashboard.recentTopics') }}
          </h3>
          <div v-if="recentThreads.length === 0" class="flex-1 flex flex-col items-center justify-center text-zinc-500">
            <p class="mb-2">{{ t('dashboard.noTopics') }}</p>
            <router-link to="/agents" class="text-amber-400 hover:text-amber-300 text-sm transition-colors cursor-pointer">{{ t('dashboard.createFirstAgent') }} &rarr;</router-link>
          </div>
          <div v-else class="space-y-3 flex-1 overflow-y-auto custom-scrollbar">
            <div
              v-for="thread in recentThreads"
              :key="thread.id"
              class="group p-4 bg-slate-900/30 rounded-xl border border-white/5 hover:bg-white/[0.05] hover:border-amber-500/30 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md"
              @click="continueThread(thread)"
            >
              <div class="flex justify-between items-start gap-4">
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-slate-200 truncate group-hover:text-amber-300 transition-colors">{{ thread.title || t('dashboard.untitledTopic') }}</p>
                  <div class="flex items-center gap-2 mt-1.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      {{ getAgentName(thread.agentId) }}
                    </span>
                    <span class="text-xs text-slate-500">
                      {{ thread.messageCount || 0 }} {{ t('common.messages') }}
                    </span>
                  </div>
                </div>
                <span class="text-[11px] text-slate-500 font-medium whitespace-nowrap bg-slate-800/50 px-2 py-1 rounded-md">{{ formatTime(thread.updatedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Quick Actions -->
      <div class="bg-black/20 border border-white/[0.05] rounded-[2rem] p-6 shadow-inner">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            <Zap class="text-amber-400 fill-amber-400/20" :size="20" /> {{ t('dashboard.quickActions') }}
          </h3>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <router-link to="/agents" class="bg-black/40 hover:bg-white/[0.05] border border-white/[0.05] rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all hover:-translate-y-1 shadow-inner group">
            <div class="text-zinc-400 group-hover:text-amber-400 transition-colors"><Bot :size="28" /></div>
            <span class="text-zinc-300 font-bold text-sm group-hover:text-white transition-colors">{{ t('nav.agents') }}</span>
          </router-link>
          
          <router-link to="/bots" class="bg-black/40 hover:bg-white/[0.05] border border-white/[0.05] rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all hover:-translate-y-1 shadow-inner group">
            <div class="text-zinc-400 group-hover:text-amber-400 transition-colors"><Activity :size="28" /></div>
            <span class="text-zinc-300 font-bold text-sm group-hover:text-white transition-colors">{{ t('nav.bots') }}</span>
          </router-link>

          <router-link to="/knowledge" class="bg-black/40 hover:bg-white/[0.05] border border-white/[0.05] rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all hover:-translate-y-1 shadow-inner group">
            <div class="text-zinc-400 group-hover:text-amber-400 transition-colors"><BookOpen :size="28" /></div>
            <span class="text-zinc-300 font-bold text-sm group-hover:text-white transition-colors">{{ t('nav.knowledge') }}</span>
          </router-link>

          <router-link to="/llm" class="bg-black/40 hover:bg-white/[0.05] border border-white/[0.05] rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all hover:-translate-y-1 shadow-inner group">
            <div class="text-zinc-400 group-hover:text-amber-400 transition-colors"><Cpu :size="28" /></div>
            <span class="text-zinc-300 font-bold text-sm group-hover:text-white transition-colors">{{ t('nav.models') }}</span>
          </router-link>
        </div>
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
