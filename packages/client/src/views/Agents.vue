<script setup lang="ts">
import 'highlight.js/styles/github-dark.css';
import { 
  Plus, Edit3, Trash2, ShieldAlert, ChevronDown,
  Bot as BotIcon, ChevronRight, X, User, Paperclip, BookOpen, Sparkles,
  Copy, RotateCcw, Undo2, MessageSquare, Minus, AlertTriangle, Check
} from 'lucide-vue-next';
import CustomSelect from '../components/CustomSelect.vue';
import { useAgentWorkspace } from '../composables/useAgentWorkspace';
import { useI18n } from '@/i18n';

const { t } = useI18n();

const {
  agents,
  threads,
  selectedAgent,
  selectedThread,
  route,
  router,
  agentWorkingStore,
  chatViewTab,
  messages,
  inputMessage,
  isLoading,
  abortController,
  messagesContainer,
  selectedConfigId,
  modelConfigs,
  uploadedFiles,
  fileInput,
  knowledgeBases,
  selectedKnowledgeBases,
  showKBSelector,
  allThreads,
  selectedHistoryThreads,
  useHistory,
  ws,
  initWebSocket,
  skills,
  mcpServers,
  skillSearchQuery,
  mcpSearchQuery,
  showSkills,
  showMCP,
  allSkillsEnabled,
  allMCPServersEnabled,
  showAgentModal,
  editingAgent,
  isEditing,
  showThreadModal,
  newThreadTitle,
  showSmartCreateModal,
  smartCreatePrompt,
  smartCreateLoading,
  smartCreateSelectedConfigId,
  SMART_CREATE_CONFIG_KEY,
  loadSmartCreateConfig,
  saveSmartCreateConfig,
  defaultSystemPrompt,
  systemPrompt,
  agentTemplates,
  applyTemplate,
  loadmodelConfigs,
  loadKnowledgeBases,
  loadAllThreadsForHistory,
  loadSkills,
  loadMCPServers,
  filteredSkills,
  filteredMCPServers,
  modelConfigOptions,
  getSelectedSkillIds,
  getSelectedMCPIds,
  addSkillToAgent,
  removeSkillFromAgent,
  addMCPToAgent,
  removeMCPFromAgent,
  toggleAllSkills,
  toggleAllMCPServers,
  updateAllSkillsStatus,
  updateAllMCPServersStatus,
  loadAgents,
  loadThreads,
  selectAgent,
  updateAgentModelConfig,
  openCreateAgentModal,
  openEditAgentModal,
  handleSaveAgent,
  saveAgent,
  updateAgentDirect,
  deleteAgent,
  handleSmartCreate,
  openCreateThreadModal,
  createThread,
  selectThread,
  deleteThread,
  sendMessage,
  scrollToBottom,
  stopMessage,
  renderMarkdown,
  formatTime,
  formatDate,
  copyMessage,
  deleteMessageFromUI,
  recallMessage,
  editMessage,
  replyMessage,
  regenerateMessage,
  handleAvatarUpload,
  readFileAsDataUrl,
  isImageType,
  isVideoType,
  isAudioType,
  getPermissionModeLabel,
  pendingSkillApproval,
  resolveSkillApproval,
  handlePaste,
  previewImage
} = useAgentWorkspace();
</script>

