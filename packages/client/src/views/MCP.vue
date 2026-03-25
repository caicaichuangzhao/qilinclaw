<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  status: 'stopped' | 'running' | 'error';
  capabilities: string[];
  createdAt: number;
  updatedAt: number;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

const route = useRoute();
const router = useRouter();

const servers = ref<MCPServer[]>([]);
const selectedServer = ref<MCPServer | null>(null);
const tools = ref<MCPTool[]>([]);
const loading = ref(false);
const showModal = ref(false);
const formData = ref({
  name: '',
  command: '',
  args: '',
  enabled: true,
});
const searchQuery = ref('');

const filteredServers = computed(() => {
  let result = servers.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.command.toLowerCase().includes(q) || 
      s.args.join(' ').toLowerCase().includes(q)
    );
  }
  return result;
});

onMounted(async () => {
  await loadServers();
  if (route.query.server) {
    const serverId = route.query.server as string;
    const target = servers.value.find(s => s.id === serverId);
    if (target) selectServer(target);
  }
});

async function loadServers() {
  loading.value = true;
  try {
    const response = await fetch('/api/mcp/servers');
    if (response.ok) {
      servers.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load servers:', error);
  } finally {
    loading.value = false;
  }
}

async function selectServer(server: MCPServer) {
  selectedServer.value = server;
  router.replace({ query: { ...route.query, server: server.id } }).catch(() => {});
  if (server.status === 'running') {
    await loadTools(server.id);
  } else {
    tools.value = [];
  }
}

async function loadTools(serverId: string) {
  try {
    const response = await fetch(`/api/mcp/servers/${serverId}/tools`);
    if (response.ok) {
      tools.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to load tools:', error);
    tools.value = [];
  }
}

async function startServer(server: MCPServer) {
  try {
    await fetch(`/api/mcp/servers/${server.id}/start`, { method: 'POST' });
    await loadServers();
    if (selectedServer.value?.id === server.id) {
      await loadTools(server.id);
    }
  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

async function stopServer(server: MCPServer) {
  try {
    await fetch(`/api/mcp/servers/${server.id}/stop`, { method: 'POST' });
    await loadServers();
    tools.value = [];
  } catch (error) {
    console.error('Failed to stop server:', error);
  }
}

async function toggleServer(server: MCPServer) {
  try {
    await fetch(`/api/mcp/servers/${server.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    await loadServers();
  } catch (error) {
    console.error('Failed to toggle server:', error);
  }
}

function openCreateModal() {
  formData.value = {
    name: '',
    command: '',
    args: '',
    enabled: true,
  };
  showModal.value = true;
}

async function saveServer() {
  try {
    const serverData = {
      name: formData.value.name,
      command: formData.value.command,
      args: formData.value.args.split(' ').filter(a => a),
      env: {},
      enabled: formData.value.enabled,
      capabilities: [],
    };

    await fetch('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverData),
    });

    showModal.value = false;
    await loadServers();
  } catch (error) {
    console.error('Failed to save server:', error);
  }
}

async function deleteServer(id: string) {
  if (!confirm(t('mcp.deleteConfirm'))) return;

  try {
    await fetch(`/api/mcp/servers/${id}`, { method: 'DELETE' });
    selectedServer.value = null;
    tools.value = [];
    await loadServers();
  } catch (error) {
    console.error('Failed to delete server:', error);
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-green-500';
    case 'error': return 'bg-red-500';
    default: return 'bg-slate-500';
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
</script>

<template>
  <div class="h-full overflow-auto p-6">
    <div class="max-w-6xl mx-auto">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500">{{ t('mcp.title') }}</h1>
          <p class="text-slate-400 mt-2">{{ t('mcp.subtitle') }}</p>
        </div>
        <div class="flex gap-4 items-center">
          <div class="relative w-64">
            <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" class="stroke-current" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <input v-model="searchQuery" type="text" class="w-full bg-black/40 border border-white/[0.05] rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600 shadow-inner" :placeholder="t('mcp.searchPlaceholder')" />
          </div>
          <button class="px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg bg-gradient-to-br from-amber-500 to-yellow-500 text-black shadow-amber-500/20 active:scale-95 whitespace-nowrap" @click="openCreateModal">
            {{ t('mcp.addServer') }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-12 gap-6">
        <!-- Server List -->
        <div class="col-span-4">
          <div class="card">
            <h3 class="text-lg font-semibold mb-4">{{ t('mcp.serverList') }}</h3>

            <div v-if="loading" class="text-center py-4">
              <div class="animate-spin h-6 w-6 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"></div>
            </div>

            <div v-else-if="servers.length === 0" class="text-center py-4 text-slate-400">
              {{ t('mcp.noServers') }}
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="server in filteredServers"
                :key="server.id"
                :class="[
                  'p-3 rounded-xl cursor-pointer transition-all duration-300',
                  selectedServer?.id === server.id ? 'bg-amber-500/10 border border-amber-500/20 shadow-[inset_2px_0_0_0_#f59e0b]' : 'bg-black/20 border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/20'
                ]"
                @click="selectServer(server)"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div :class="['w-2 h-2 rounded-full', getStatusColor(server.status)]"></div>
                    <span class="font-medium">{{ server.name }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-red-400/60 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
                      title="删除服务器"
                      @click.stop="deleteServer(server.id)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                    <input
                      type="checkbox"
                      :checked="server.enabled"
                      @change.stop="toggleServer(server)"
                      class="toggle"
                      @click.stop
                    />
                  </div>
                </div>
                <p class="text-xs text-slate-400 mt-1">{{ server.command }} {{ server.args.join(' ') }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Server Details -->
        <div class="col-span-8">
          <div v-if="selectedServer" class="card">
            <div class="flex justify-between items-start mb-4">
              <div>
                <h3 class="text-xl font-semibold">{{ selectedServer.name }}</h3>
                <div class="flex items-center gap-2 mt-1">
                  <div :class="['w-2 h-2 rounded-full', getStatusColor(selectedServer.status)]"></div>
                  <span class="text-sm text-slate-400">{{ selectedServer.status }}</span>
                </div>
              </div>
              <div class="flex gap-2">
                <button
                  v-if="selectedServer.status !== 'running'"
                  class="btn btn-primary"
                  @click="startServer(selectedServer)"
                  :disabled="!selectedServer.enabled"
                >
                  {{ t('common.start') }}
                </button>
                <button
                  v-else
                  class="btn btn-secondary"
                  @click="stopServer(selectedServer)"
                >
                  {{ t('common.stop') }}
                </button>
                <button
                  class="btn btn-danger"
                  @click="deleteServer(selectedServer.id)"
                >
                  {{ t('common.delete') }}
                </button>
              </div>
            </div>

            <div class="space-y-4">
              <div>
                <h4 class="text-sm text-slate-400 mb-1">{{ t('mcp.command') }}</h4>
                <p class="bg-black/40 border border-white/5 p-3 rounded-xl font-mono text-sm">
                  {{ selectedServer.command }} {{ selectedServer.args.join(' ') }}
                </p>
              </div>

              <div>
                <h4 class="text-sm text-slate-400 mb-1">{{ t('mcp.capabilities') }}</h4>
                <div class="flex flex-wrap gap-2">
                  <span
                    v-for="cap in selectedServer.capabilities"
                    :key="cap"
                    class="text-xs px-2 py-1 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  >
                    {{ cap }}
                  </span>
                  <span v-if="selectedServer.capabilities.length === 0" class="text-slate-500 text-sm">
                    {{ t('mcp.noCapabilities') }}
                  </span>
                </div>
              </div>

              <div>
                <h4 class="text-sm text-slate-400 mb-2">{{ t('mcp.tools') }} ({{ tools.length }})</h4>
                <div v-if="selectedServer.status === 'running'" class="space-y-2">
                  <div
                    v-for="tool in tools"
                    :key="tool.name"
                    class="bg-black/20 border border-white/5 p-4 rounded-xl"
                  >
                    <h5 class="font-medium">{{ tool.name }}</h5>
                    <p class="text-sm text-slate-400">{{ tool.description }}</p>
                  </div>
                  <div v-if="tools.length === 0" class="text-slate-500 text-sm">
                    {{ t('mcp.noTools') }}
                  </div>
                </div>
                <div v-else class="text-slate-500 text-sm">
                  {{ t('mcp.startToViewTools') }}
                </div>
              </div>

              <div class="text-xs text-slate-500">
                {{ t('mcp.createdAt') }}: {{ formatDate(selectedServer.createdAt) }}
              </div>
            </div>
          </div>

          <div v-else class="card text-center py-12">
            <p class="text-slate-400">{{ t('mcp.selectServerToView') }}</p>
          </div>
        </div>
      </div>

      <!-- Modal -->
      <div
        v-if="showModal"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click="showModal = false"
      >
        <div class="bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" @click.stop>
          <h2 class="text-xl font-semibold mb-4">{{ t('mcp.addMcpServer') }}</h2>

          <form @submit.prevent="saveServer" class="space-y-4">
            <div>
              <label class="block text-sm text-slate-400 mb-1">{{ t('mcp.serverName') }}</label>
              <input v-model="formData.name" type="text" class="input w-full" required />
            </div>

            <div>
              <label class="block text-sm text-slate-400 mb-1">{{ t('mcp.serverCommand') }}</label>
              <input v-model="formData.command" type="text" class="input w-full" placeholder="npx" required />
            </div>

            <div>
              <label class="block text-sm text-slate-400 mb-1">{{ t('mcp.args') }}</label>
              <input v-model="formData.args" type="text" class="input w-full" placeholder="-y @modelcontextprotocol/server-filesystem" />
            </div>

            <div class="flex items-center gap-2">
              <input type="checkbox" v-model="formData.enabled" class="toggle" />
              <span class="text-sm">{{ t('mcp.enable') }}</span>
            </div>

            <div class="flex justify-end gap-2 pt-4">
              <button type="button" class="btn btn-secondary" @click="showModal = false">
                {{ t('common.cancel') }}
              </button>
              <button type="submit" class="btn btn-primary">
                {{ t('common.save') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