<template>
  <div class="flex h-full gap-4 w-full p-2 lg:p-4 bg-transparent outline-none">
    
    <!-- 左侧：助手列表-->
    <div class="w-80 bg-[#1e2330] rounded-[2rem] border border-white/[0.05] flex flex-col shadow-2xl p-4 overflow-hidden shrink-0 relative">
      <div class="mb-4 pt-2">
        <h2 class="text-xl font-bold text-white mb-4">{{ t('agents.myAgents') }}</h2>
        <div class="flex gap-2">
          <button 
            @click="openCreateAgentModal"
            class="flex-1 py-2.5 bg-gradient-to-r from-slate-500/10 to-zinc-500/10 hover:from-slate-500/20 hover:to-zinc-500/20 border border-slate-500/20 text-slate-300 rounded-xl text-sm transition-colors flex items-center justify-center gap-1 font-bold shrink-0"
          >
            <Plus :size="14" /> {{ t('agents.create') }}
          </button>
          <button 
            @click="showSmartCreateModal = true"
            class="flex-1 py-2.5 bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 border border-amber-500/20 text-amber-400 rounded-xl text-sm transition-colors flex items-center justify-center gap-1 font-bold shrink-0 shadow-lg shadow-amber-500/10"
          >
            <Sparkles :size="14" /> {{ t('agents.smartCreate') }}
          </button>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
        <div 
          v-for="agent in agents" 
          :key="agent.id"
          @click="selectAgent(agent)"
          :class="['flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border relative overflow-hidden', selectedAgent?.id === agent.id ? 'bg-white/[0.05] border-amber-500/30 shadow-inner' : 'bg-transparent border-transparent hover:bg-white/[0.02] hover:border-white/[0.05]', agentWorkingStore.isAgentWorking(agent.id) ? 'animate-shimmer-gold' : '']"
        >
          <div class="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
            <div class="relative shrink-0">
              <div :class="['w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-amber-400 to-yellow-500 shadow-lg shrink-0 overflow-hidden text-black relative z-10', agentWorkingStore.isAgentWorking(agent.id) ? 'shadow-[0_0_15px_rgba(251,191,36,0.3)]' : '']">
                <img v-if="agent.avatar" :src="agent.avatar" class="w-full h-full object-cover" />
                <BotIcon v-else :size="20" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="font-bold text-slate-200 text-sm leading-tight truncate">{{ agent.name }}</h3>
              <p class="text-[11px] text-slate-500 leading-tight mt-1 truncate w-full">{{ getPermissionModeLabel(agent.permissionMode) }}</p>
            </div>
            <span v-if="agentWorkingStore.isAgentWorking(agent.id)" class="working-badge shrink-0">{{ t('agents.busy') }}</span>
          </div>
          <ChevronRight :size="14" :class="selectedAgent?.id === agent.id ? 'text-amber-500' : 'text-slate-600'" />
        </div>
      </div>
    </div>

    <!-- 中间：当前助话题列表及配置 -->
    <div v-if="selectedAgent" class="w-72 bg-[#1e2330] rounded-[2rem] border border-white/[0.05] flex flex-col shadow-2xl shrink-0 overflow-hidden">
      <div class="p-4 border-b border-white/[0.05]">
        <div class="flex text-sm">
          <button @click="chatViewTab = 'config'" :class="['flex-1 pb-2 text-center font-bold border-b-2 transition-colors', chatViewTab === 'config' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300']">{{ t('agents.config') }}</button>
          <button @click="chatViewTab = 'threads'" :class="['flex-1 pb-2 text-center font-bold border-b-2 transition-colors', chatViewTab === 'threads' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300']">{{ t('agents.threads') }}</button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar p-3 relative">
        <template v-if="chatViewTab === 'threads'">
          <div class="space-y-4">
            <h3 class="font-bold text-white px-2 mb-2 pt-2">{{ selectedAgent.name }} {{ t('agents.sessionsOf') }}</h3>
            
            <button @click="openCreateThreadModal" class="w-full py-2 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-300 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 border border-white/[0.05]">
              <Plus :size="14" /> {{ t('agents.newThread') }}
            </button>

            <div v-if="threads.length === 0" class="text-center text-xs text-slate-600 py-6">
              {{ t('agents.noThreads') }}            </div>

            <div class="space-y-1">
              <template v-for="thread in threads" :key="thread.id">
                <div 
                  @click="selectThread(thread)"
                  :class="['group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors mt-2', selectedThread?.id === thread.id ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300' : 'hover:bg-white/[0.05] text-slate-300 border border-transparent']"
                >
                  <span class="text-sm truncate pr-2">{{ thread.title || t('agents.newConversation') }}</span>
                  <Trash2 @click.stop="deleteThread(thread)" :size="12" class="opacity-0 group-hover:opacity-100 text-red-500/50 hover:text-red-400 transition-colors shrink-0" />
                </div>
                <div :class="['text-[10px] px-2', selectedThread?.id === thread.id ? 'text-amber-500/50' : 'text-slate-600']">{{ thread.messageCount || 0 }} {{ t('agents.messages') }} · {{ formatDate(thread.updatedAt) }}</div>
              </template>
            </div>
          </div>
        </template>

        <template v-if="chatViewTab === 'config'">
          <div class="p-2 space-y-5">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-full overflow-hidden shrink-0 border border-white/10 bg-black/20 text-white flex items-center justify-center">
                <img v-if="selectedAgent.avatar" :src="selectedAgent.avatar" class="w-full h-full object-cover"/>
                <BotIcon v-else :size="24" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-bold text-slate-100 flex items-center gap-2">{{ selectedAgent.name }}</h3>
                <span :class="['text-[10px] px-1.5 py-0.5 rounded border mt-1 font-bold inline-block', selectedAgent.permissionMode === 'full-auto' ? 'border-red-500/20 text-red-400 bg-red-500/10' : 'border-amber-500/20 text-amber-400 bg-amber-500/10']">
                  {{ getPermissionModeLabel(selectedAgent.permissionMode) }}
                </span>
              </div>
            </div>
            
            <button @click="openEditAgentModal" class="w-full py-2 bg-white/[0.03] hover:bg-amber-500/20 hover:text-amber-400 text-zinc-300 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 border border-white/[0.05]">
              <Edit3 :size="14" /> {{ t('agents.editConfig') }}
            </button>

            <div>
               <h4 class="text-xs text-slate-500 mb-2">{{ t('agents.systemPromptSummary') }}</h4>
               <p class="text-xs text-slate-400 bg-black/20 p-3 rounded-lg border border-white/5 line-clamp-4">{{ selectedAgent.systemPrompt || t('agents.noSystemPrompt') }}</p>
            </div>
            
            <div class="space-y-4 mt-6">
              <h4 class="text-xs font-bold text-slate-400 border-b border-white/5 pb-2">{{ t('agents.toolAccess') }}</h4>
              
              <!-- 独立的 GUI 操控容器，所有模式可见 -->
              <div class="bg-gradient-to-r from-red-500/10 to-orange-500/5 rounded-xl p-3 border border-red-500/20 shadow-inner mt-2 mb-4">
                <label class="flex items-center justify-between cursor-pointer group">
                  <div class="flex-1 pr-2">
                    <div class="flex items-center gap-2 mb-0.5">
                      <span class="text-[12px] font-mono font-bold text-slate-200">🖥️ {{ t('agents.guiControl') }}</span>
                      <span class="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold border border-red-500/30">Beta</span>
                    </div>
                    <div class="text-[9px] text-slate-500 leading-tight mt-1">{{ t('agents.guiControlDesc') }}</div>
                  </div>
                  <input type="checkbox" :checked="!!selectedAgent.toolsConfig?.gui_control" @change="selectedAgent.toolsConfig = { ...selectedAgent.toolsConfig, gui_control: !selectedAgent.toolsConfig?.gui_control }; updateAgentDirect(selectedAgent)" class="sr-only peer" />
                  <div class="relative w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-[16px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-red-500 shadow-inner">
                  </div>
                </label>
              </div>
              
              <div v-if="selectedAgent.permissionMode !== 'custom' && selectedAgent.permissionMode !== 'normal' && selectedAgent.permissionMode !== 'auto-edit'" class="bg-black/20 rounded-xl p-4 border border-white/5 flex flex-col items-center justify-center text-center gap-2">
                 <ShieldAlert class="text-slate-500" :size="24" />
                 <span class="text-xs text-slate-400 font-bold">{{ t('agents.presetManaged') }}</span>
                 <p class="text-[10px] text-slate-500 max-w-[200px]">{{ t('agents.presetManagedDesc') }}</p>
              </div>
              
              <!-- 普通模式和自动编辑模式的工具配置区域 -->
              <template v-else-if="selectedAgent.permissionMode === 'normal' || selectedAgent.permissionMode === 'auto-edit'">
                <div class="bg-black/20 rounded-xl p-3 border border-white/5 space-y-3">
                  <h4 class="text-[10px] font-bold text-slate-500">Files (文件操作)</h4>
                  <div class="grid grid-cols-1 gap-3">
                    <label class="flex items-start justify-between cursor-pointer group">
                      <div class="flex-1 pr-2">
                        <div class="text-[11px] font-bold text-slate-300 mb-0.5">读文件(read)</div>
                        <div class="text-[9px] text-slate-500 leading-tight">允许读取系统文件内容</div>
                      </div>
                      <input type="checkbox" :checked="true" disabled class="sr-only peer" />
                      <div class="relative w-7 h-4 bg-slate-700 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:translate-x-full peer-checked:bg-amber-500">
                      </div>
                    </label>
                    <label class="flex items-start justify-between cursor-pointer group">
                      <div class="flex-1 pr-2">
                        <div class="text-[11px] font-bold text-slate-300 mb-0.5">写文件(write)</div>
                        <div class="text-[9px] text-slate-500 leading-tight">允许创建或覆盖文件</div>
                      </div>
                      <input type="checkbox" :checked="selectedAgent.permissionMode === 'auto-edit'" disabled class="sr-only peer" />
                      <div class="relative w-7 h-4 bg-slate-700 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3" :class="{ 'after:translate-x-full peer-checked:bg-amber-500': selectedAgent.permissionMode === 'auto-edit' }">
                      </div>
                    </label>
                    <label class="flex items-start justify-between cursor-pointer group">
                      <div class="flex-1 pr-2">
                        <div class="text-[11px] font-bold text-slate-300 mb-0.5">精准编辑 (edit)</div>
                        <div class="text-[9px] text-slate-500 leading-tight">允许精准代码替换与编辑</div>
                      </div>
                      <input type="checkbox" :checked="selectedAgent.permissionMode === 'auto-edit'" disabled class="sr-only peer" />
                      <div class="relative w-7 h-4 bg-slate-700 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3" :class="{ 'after:translate-x-full peer-checked:bg-amber-500': selectedAgent.permissionMode === 'auto-edit' }">
                      </div>
                    </label>
                  </div>
                </div>
                <div class="bg-black/20 rounded-xl p-3 border border-white/5 space-y-3 mt-4">
                  <h4 class="text-[10px] font-bold text-slate-500">Web (网络与浏览)</h4>
                  <div class="grid grid-cols-1 gap-3">
                    <label class="flex items-start justify-between cursor-pointer group">
                      <div class="flex-1 pr-2">
                        <div class="text-[11px] font-bold text-slate-300 mb-0.5">网页读取 (web_fetch)</div>
                        <div class="text-[9px] text-slate-500 leading-tight">允许读取特定URL网页</div>
                      </div>
                      <input type="checkbox" checked disabled class="sr-only peer" />
                      <div class="relative w-7 h-4 bg-slate-700 rounded-full after:translate-x-full peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3">
                      </div>
                    </label>
                    <label class="flex items-start justify-between cursor-pointer group">
                      <div class="flex-1 pr-2">
                        <div class="text-[11px] font-bold text-slate-300 mb-0.5">网页操控 (browser)</div>
                        <div class="text-[9px] text-slate-500 leading-tight">允许无头浏览器点击和输入</div>
                      </div>
                      <input type="checkbox" :checked="selectedAgent.toolsConfig?.browser_open" disabled class="sr-only peer" />
                      <div class="relative w-7 h-4 bg-slate-700 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3" :class="{ 'after:translate-x-full peer-checked:bg-amber-500': selectedAgent.toolsConfig?.browser_open }">
                      </div>
                    </label>
                  </div>
                </div>
              </template>

              <!-- Files -->
              <div v-else class="bg-black/20 rounded-xl p-3 border border-white/5 space-y-3">
                <h4 class="text-[10px] font-bold text-slate-500">Files (文件操作)</h4>
                <div class="grid grid-cols-1 gap-3">
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">读文件(read)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">允许读取系统文件内容</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['read_file']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">写文件(write)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">允许创建或覆盖文件</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['write_file']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">精准编辑 (edit)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">允许精准代码替换与编辑</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['edit_file']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                </div>
              </div>
              <div v-if="selectedAgent.permissionMode === 'custom'" class="bg-black/20 rounded-xl p-3 border border-white/5 space-y-3">
                <h4 class="text-[10px] font-bold text-slate-500">Runtime (执行环境)</h4>
                <div class="grid grid-cols-1 gap-3">
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">命令行(exec)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">允许执行Shell终端命令</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['exec_cmd']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">进程管理 (process)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">允许管理后台长时间进程</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['manage_process']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                </div>
              </div>
              <div v-if="selectedAgent.permissionMode === 'custom'" class="bg-black/20 rounded-xl p-3 border border-white/5 space-y-3">
                <h4 class="text-[10px] font-bold text-slate-500">Web (网络与浏览)</h4>
                <div class="grid grid-cols-1 gap-3">
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">网络搜索 (web_search)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">使用搜索引擎检索信息</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['web_search']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">网页读取 (web_fetch)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">读取特定URL网页纯文本</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['web_fetch']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                  <label class="flex items-start justify-between cursor-pointer group">
                    <div class="flex-1 pr-2">
                      <div class="text-[11px] font-bold text-slate-300 mb-0.5">网页操控 (browser)</div>
                      <div class="text-[9px] text-slate-500 leading-tight">允许无头浏览器点击和输入</div>
                    </div>
                    <input type="checkbox" v-model="selectedAgent.toolsConfig!['browser_open']" @change="updateAgentDirect(selectedAgent)" class="sr-only peer" />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                  </div>
                </div>
              
              <!-- Skills -->
              <div v-if="selectedAgent.permissionMode === 'custom' || selectedAgent.permissionMode === 'normal' || selectedAgent.permissionMode === 'auto-edit'" class="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                <div class="flex items-center justify-between p-3 cursor-pointer" @click="showSkills = !showSkills">
                  <div class="flex items-center gap-2">
                    <ChevronDown v-if="showSkills || getSelectedSkillIds(selectedAgent).length <= 3" :size="12" class="text-slate-500" />
                    <ChevronRight v-else :size="12" class="text-slate-500" />
                    <h4 class="text-[10px] font-bold text-slate-500">Skills (技能)</h4>
                  </div>
                  <label class="flex items-center gap-1.5 cursor-pointer" @click.stop>
                    <span class="text-[10px] text-slate-500">全部启用</span>
                    <input
                      type="checkbox"
                      v-model="allSkillsEnabled"
                      @change="toggleAllSkills"
                      class="sr-only peer"
                    />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                </div>
                <!-- 搜索 + 添加 (移动到最前) -->
                <div class="px-3 pb-3 relative">
                  <input
                    type="text"
                    v-model="skillSearchQuery"
                    placeholder="搜索技能并添加..."
                    class="w-full bg-black/40 border border-[#fbbf24]/30 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/50 transition-all relative z-10 shadow-inner"
                  />
                  <!-- 弹出层提升 z-index，防止被覆盖 -->
                  <div v-if="skillSearchQuery && filteredSkills.length > 0" class="absolute left-3 right-3 top-full mt-1 z-20 bg-[#2a3040] border border-white/10 rounded-lg shadow-2xl max-h-48 overflow-y-auto custom-scrollbar">
                    <div
                      v-for="skill in filteredSkills"
                      :key="skill.id"
                      class="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 cursor-pointer group transition-colors border-b last:border-0 border-white/5"
                      @click="addSkillToAgent(selectedAgent, skill.id); skillSearchQuery = ''"
                    >
                      <div class="truncate pr-2">
                        <div class="text-[11px] font-bold text-slate-200">{{ skill.name }}</div>
                        <div class="text-[9px] text-slate-500 leading-tight truncate mt-0.5">{{ skill.description }}</div>
                      </div>
                      <Plus v-if="!getSelectedSkillIds(selectedAgent).includes(skill.id)" :size="14" class="text-slate-500 group-hover:text-amber-400 shrink-0 bg-black/20 rounded p-0.5" />
                      <span v-else class="text-[10px] text-emerald-400 font-bold shrink-0 bg-emerald-500/10 px-1.5 py-0.5 rounded">已添加</span>
                    </div>
                  </div>
                </div>
                <div v-if="getSelectedSkillIds(selectedAgent).length > 0" class="px-3 pb-3 space-y-2">
                  <div class="space-y-1.5 mb-2">
                    <!-- Always show first 3 -->
                    <div
                      v-for="sid in getSelectedSkillIds(selectedAgent).slice(0, 3)"
                      :key="sid"
                      class="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2 shadow-sm"
                    >
                      <span class="text-[11px] font-bold text-amber-300 truncate pr-2">
                        {{ skills.find(s => s.id === sid)?.name || sid }}
                      </span>
                      <button
                        @click.stop="removeSkillFromAgent(selectedAgent, sid)"
                        class="w-5 h-5 flex items-center justify-center rounded-md bg-red-500/10 hover:bg-red-500/30 text-red-400/70 hover:text-red-400 transition-colors shrink-0"
                        title="移除"
                      >
                        <Minus :size="12" />
                      </button>
                    </div>
                    
                    <!-- Collapsible remainder -->
                    <Transition name="collapse">
                      <div v-show="showSkills && getSelectedSkillIds(selectedAgent).length > 3" class="space-y-1.5">
                        <div
                          v-for="sid in getSelectedSkillIds(selectedAgent).slice(3)"
                          :key="sid"
                          class="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2 shadow-sm"
                        >
                          <span class="text-[11px] font-bold text-amber-300 truncate pr-2">
                            {{ skills.find(s => s.id === sid)?.name || sid }}
                          </span>
                          <button
                            @click.stop="removeSkillFromAgent(selectedAgent, sid)"
                            class="w-5 h-5 flex items-center justify-center rounded-md bg-red-500/10 hover:bg-red-500/30 text-red-400/70 hover:text-red-400 transition-colors shrink-0"
                            title="移除"
                          >
                            <Minus :size="12" />
                          </button>
                        </div>
                      </div>
                    </Transition>
                    
                    <!-- Expand/Collapse Toggle Button -->
                    <div v-if="getSelectedSkillIds(selectedAgent).length > 3" 
                         class="text-[11px] text-slate-500 text-center pt-2 cursor-pointer hover:text-amber-400 transition-colors" 
                         @click="showSkills = !showSkills">
                      {{ showSkills ? '收起列表' : `点击展开其余 ${getSelectedSkillIds(selectedAgent).length - 3} 项...` }}
                    </div>
                  </div>
                </div>
                <div v-else class="px-3 pb-3">
                  <div class="text-[10px] text-slate-500 italic text-center py-3 border border-dashed border-white/10 rounded-lg bg-black/10">未配置任何技能，请在上方搜索添加</div>
                </div>
              </div>

              <!-- MCP -->
              <div v-if="selectedAgent.permissionMode === 'custom' || selectedAgent.permissionMode === 'normal' || selectedAgent.permissionMode === 'auto-edit'" class="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                <div class="flex items-center justify-between p-3 cursor-pointer" @click="showMCP = !showMCP">
                  <div class="flex items-center gap-2">
                    <ChevronDown v-if="showMCP || getSelectedMCPIds(selectedAgent).length <= 3" :size="12" class="text-slate-500" />
                    <ChevronRight v-else :size="12" class="text-slate-500" />
                    <h4 class="text-[10px] font-bold text-slate-500">MCP (服务器)</h4>
                  </div>
                  <label class="flex items-center gap-1.5 cursor-pointer" @click.stop>
                    <span class="text-[10px] text-slate-500">全部启用</span>
                    <input
                      type="checkbox"
                      v-model="allMCPServersEnabled"
                      @change="toggleAllMCPServers"
                      class="sr-only peer"
                    />
                    <div class="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500">
                    </div>
                  </label>
                </div>
                <!-- 搜索 + 添加 -->
                <div class="px-3 pb-3 relative">
                  <input
                    type="text"
                    v-model="mcpSearchQuery"
                    placeholder="搜索MCP并添加..."
                    class="w-full bg-black/40 border border-blue-500/30 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/50 transition-all relative z-10 shadow-inner"
                  />
                  <!-- 弹出层 -->
                  <div v-if="mcpSearchQuery && filteredMCPServers.length > 0" class="absolute left-3 right-3 bottom-full mb-1 z-20 bg-[#2a3040] border border-white/10 rounded-lg shadow-2xl max-h-48 overflow-y-auto custom-scrollbar">
                    <div
                      v-for="server in filteredMCPServers"
                      :key="server.id"
                      class="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 cursor-pointer group transition-colors border-b last:border-0 border-white/5"
                      @click="addMCPToAgent(selectedAgent, server.id); mcpSearchQuery = ''"
                    >
                      <div class="truncate pr-2">
                        <div class="text-[11px] font-bold text-slate-200">{{ server.name }}</div>
                        <div class="text-[9px] text-slate-500 leading-tight truncate mt-0.5">{{ server.description }}</div>
                      </div>
                      <Plus v-if="!getSelectedMCPIds(selectedAgent).includes(server.id)" :size="14" class="text-slate-500 group-hover:text-blue-400 shrink-0 bg-black/20 rounded p-0.5" />
                      <span v-else class="text-[10px] text-emerald-400 font-bold shrink-0 bg-emerald-500/10 px-1.5 py-0.5 rounded">已添加</span>
                    </div>
                  </div>
                </div>
                <div v-if="getSelectedMCPIds(selectedAgent).length > 0" class="px-3 pb-3 space-y-2">
                  <div class="space-y-1.5 mb-2">
                    <div
                      v-for="mid in getSelectedMCPIds(selectedAgent).slice(0, 3)"
                      :key="mid"
                      class="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-2 shadow-sm"
                    >
                      <span class="text-[11px] font-bold text-blue-300 truncate pr-2">
                        {{ mcpServers.find(s => s.id === mid)?.name || mid }}
                      </span>
                      <button
                        @click.stop="removeMCPFromAgent(selectedAgent, mid)"
                        class="w-5 h-5 flex items-center justify-center rounded-md bg-red-500/10 hover:bg-red-500/30 text-red-400/70 hover:text-red-400 transition-colors shrink-0"
                        title="移除"
                      >
                        <Minus :size="12" />
                      </button>
                    </div>
                    
                    <Transition name="collapse">
                      <div v-show="showMCP && getSelectedMCPIds(selectedAgent).length > 3" class="space-y-1.5">
                        <div
                          v-for="mid in getSelectedMCPIds(selectedAgent).slice(3)"
                          :key="mid"
                          class="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-2 shadow-sm"
                        >
                          <span class="text-[11px] font-bold text-blue-300 truncate pr-2">
                            {{ mcpServers.find(s => s.id === mid)?.name || mid }}
                          </span>
                          <button
                            @click.stop="removeMCPFromAgent(selectedAgent, mid)"
                            class="w-5 h-5 flex items-center justify-center rounded-md bg-red-500/10 hover:bg-red-500/30 text-red-400/70 hover:text-red-400 transition-colors shrink-0"
                            title="移除"
                          >
                            <Minus :size="12" />
                          </button>
                        </div>
                      </div>
                    </Transition>
                    
                    <div v-if="getSelectedMCPIds(selectedAgent).length > 3" 
                         class="text-[11px] text-slate-500 text-center pt-2 cursor-pointer hover:text-blue-400 transition-colors" 
                         @click="showMCP = !showMCP">
                      {{ showMCP ? '收起列表' : `点击展开其余 ${getSelectedMCPIds(selectedAgent).length - 3} 项...` }}
                    </div>
                  </div>
                </div>
                <div v-else class="px-3 pb-3">
                  <div class="text-[10px] text-slate-500 italic text-center py-3 border border-dashed border-white/10 rounded-lg bg-black/10">未配置任何MCP服务器，请在上方搜索添加</div>
                </div>
              </div>
            </div>
            
            <button @click="deleteAgent(selectedAgent)" class="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-red-500/20 mt-6 mt-4">
              <Trash2 :size="14" /> {{ t('agents.deleteThisAgent') }}</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 右侧：主聊天窗口 -->
    <div v-if="selectedAgent" class="flex-1 bg-[#1e2330] rounded-[2rem] border border-white/[0.05] flex flex-col shadow-2xl overflow-hidden relative">
      <!-- 聊天头部 -->
      <div class="h-16 shrink-0 flex items-center justify-between px-6 border-b border-white/[0.05] bg-black/20">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-amber-400 to-yellow-500 shadow-lg text-black">
            <img v-if="selectedAgent.avatar" :src="selectedAgent.avatar" class="w-full h-full object-cover rounded-lg" />
            <BotIcon v-else :size="18" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-white text-md block leading-tight">{{ selectedAgent.name }}</span>
              <span v-if="agentWorkingStore.isAgentWorking(selectedAgent.id)" class="working-badge scale-75 origin-left">{{ t('agents.working') }}</span>
            </div>
            <div v-if="agentWorkingStore.isAgentWorking(selectedAgent.id)" class="text-[10px] text-amber-400 font-bold flex items-center gap-1.5 mt-0.5 animate-pulse">
               <span class="w-1 h-1 rounded-full bg-amber-400"></span>
               {{ t('agents.thinkingStatus') }}
            </div>
            <span v-else-if="selectedThread" class="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-slate-400 max-w-48 truncate inline-block mt-0.5">{{ selectedThread.title || t('agents.newConversation') }}</span>
          </div>
        </div>
        
        <div class="flex gap-3">
            <CustomSelect
              :modelValue="selectedConfigId"
              :options="modelConfigOptions"
              :placeholder="t('agents.selectModelConfig')"
              class="max-w-[200px]"
              @update:modelValue="(val: string | number) => { selectedConfigId = String(val); updateAgentModelConfig(String(val)); }"
            />
        </div>
      </div>

      <!-- 聊天内容区-->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar w-full flex flex-col relative">
        <div v-if="messages.length === 0" class="flex-1 flex flex-col items-center justify-center text-center opacity-70 animate-in fade-in zoom-in duration-500">
           <div class="w-24 h-24 rounded-full flex items-center justify-center mb-6 bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border border-amber-500/30 text-amber-400 shadow-[0_0_40px_rgba(251,191,36,0.2)]">
              <BotIcon :size="48" />
            </div>
            <h2 class="text-2xl font-bold text-white mb-3">{{ selectedAgent.name }}</h2>
            <div class="px-3 py-1 mb-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-inner">
              <Sparkles :size="12" /> {{ t('agents.aiPowered') }}
            </div>
            <p class="text-slate-400 text-sm max-w-sm leading-relaxed">{{ defaultSystemPrompt }}</p>
        </div>

        <template v-else>
           <div v-for="(message, mIndex) in messages" :key="message.id" :class="['w-full flex group relative', message.role === 'user' ? 'justify-end' : 'justify-start']">
              <div :class="['max-w-[85%] lg:max-w-[70%] rounded-2xl p-4 sm:p-5 text-sm leading-relaxed shadow-sm relative', message.role === 'user' ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 text-zinc-100 rounded-bl-2xl rounded-tr-sm' : 'bg-white/[0.03] border border-white/[0.05] text-slate-200 rounded-bl-sm']">
                
                <div class="flex items-center justify-between mb-2">
                   <div class="flex items-center gap-2">
                     <span v-if="message.role === 'assistant'" class="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 text-black flex items-center justify-center"><BotIcon :size="12" /></span>
                     <span v-else class="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center"><User :size="12" /></span>
                     <span class="font-bold text-xs opacity-75">{{ message.role === 'user' ? t('agents.me') : selectedAgent.name }}</span>
                   </div>
                   <span class="text-[10px] opacity-40 font-mono">{{ formatTime(message.timestamp) }}</span>
                </div>

                <div v-if="message.loading && !message.content" class="flex flex-col gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl backdrop-blur-md shadow-xl border-beam-active">
                  <div class="flex items-center gap-3 text-amber-400 font-bold">
                    <div class="dot-animation large h-5">
                      <span></span><span></span><span></span>
                    </div>
                    <span class="text-sm tracking-widest uppercase">{{ message.statusDetail || t('agents.deepThinking') }}</span>
                  </div>
                  <div class="w-full bg-white/5 h-1.5 rounded-full overflow-hidden shadow-inner">
                    <div class="h-full bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500 animate-glow-pulse w-[75%] rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]"></div>
                  </div>
                </div>
                <template v-else>
                  <!-- Attachments -->
                  <div v-if="message.attachments && message.attachments.length > 0" class="mb-3 flex flex-wrap gap-2">
                    <template v-for="(att, aIdx) in message.attachments" :key="aIdx">
                      <img v-if="isImageType(att.type)" :src="att.dataUrl" :alt="att.name" @click="previewImage = att.dataUrl" class="max-w-xs max-h-60 rounded-xl border border-white/10 cursor-pointer hover:opacity-90 transition-opacity" />
                      <video v-else-if="isVideoType(att.type)" :src="att.dataUrl" controls class="max-w-xs max-h-60 rounded-xl border border-white/10" />
                      <audio v-else-if="isAudioType(att.type)" :src="att.dataUrl" controls class="w-full" />
                      <a v-else :href="att.dataUrl" :download="att.name" target="_blank" class="flex items-center gap-2 bg-white/5 border border-white/10 hover:border-amber-500/50 hover:bg-white/10 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer group">
                        <Paperclip :size="14" class="text-amber-400 group-hover:scale-110 transition-transform" />
                        <span class="text-slate-300 group-hover:text-white underline-offset-2 group-hover:underline">{{ att.name }}</span>
                      </a>
                    </template>
                  </div>
                  <div class="prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5 prose-pre:p-4 max-w-none prose-sm" v-html="renderMarkdown(message.content)"></div>
                  <div v-if="message.loading && message.content" class="mt-3 text-amber-400 flex items-center gap-3 bg-amber-500/5 px-3 py-1.5 rounded-lg border border-amber-500/10 w-fit">
                     <div class="dot-animation">
                       <span></span><span></span><span></span>
                     </div>
                     <span class="text-[11px] font-bold tracking-tight">{{ message.statusDetail || t('agents.generating') }}</span>
                  </div>
                </template>
              
                <!-- 消息悬浮菜单 -->
                <div :class="['absolute -bottom-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-[#1e2330] border border-white/10 rounded-lg p-1 shadow-xl z-20', message.role === 'user' ? 'right-0' : 'left-0']">
                  
                  <button @click="copyMessage(message)" class="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-white/5 rounded transition-colors" title="快速复制">
                    <Copy :size="12" />
                  </button>
                  <button @click="replyMessage(message)" class="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-white/5 rounded transition-colors" title="回复">
                    <MessageSquare :size="12" />
                  </button>

                  <template v-if="message.role === 'user'">
                    <button @click="editMessage(mIndex)" class="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-white/5 rounded transition-colors" title="编辑消息 (撤回并编辑)">
                      <Edit3 :size="12" />
                    </button>
                    <button @click="recallMessage(mIndex)" class="p-1.5 text-slate-400 hover:text-orange-400 hover:bg-white/5 rounded transition-colors" title="撤回 (清除此节点及之后的记忆)">
                      <Undo2 :size="12" />
                    </button>
                  </template>

                  <template v-if="message.role === 'assistant'">
                    <button @click="regenerateMessage(mIndex)" class="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded transition-colors" title="重新回复">
                      <RotateCcw :size="12" />
                    </button>
                  </template>

                  <button @click="deleteMessageFromUI(mIndex)" class="p-1.5 text-slate-400 hover:text-red-400 hover:bg-white/5 rounded transition-colors" title="仅删除界面显示(保留被agent记住的信息)">
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
           </div>
        </template>
      </div>

      <!-- 文件预览区-->
      <div v-if="uploadedFiles.length > 0" class="absolute bottom-20 left-0 w-full px-6 flex flex-wrap gap-2 pointer-events-none">
         <div v-for="(file, index) in uploadedFiles" :key="index" class="pointer-events-auto flex items-center gap-2 bg-[#1e2330] border border-white/10 px-3 py-1.5 rounded-lg text-xs shadow-lg backdrop-blur-md">
            <span class="text-amber-400"><Paperclip :size="12" /></span>
            <span class="truncate max-w-32 text-slate-300 font-medium">{{ file.name }}</span>
            <button type="button" class="text-slate-500 hover:text-red-400 transition-colors ml-1" @click="uploadedFiles.splice(index, 1)">
              <X :size="14"/>
            </button>
         </div>
      </div>

      <!-- 底部输入框-->
      <div class="p-4 bg-black/20 border-t border-white/[0.05] shrink-0 z-10">
        <div class="max-w-4xl mx-auto flex items-end gap-3 bg-[#0f1219]/80 backdrop-blur-sm border border-white/[0.05] rounded-[1.5rem] p-2 pb-[9px] shadow-inner focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/50 transition-all">
          <button @click="fileInput?.click()" class="p-2.5 text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-xl transition-all relative">
            <Paperclip :size="20" />
            <input ref="fileInput" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.pptx,.ppt" class="hidden" @change="(e) => uploadedFiles.push(...Array.from((e.target as HTMLInputElement).files || []))" />
          </button>
          
          <div class="relative group">
            <button @click="showKBSelector = !showKBSelector" :class="['p-2.5 rounded-xl transition-all relative', (selectedKnowledgeBases.length > 0 || useHistory || selectedHistoryThreads.length > 0) ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10']">
              <BookOpen :size="20" />
              <span v-if="selectedKnowledgeBases.length > 0" class="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500"></span>
            </button>

            <!-- KB Selector Dropdown -->
            <div v-if="showKBSelector" class="absolute bottom-full mb-3 left-0 w-64 bg-[#1e2330] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden transform origin-bottom-left transition-all backdrop-blur-xl">
               <!-- 历史话题板块 -->
               <div class="border-b border-white/5 bg-black/20">
                 <div class="p-3 text-xs font-bold text-slate-300 flex items-center justify-between">
                   <span class="flex items-center gap-1.5"><BotIcon :size="14" class="text-amber-400" /> 上下文关联记忆</span>
                   <label class="flex items-center gap-1.5 cursor-pointer">
                     <span class="text-slate-500">全部</span>
                     <input type="checkbox" v-model="useHistory" class="rounded border-white/20 bg-black/40 text-amber-500" />
                   </label>
                 </div>
                 <div class="max-h-32 overflow-auto px-1.5 pb-2 custom-scrollbar">
                   <label v-for="thread in allThreads" :key="thread.id" class="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer text-xs transition-colors group">
                     <input type="checkbox" :value="thread.id" v-model="selectedHistoryThreads" class="rounded border-white/20 bg-black/40 text-amber-500" />
                     <span class="truncate flex-1 text-slate-400 group-hover:text-slate-300">{{ thread.agentName }}: {{ thread.title }}</span>
                   </label>
                   <div v-if="allThreads.length === 0" class="text-slate-600 text-[10px] p-2 text-center">无</div>
                 </div>
               </div>
               <!-- 知识库板块-->
               <div class="bg-black/10">
                 <div class="p-3 text-xs font-bold text-slate-300 flex items-center gap-1.5">
                   <BookOpen :size="14" class="text-amber-400" /> 外挂知识库(RAG)
                 </div>
                 <div class="max-h-40 overflow-auto px-1.5 pb-2 custom-scrollbar">
                   <div v-if="knowledgeBases.length === 0" class="text-slate-600 text-[10px] p-2 text-center">暂无可用的知识文档库</div>
                   <label v-for="kb in knowledgeBases" :key="kb.id" class="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer text-xs transition-colors group">
                     <input type="checkbox" :value="kb.id" v-model="selectedKnowledgeBases" class="rounded border-white/20 bg-black/40 text-amber-500" />
                     <span class="font-medium text-slate-400 group-hover:text-slate-300">{{ kb.name }}</span>
                   </label>
                 </div>
               </div>
            </div>
          </div>

          <textarea 
            v-model="inputMessage"
            @keydown.enter.exact.prevent="sendMessage"
            @paste="handlePaste"
            :placeholder="t('agents.inputPlaceholder')" 
            class="flex-1 bg-transparent border-none outline-none resize-none pt-3 px-2 text-slate-200 placeholder-slate-600 text-sm max-h-32 min-h-11 custom-scrollbar"
            rows="1"
          ></textarea>
          
          <button 
            v-if="!selectedAgent || !agentWorkingStore.isAgentWorking(selectedAgent.id)"
            @click="sendMessage"
            :disabled="(!inputMessage.trim() && uploadedFiles.length === 0) || (selectedAgent && agentWorkingStore.isAgentWorking(selectedAgent.id))"
            class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:bg-slate-700 disabled:text-zinc-500 disabled:shadow-none text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20 self-center tracking-wide"
          >
            {{ t('agents.send') }}
          </button>
          
          <button 
            v-if="selectedAgent && agentWorkingStore.isAgentWorking(selectedAgent.id)"
            @click="stopMessage"
            class="px-5 py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:bg-slate-700 disabled:text-zinc-500 disabled:shadow-none text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-red-500/20 self-center tracking-wide"
          >
            STOP
          </button>
        </div>
      </div>
    </div>

    <!-- 未选择Agent的默认占位-->
    <div v-else class="flex-1 bg-[#1e2330] rounded-[2rem] border border-white/[0.05] flex flex-col items-center justify-center shadow-2xl relative">
       <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02]">
         <BotIcon :size="300" />
       </div>
       <div class="w-24 h-24 rounded-full bg-slate-800/50 border border-white/5 flex items-center justify-center mb-6 shadow-inner text-slate-600">
         <BotIcon :size="48" />
       </div>
       <h2 class="text-2xl font-bold mb-3 text-slate-200 tracking-wide">{{ t('agents.welcomeWorkspace') }}</h2>
       <p class="text-sm text-slate-500 max-w-xs text-center leading-relaxed">{{ t('agents.welcomeDesc') }}</p>
    </div>

    <!-- HITL Approval Modal -->
    <div v-if="pendingSkillApproval" class="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4">
      <div class="bg-[#1e2330] rounded-2xl p-6 lg:p-8 max-w-md w-full border border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.2)] flex flex-col">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle :size="24" class="text-red-500" />
          </div>
          <div>
            <h2 class="text-xl font-bold text-white">{{ t('agents.hitlTitle') }}</h2>
            <p class="text-red-400 text-sm mt-1">{{ t('agents.hitlDesc') }}</p>
          </div>
        </div>
        
        <div class="bg-black/40 rounded-xl p-4 border border-white/5 mb-6 custom-scrollbar overflow-y-auto max-h-48 text-sm">
          <div class="mb-2"><span class="text-slate-400">{{ t('agents.callSignature') }}</span> <span class="text-white font-mono break-all">{{ pendingSkillApproval.skillName }}.{{ pendingSkillApproval.actionName }}</span></div>
          <div><span class="text-slate-400">{{ t('agents.execParams') }}</span></div>
          <pre class="text-amber-400 font-mono mt-1 whitespace-pre-wrap break-all">{{ JSON.stringify(pendingSkillApproval.parameters, null, 2) }}</pre>
        </div>

        <p class="text-slate-400 text-sm mb-6 leading-relaxed">{{ t('agents.hitlWarning') }}</p>
        
        <div class="flex gap-4">
          <button @click="resolveSkillApproval(false)" class="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl font-bold transition-all relative overflow-hidden group">
            <span class="relative z-10 flex items-center justify-center gap-2"><X :size="18"/> {{ t('agents.deny') }}</span>
          </button>
          <button @click="resolveSkillApproval(true)" class="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all flex items-center justify-center gap-2">
            <Check :size="18"/> {{ t('agents.allow') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Agent Modal (创建/编辑) -->
    <div v-if="showAgentModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" @click.self="showAgentModal = false">
      <div class="bg-[#1e2330] rounded-2xl p-6 lg:p-8 max-w-lg w-full border border-white/10 shadow-2xl flex flex-col max-h-[90vh]">
        <div class="flex items-center justify-between mb-6 shrink-0">
          <h2 class="text-lg font-bold text-white tracking-wide">{{ isEditing ? t('agents.configAgent') : t('agents.createNewAgent') }}</h2>
           <button @click="showAgentModal = false" class="text-zinc-500 hover:text-white transition-colors"><X :size="20"/></button>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-2">
          
          <div v-if="!isEditing" class="bg-black/20 rounded-xl p-4 border border-white/5 shrink-0">
            <label class="block text-xs font-bold text-amber-400 mb-3 flex items-center gap-1.5"><Sparkles :size="14" /> {{ t('agents.quickTemplate') }}</label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button 
                v-for="tpl in agentTemplates" 
                :key="tpl.name" 
                @click="applyTemplate(tpl)"
                class="text-left px-3 py-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-amber-500/10 hover:border-amber-500/40 transition-all group flex flex-col justify-start"
              >
                <div class="font-bold text-slate-200 text-sm group-hover:text-amber-400 transition-colors">{{ tpl.name }}</div>
                <div class="text-[10px] text-slate-500 mt-1 line-clamp-2 leading-tight">{{ tpl.systemPrompt }}</div>
              </button>
            </div>
          </div>

          <div class="flex justify-center">
            <div class="relative group cursor-pointer">
              <div class="w-24 h-24 rounded-full bg-black/40 border-2 border-dashed border-white/20 flex flex-col items-center justify-center overflow-hidden transition-all group-hover:border-amber-500/50 group-hover:bg-amber-500/10">
                <img v-if="editingAgent.avatar" :src="editingAgent.avatar" class="w-full h-full object-cover" />
                <div v-else class="text-slate-500 flex flex-col items-center">
                  <BotIcon :size="24" class="mb-1" />
                  <span class="text-[10px]">{{ t('agents.uploadAvatar') }}</span>
                </div>
              </div>
              <input type="file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer" @change="handleAvatarUpload" />
            </div>
          </div>
          
          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('agents.agentName') }}</label>
            <input v-model="editingAgent.name" type="text" class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600" :placeholder="t('agents.agentNamePlaceholder')">
          </div>

          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('agents.permissionSetup') }}</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- 普通模式-->
              <label 
                :class="['flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all', editingAgent.permissionMode === 'normal' ? 'border-amber-500/40 bg-amber-500/10 shadow-inner' : 'border-white/5 bg-black/20 hover:border-white/10']"
              >
                <input type="radio" value="normal" v-model="editingAgent.permissionMode" class="hidden" />
                <div class="flex-1">
                  <div :class="['font-bold text-sm mb-1', editingAgent.permissionMode === 'normal' ? 'text-amber-400' : 'text-slate-300']">{{ t('agents.normalMode') }}</div>
                  <div class="text-[10px] text-slate-500 leading-tight">{{ t('agents.normalModeDesc') }}</div>
                </div>
              </label>

              <!-- 自动编辑 -->
              <label 
                :class="['flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all', editingAgent.permissionMode === 'auto-edit' ? 'border-amber-500/40 bg-amber-500/10 shadow-inner' : 'border-white/5 bg-black/20 hover:border-white/10']"
              >
                <input type="radio" value="auto-edit" v-model="editingAgent.permissionMode" class="hidden" />
                <div class="flex-1">
                  <div :class="['font-bold text-sm mb-1', editingAgent.permissionMode === 'auto-edit' ? 'text-amber-400' : 'text-slate-300']">{{ t('agents.autoEditMode') }}</div>
                  <div class="text-[10px] text-slate-500 leading-tight">{{ t('agents.autoEditModeDesc') }}</div>
                </div>
              </label>

              <!-- 全自动(危险) -->
              <label 
                :class="['flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all', editingAgent.permissionMode === 'full-auto' ? 'border-rose-500/40 bg-rose-500/10 shadow-inner' : 'border-white/5 bg-black/20 hover:border-white/10']"
              >
                <input type="radio" value="full-auto" v-model="editingAgent.permissionMode" class="hidden" />
                <div class="flex-1">
                  <div :class="['font-bold text-sm mb-1', editingAgent.permissionMode === 'full-auto' ? 'text-rose-400' : 'text-slate-300']">{{ t('agents.fullAutoMode') }}</div>
                  <div class="text-[10px] text-slate-500 leading-tight">{{ t('agents.fullAutoModeDesc') }}</div>
                </div>
              </label>

              <!-- 自由规划 -->
              <label 
                :class="['flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all', editingAgent.permissionMode === 'custom' ? 'border-indigo-500/40 bg-indigo-500/10 shadow-inner' : 'border-white/5 bg-black/20 hover:border-white/10']"
              >
                <input type="radio" value="custom" v-model="editingAgent.permissionMode" class="hidden" />
                <div class="flex-1">
                  <div :class="['font-bold text-sm mb-1', editingAgent.permissionMode === 'custom' ? 'text-indigo-400' : 'text-slate-300']">{{ t('agents.customMode') }}</div>
                  <div class="text-[10px] text-slate-500 leading-tight">{{ t('agents.customModeDesc') }}</div>
                </div>
              </label>
            </div>
          </div>
          
          <div class="space-y-3">
            <div class="flex items-center justify-between bg-black/40 border border-amber-500/20 rounded-xl px-4 py-3">
              <div>
                <div class="font-bold text-sm text-amber-400 mb-0.5"><ShieldAlert class="w-3 h-3 inline-block -mt-0.5 mr-1"/>软沙箱保护 (Logic Sandbox)</div>
                <div class="text-[10px] text-zinc-500">开启后限制AI仅操作限制路径内的文件，执行外端命令必须人工授权（HITL）。</div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" v-model="editingAgent.sandboxEnabled" class="sr-only peer">
                <div class="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>

            <div class="flex items-center justify-between bg-black/40 border border-emerald-500/20 rounded-xl px-4 py-3">
              <div class="pr-2">
                <div class="font-bold text-sm text-emerald-400 mb-0.5"><ShieldAlert class="w-3 h-3 inline-block -mt-0.5 mr-1"/>硬沙箱保护 (Docker Sandbox)</div>
                <div class="text-[10px] text-zinc-500 leading-tight">【最高安全级别】当 AI 执行终端命令时，将其关入一个纯净的虚拟容器（Docker）中运行。容器状态将保留至对话结束。此功能要求宿主机已安装 Docker Desktop。</div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer shrink-0">
                <input type="checkbox" v-model="editingAgent.hardSandboxEnabled" class="sr-only peer">
                <div class="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          </div>
          
          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('agents.systemPromptLabel') }}</label>
            <textarea v-model="editingAgent.systemPrompt" class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-3 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600 resize-none h-32 custom-scrollbar" :placeholder="t('agents.systemPromptPlaceholder')"></textarea>
          </div>
        </div>

        <div class="flex justify-between gap-4 pt-6 mt-2 border-t border-white/5 shrink-0">
          <button class="flex-1 py-2.5 bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-sm font-bold transition-colors border border-white/[0.05]" @click="showAgentModal = false">{{ t('agents.cancelDiscard') }}</button>
          <button class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-sm font-bold transition-colors shadow-lg shadow-amber-500/20" @click="handleSaveAgent">{{ t('agents.applySave') }}</button>
        </div>
      </div>
    </div>

    <!-- Thread Modal -->
    <div v-if="showThreadModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" @click.self="showThreadModal = false">
      <div class="bg-[#1e2330] rounded-2xl p-6 lg:p-8 max-w-sm w-full border border-white/10 shadow-2xl">
        <div class="flex items-center justify-between mb-6">
           <h2 class="text-lg font-bold text-white">{{ t('agents.newThreadBranch') }}</h2>
           <button @click="showThreadModal = false" class="text-zinc-500 hover:text-white transition-colors"><X :size="20"/></button>
        </div>
        <div class="space-y-4">
          <div>
            <label class="block text-xs text-zinc-500 mb-1.5 ml-1">{{ t('agents.threadTitle') }}</label>
            <input v-model="newThreadTitle" @keydown.enter="createThread" type="text" class="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600 cursor-text" :placeholder="t('agents.threadTitlePlaceholder')" />
          </div>
          <div class="flex justify-end pt-4">
            <button class="w-full relative py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-sm font-bold transition-colors shadow-lg shadow-amber-500/20 box-border overflow-hidden group" @click="createThread">
              <span class="relative z-10 flex items-center justify-center gap-2"><Sparkles :size="14" /> {{ t('agents.startThread') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Smart Create Modal -->
    <div v-if="showSmartCreateModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="bg-[#1a1c23] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
          <h3 class="text-xl font-bold text-white flex items-center gap-2"><Sparkles class="text-amber-500"/> {{ t('agents.smartCreateTitle') }}</h3>
          <button @click="showSmartCreateModal = false" class="text-slate-400 hover:text-white transition-colors">
            <X class="w-6 h-6" />
          </button>
        </div>
        
        <div class="p-6 overflow-y-auto flex-1 flex flex-col gap-5">
           <div class="text-sm text-slate-400">
              描述您想要完成的工作或想要组建的团队。AI主管将自动为您规划分配不同角色的Agent。对于复杂任务，还会自动将它们组队进办公室。           </div>
           
           <div>
            <label class="block text-sm font-medium text-slate-300 mb-2">{{ t('agents.yourRequirement') }}</label>
            <textarea
              v-model="smartCreatePrompt"
              :placeholder="t('agents.smartCreatePlaceholder')"
              class="w-full h-32 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 resize-none custom-scrollbar"
            ></textarea>
           </div>
           
           <div>
            <label class="block text-sm font-medium text-slate-300 mb-2">{{ t('agents.useModel') }}</label>
            <CustomSelect
              v-model="smartCreateSelectedConfigId"
              :options="modelConfigOptions"
              :placeholder="t('agents.selectModelConfig')"
              @update:modelValue="(val: string | number) => saveSmartCreateConfig(String(val))"
            />
           </div>
        </div>
        
        <div class="p-4 border-t border-white/10 flex justify-end gap-3 bg-black/20">
          <button @click="showSmartCreateModal = false" :disabled="smartCreateLoading" class="px-5 py-2 rounded-xl text-sm font-bold text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-50">
            {{ t('common.cancel') }}
          </button>
          <button @click="handleSmartCreate" :disabled="smartCreateLoading || !smartCreatePrompt.trim()" class="px-5 py-2 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2">
            <Sparkles v-if="!smartCreateLoading" class="w-4 h-4"/>
            <svg v-else class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ smartCreateLoading ? t('agents.analyzing') : t('agents.submitCreate') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Image Preview Modal -->
    <div v-if="previewImage" class="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[300]" @click="previewImage = null">
      <button @click="previewImage = null" class="absolute top-6 right-6 text-white hover:text-red-400 transition-colors bg-white/10 rounded-full p-2">
        <X :size="24" />
      </button>
      <img :src="previewImage" class="max-w-[95vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" @click.stop />
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }

.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}

/* Tool step collapsible details styling */
:deep(details) {
  margin: 0.5rem 0;
  border: 1px solid rgba(245, 158, 11, 0.15);
  border-radius: 0.75rem;
  background: rgba(245, 158, 11, 0.03);
  overflow: hidden;
  transition: all 0.2s ease;
}

:deep(details[open]) {
  background: rgba(245, 158, 11, 0.05);
  border-color: rgba(245, 158, 11, 0.25);
}

:deep(details summary) {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  color: rgb(251, 191, 36);
  user-select: none;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  list-style: none;
  transition: background 0.15s ease;
}

:deep(details summary:hover) {
  background: rgba(245, 158, 11, 0.08);
}

:deep(details summary::marker),
:deep(details summary::-webkit-details-marker) {
  display: none;
}

:deep(details summary::before) {
  content: '▶';
  font-size: 0.6rem;
  transition: transform 0.2s ease;
  display: inline-block;
}

:deep(details[open] summary::before) {
  transform: rotate(90deg);
}

:deep(details > pre),
:deep(details > p > code),
:deep(details > :not(summary)) {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  max-height: 300px;
  overflow-y: auto;
}

:deep(details code) {
  font-size: 0.72rem !important;
  color: rgb(203, 213, 225);
}
</style>
