import { ref, computed, nextTick, onMounted, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { useAgentWorkingStore } from '../stores/agent-working';
import { fetchSSE } from '../utils/stream';

interface Agent {
  id: string;
  name: string;
  avatar?: string;
  systemPrompt: string;
  defaultModel?: string;
  sandboxEnabled?: boolean;
  hardSandboxEnabled?: boolean;
  permissionMode?: 'normal' | 'auto-edit' | 'full-auto' | 'custom';
  toolsConfig?: Record<string, any>;
  channelsConfig?: string[];
  knowledgeBaseIds?: string[];
  createdAt: number;
  updatedAt: number;
}
interface Thread {
  id: string;
  agentId: string;
  title: string;
  messages: Array<any>;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}
interface ToolStep {
  name: string;
  result: string;
  timestamp: number;
}
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  loading?: boolean;
  statusDetail?: string;
  attachments?: Array<{ name: string; type: string; dataUrl: string }>;
  toolSteps?: ToolStep[];
}
interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}
interface MCPServer {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export function useAgentWorkspace() {




  const agents = ref<Agent[]>([]);
  const threads = ref<Thread[]>([]);
  const selectedAgent = ref<Agent | null>(null);
  const selectedThread = ref<Thread | null>(null);

  const route = useRoute();
  const router = useRouter();
  const agentWorkingStore = useAgentWorkingStore();

  const chatViewTab = ref<'threads' | 'config'>((route.query.tab as any) || 'threads');

  watch(chatViewTab, (val) => {
    router.replace({ query: { ...route.query, tab: val } }).catch(() => { });
  });

  // Chat state
  const messages = ref<Message[]>([]);
  const inputMessage = ref('');
  const isLoading = ref(false);
  const abortController = ref<AbortController | null>(null);
  const messagesContainer = ref<HTMLElement | null>(null);
  const selectedConfigId = ref<string>('');
  const modelConfigs = ref<Array<{ id: string; name: string; model: string; enabled: boolean }>>([]);

  // HITL Approval state
  const pendingSkillApproval = ref<{
    executionId: string;
    skillName: string;
    actionName: string;
    parameters: Record<string, any>;
    agentName: string;
  } | null>(null);

  async function resolveSkillApproval(approved: boolean) {
    if (!pendingSkillApproval.value) return;
    try {
      await fetch('/api/skills/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionId: pendingSkillApproval.value.executionId,
          approved
        })
      });
      if (!approved) {
        isLoading.value = false;
        if (selectedAgent.value) {
          agentWorkingStore.setAgentWorking(selectedAgent.value.id, false);
        }
      }
    } catch (e) {
      console.error('Failed to resolve skill approval', e);
    } finally {
      pendingSkillApproval.value = null;
    }
  }

  // File upload
  const uploadedFiles = ref<File[]>([]);
  const fileInput = ref<HTMLInputElement | null>(null);

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const newFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) newFiles.push(file);
      }
    }
    if (newFiles.length > 0) {
      uploadedFiles.value.push(...newFiles);
    }
  }

  // Knowledge base association
  const knowledgeBases = ref<Array<{ id: string; name: string }>>([]);
  const selectedKnowledgeBases = ref<string[]>([]);
  const showKBSelector = ref(false);

  // History threads association
  const allThreads = ref<Array<{ id: string; agentId: string; agentName: string; title: string }>>([]);
  const selectedHistoryThreads = ref<string[]>([]);
  const useHistory = ref(true);

  // WebSocket 连接
  const ws = ref<WebSocket | null>(null);

  function initWebSocket() {
    const isFileProtocol = window.location.protocol === 'file:';
    const wsProtocol = isFileProtocol ? 'ws:' : (window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    const wsHost = isFileProtocol ? '127.0.0.1:18168' : window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;
    ws.value = new WebSocket(wsUrl);

    ws.value.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.value.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type && message.content) {
          // 检查消息是否属于当前对话
          const isCurrentConversation = selectedThread.value && message.conversationId === selectedThread.value.id;

          if (message.type === 'reminder') {
            // 定时提醒 — 主动推送的消息
            if (isCurrentConversation) {
              const newMessage: Message = {
                id: `reminder-${Date.now()}`,
                role: 'assistant',
                content: `🔔 **定时提醒**\n\n${message.content}`,
                timestamp: message.timestamp || Date.now(),
              };
              messages.value.push(newMessage);
              scrollToBottom();
            }
            // 无论是否当前对话，都在控制台记录
            console.log(`🔔 提醒: ${message.content}`);
          } else if (isCurrentConversation) {
            // 普通消息（progress, status, question, result）
            const typeEmojis: Record<string, string> = {
              progress: '🔄',
              status: '📢',
              question: '❓',
              result: '✅'
            };
            const emoji = typeEmojis[message.type] || '📢';
            const formattedContent = `${emoji} [${message.type.toUpperCase()}] ${message.content}`;

            const newMessage: Message = {
              id: Date.now().toString(),
              role: 'assistant',
              content: formattedContent,
              timestamp: message.timestamp || Date.now(),
            };
            messages.value.push(newMessage);
            scrollToBottom();
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.value.onclose = () => {
      console.log('WebSocket disconnected');
      // 尝试重连
      setTimeout(initWebSocket, 5000);
    };

    ws.value.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  onUnmounted(() => {
    stopMessage();
    if (ws.value) {
      ws.value.close();
    }
  });

  // Skills and MCP


  const skills = ref<Skill[]>([]);
  const mcpServers = ref<MCPServer[]>([]);
  const skillSearchQuery = ref('');
  const mcpSearchQuery = ref('');
  const showSkills = ref(true);
  const showMCP = ref(true);
  const allSkillsEnabled = ref(true);
  const allMCPServersEnabled = ref(true);

  // Modal states
  const previewImage = ref<string | null>(null);
  const showAgentModal = ref(false);
  const editingAgent = ref<Partial<Agent>>({});
  const isEditing = ref(false);

  const showThreadModal = ref(false);
  const newThreadTitle = ref('');

  // Smart Create state
  const showSmartCreateModal = ref(false);
  const smartCreatePrompt = ref('');
  const smartCreateLoading = ref(false);
  const smartCreateSelectedConfigId = ref('');

  const SMART_CREATE_CONFIG_KEY = 'smartCreateSelectedConfigId';

  function loadSmartCreateConfig() {
    try {
      const saved = localStorage.getItem(SMART_CREATE_CONFIG_KEY);
      if (saved) {
        smartCreateSelectedConfigId.value = saved;
      }
    } catch (error) {
      console.error('Failed to load smart create config:', error);
    }
  }

  function saveSmartCreateConfig(configId: string) {
    try {
      smartCreateSelectedConfigId.value = configId;
      localStorage.setItem(SMART_CREATE_CONFIG_KEY, configId);
    } catch (error) {
      console.error('Failed to save smart create config:', error);
    }
  }

  const defaultSystemPrompt = `你是一个有帮助的AI助手。`;
  const systemPrompt = computed(() => selectedAgent.value?.systemPrompt || defaultSystemPrompt);

  const agentTemplates = [
    {
      name: '全栈开发工程师',
      systemPrompt: '你是一个顶级的全栈开发专家，精通各种编程语言和架构设计。请在回答代码问题时，给出优雅、安全且符合最佳实践的代码片段，并附带简要说明。',
      permissionMode: 'auto-edit' as const,
    },
    {
      name: '爆款文案达人',
      systemPrompt: '你是全网顶级的爆款内容策划专家，熟悉各种社交平台的文案抓手。你的输出总是带有适当的 Emoji 且标题极具吸引力，内容结构化、易读且具备天然分享感。',
      permissionMode: 'custom' as const,
    },
    {
      name: '资深翻译官',
      systemPrompt: '你是一名资深双语互译专家，能在中英等多语言之间提供地道自然的互译。对于日常交流、专业文档和正式邮件，你始终能保证信达雅的标准。',
      permissionMode: 'normal' as const,
    }
  ];

  function applyTemplate(tpl: typeof agentTemplates[0]) {
    editingAgent.value.name = tpl.name;
    editingAgent.value.systemPrompt = tpl.systemPrompt;
    editingAgent.value.permissionMode = tpl.permissionMode;
  }

  onMounted(async () => {
    await loadAgents();
    await Promise.all([loadmodelConfigs(), loadKnowledgeBases(), loadAllThreadsForHistory(), loadSkills(), loadMCPServers()]);
    loadSmartCreateConfig();

    // 初始化 WebSocket 连接
    initWebSocket();

    // Handle URL query parameters to auto-select agent/thread
    if (route.query.agent) {
      const agentId = route.query.agent as string;
      const targetAgent = agents.value.find(a => a.id === agentId);
      if (targetAgent) {
        selectAgent(targetAgent);
        if (route.query.thread) {
          // give it time to load threads
          setTimeout(() => {
            const threadId = route.query.thread as string;
            const targetThread = threads.value.find(t => t.id === threadId);
            if (targetThread) {
              selectThread(targetThread);
            }
          }, 300);
        }
      }
    }
  });

  async function loadmodelConfigs() {
    try {
      const response = await fetch('/api/models/configs');
      if (response.ok) {
        const configs = await response.json();
        modelConfigs.value = configs.filter((c: any) => c.enabled).map((c: any) => ({ id: c.id, name: c.name, model: c.model || '', modelType: c.modelType || 'chat', enabled: c.enabled }));
        if (modelConfigs.value.length > 0) {
          // 如果有选中的 agent 且有默认模型，则恢复其选择
          if (selectedAgent.value?.defaultModel && modelConfigs.value.some(c => c.id === selectedAgent.value?.defaultModel)) {
            selectedConfigId.value = selectedAgent.value.defaultModel;
          } else {
            selectedConfigId.value = modelConfigs.value[0].id;
          }

          // 确保智能新建的配置选择是有效的
          if (smartCreateSelectedConfigId.value && !modelConfigs.value.some(c => c.id === smartCreateSelectedConfigId.value)) {
            smartCreateSelectedConfigId.value = modelConfigs.value[0].id;
          } else if (!smartCreateSelectedConfigId.value) {
            smartCreateSelectedConfigId.value = modelConfigs.value[0].id;
          }
        }
      }
    } catch (error) {
      console.error('Failed to load LLM configs:', error);
    }
  }

  async function loadKnowledgeBases() {
    try {
      const response = await fetch('/api/knowledge');
      if (response.ok) {
        knowledgeBases.value = await response.json();
      }
    } catch (error) {
      console.error('Failed to load knowledge bases:', error);
    }
  }

  async function loadAllThreadsForHistory() {
    try {
      const allThreadsList: any[] = [];
      for (const agent of agents.value) {
        const response = await fetch(`/api/agents/${agent.id}/threads`);
        if (response.ok) {
          const agThreads = await response.json();
          for (const thread of agThreads) {
            allThreadsList.push({
              id: thread.id,
              agentId: agent.id,
              agentName: agent.name,
              title: thread.title || '未命名对话',
            });
          }
        }
      }
      allThreads.value = allThreadsList;
    } catch (error) {
      console.error('Failed to load threads:', error);
    }
  }

  async function loadSkills() {
    try {
      const response = await fetch('/api/skills');
      if (response.ok) {
        const data = await response.json();
        skills.value = data.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          enabled: s.enabled !== false
        }));
      }
    } catch (error) {
      console.error('Failed to load skills:', error);
    }
  }

  async function loadMCPServers() {
    try {
      const response = await fetch('/api/mcp/servers');
      if (response.ok) {
        const data = await response.json();
        mcpServers.value = data.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          enabled: s.enabled !== false
        }));
      }
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
    }
  }

  const filteredSkills = computed(() => {
    if (!skillSearchQuery.value) return skills.value;
    const query = skillSearchQuery.value.toLowerCase();
    return skills.value.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query)
    );
  });

  const filteredMCPServers = computed(() => {
    if (!mcpSearchQuery.value) return mcpServers.value;
    const query = mcpSearchQuery.value.toLowerCase();
    return mcpServers.value.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query)
    );
  });

  const modelConfigOptions = computed(() => {
    return [
      { value: '', label: '默认模型 (系统配置)' },
      ...modelConfigs.value.map(cfg => ({ value: cfg.id, label: cfg.name }))
    ];
  });

  // 获取当前 agent 已选技能 ID 列表
  function getSelectedSkillIds(agent: Agent): string[] {
    const v = agent.toolsConfig?.selected_skills;
    if (Array.isArray(v)) return v;
    return [];
  }

  // 获取当前 agent 已选 MCP ID 列表
  function getSelectedMCPIds(agent: Agent): string[] {
    const v = agent.toolsConfig?.selected_mcp;
    if (Array.isArray(v)) return v;
    return [];
  }

  function addSkillToAgent(agent: Agent, skillId: string) {
    if (!agent.toolsConfig) agent.toolsConfig = {};
    const ids = getSelectedSkillIds(agent);
    if (!ids.includes(skillId)) {
      agent.toolsConfig.selected_skills = [...ids, skillId];
      updateAgentDirect(agent);
      updateAllSkillsStatus();
    }
  }

  function removeSkillFromAgent(agent: Agent, skillId: string) {
    if (!agent.toolsConfig) return;
    agent.toolsConfig.selected_skills = getSelectedSkillIds(agent).filter(id => id !== skillId);
    updateAgentDirect(agent);
    updateAllSkillsStatus();
  }

  function addMCPToAgent(agent: Agent, mcpId: string) {
    if (!agent.toolsConfig) agent.toolsConfig = {};
    const ids = getSelectedMCPIds(agent);
    if (!ids.includes(mcpId)) {
      agent.toolsConfig.selected_mcp = [...ids, mcpId];
      updateAgentDirect(agent);
      updateAllMCPServersStatus();
    }
  }

  function removeMCPFromAgent(agent: Agent, mcpId: string) {
    if (!agent.toolsConfig) return;
    agent.toolsConfig.selected_mcp = getSelectedMCPIds(agent).filter(id => id !== mcpId);
    updateAgentDirect(agent);
    updateAllMCPServersStatus();
  }

  function toggleAllSkills() {
    if (!selectedAgent.value) return;
    if (!selectedAgent.value.toolsConfig) selectedAgent.value.toolsConfig = {};

    if (allSkillsEnabled.value) {
      selectedAgent.value.toolsConfig.selected_skills = skills.value.map(s => s.id);
    } else {
      selectedAgent.value.toolsConfig.selected_skills = [];
    }
    updateAgentDirect(selectedAgent.value);
  }

  function toggleAllMCPServers() {
    if (!selectedAgent.value) return;
    if (!selectedAgent.value.toolsConfig) selectedAgent.value.toolsConfig = {};

    if (allMCPServersEnabled.value) {
      selectedAgent.value.toolsConfig.selected_mcp = mcpServers.value.map(s => s.id);
    } else {
      selectedAgent.value.toolsConfig.selected_mcp = [];
    }
    updateAgentDirect(selectedAgent.value);
  }

  function updateAllSkillsStatus() {
    if (!selectedAgent.value) return;
    const selectedSkillIds = getSelectedSkillIds(selectedAgent.value);
    allSkillsEnabled.value = selectedSkillIds.length === skills.value.length && skills.value.length > 0;
  }

  function updateAllMCPServersStatus() {
    if (!selectedAgent.value) return;
    const selectedMCPIds = getSelectedMCPIds(selectedAgent.value);
    allMCPServersEnabled.value = selectedMCPIds.length === mcpServers.value.length && mcpServers.value.length > 0;
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

  async function loadThreads(agentId: string) {
    try {
      const response = await fetch(`/api/agents/${agentId}/threads`);
      if (response.ok) {
        threads.value = await response.json();
      }
    } catch (error) {
      console.error('Failed to load threads:', error);
    }
  }

  function selectAgent(agent: Agent) {
    if (isLoading.value && abortController.value) {
      stopMessage();
    }

    if (!agent.toolsConfig) agent.toolsConfig = {};
    if (!agent.channelsConfig) agent.channelsConfig = [];
    selectedAgent.value = agent;
    selectedThread.value = null;
    messages.value = [];
    chatViewTab.value = 'threads';

    // 恢复 agent 的默认模型选择
    if (agent.defaultModel && modelConfigs.value.some(c => c.id === agent.defaultModel)) {
      selectedConfigId.value = agent.defaultModel;
    } else if (modelConfigs.value.length > 0) {
      selectedConfigId.value = modelConfigs.value[0].id;
    }

    // 恢复 agent 的知识库选择
    selectedKnowledgeBases.value = agent.knowledgeBaseIds || [];

    // 更新总开关状态
    const selectedSkillIds = getSelectedSkillIds(agent);
    allSkillsEnabled.value = selectedSkillIds.length === skills.value.length && skills.value.length > 0;

    const selectedMCPIds = getSelectedMCPIds(agent);
    allMCPServersEnabled.value = selectedMCPIds.length === mcpServers.value.length && mcpServers.value.length > 0;

    loadThreads(agent.id);
    router.replace({ query: { ...route.query, agent: agent.id, thread: undefined, tab: 'threads' } }).catch(() => { });
  }

  async function updateAgentModelConfig(modelId: string) {
    if (!selectedAgent.value) return;
    selectedAgent.value.defaultModel = modelId;
    try {
      await fetch(`/api/agents/${selectedAgent.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel: modelId }),
      });
    } catch (error) {
      console.error('Failed to update agent model config:', error);
    }
  }

  function openCreateAgentModal() {
    editingAgent.value = {
      name: '',
      systemPrompt: '',
      avatar: '',
      sandboxEnabled: true,
      permissionMode: 'normal',
    };
    isEditing.value = false;
    showAgentModal.value = true;
  }

  function openEditAgentModal() {
    if (!selectedAgent.value) return;
    editingAgent.value = { ...selectedAgent.value };
    isEditing.value = true;
    showAgentModal.value = true;
  }

  async function handleSaveAgent() {
    if (editingAgent.value.permissionMode === 'full-auto') {
      const confirmed = confirm('⚠️ 警告：当前选择的是【全自动 (危险)】模式！\n\n开启此模式后，助手将完全接管文件读写和执行系统命令的权限，无需二次确认即可直接执行，可能带来数据丢失或环境受损等不可预知的风险。\n\n您确定要继续保存并自行承担相关风险吗？（此弹窗仅为产品免责声明）');
      if (!confirmed) {
        return;
      }
    }
    await saveAgent();
  }

  async function saveAgent() {
    try {
      if (isEditing.value && editingAgent.value.id) {
        await fetch(`/api/agents/${editingAgent.value.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingAgent.value),
        });
      } else {
        await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingAgent.value),
        });
      }
      showAgentModal.value = false;
      await loadAgents();
      if (selectedAgent.value) {
        const updated = agents.value.find(a => a.id === selectedAgent.value?.id);
        if (updated) {
          selectedAgent.value = updated;
        }
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  }

  async function updateAgentDirect(agent: Agent) {
    try {
      // Ensure config objects exist
      if (!agent.toolsConfig) agent.toolsConfig = {};
      if (!agent.channelsConfig) agent.channelsConfig = [];

      // Save knowledge base selection
      agent.knowledgeBaseIds = selectedKnowledgeBases.value;

      await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent),
      });
    } catch (error) {
      console.error('Failed to update agent:', error);
    }
  }

  async function deleteAgent(agent: Agent) {
    if (!confirm(`确定要删除助手 "${agent.name}" 吗？相关的对话记录也会被删除。`)) return;
    try {
      await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (selectedAgent.value?.id === agent.id) {
        selectedAgent.value = null;
        selectedThread.value = null;
        messages.value = [];
      }
      await loadAgents();
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  }

  async function handleSmartCreate() {
    if (!smartCreatePrompt.value.trim()) {
      alert('请输入您的需求');
      return;
    }
    smartCreateLoading.value = true;
    try {
      const res = await fetch('/api/agents/smart-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: smartCreatePrompt.value.trim(),
          modelConfigId: smartCreateSelectedConfigId.value || undefined
        })
      });
      if (res.ok) {
        const data = await res.json();
        await loadAgents();
        showSmartCreateModal.value = false;
        smartCreatePrompt.value = '';
        if (data.office) {
          const agentNames = data.agents.map((a: any) => a.name).join('、');
          if (confirm(`智能团队创建成功！\n\n- 组建助手：${data.agents.length} 个 (${agentNames})\n- 组建办公室："${data.office.name}"\n\n是否立即前往该小组办公室开始协作？`)) {
            router.push({ path: '/office', query: { tab: data.office.status } });
          }
        } else if (data.agents && data.agents.length > 0) {
          let msg = `智能助手创建成功！\n- 生成助手：${data.agents.length} 个\n- 助手名称：${data.agents.map((a: any) => a.name).join('、')}`;
          if (data.officeError) {
            msg += `\n\n⚠️ 但办公室自动组建失败：${data.officeError}`;
          }
          alert(msg);
          const createdAgent = agents.value.find(a => a.id === data.agents[0].id) || data.agents[0];
          if (createdAgent) selectAgent(createdAgent);
        }
      } else {
        const err = await res.json();
        alert('智能创建失败: ' + err.error);
      }
    } catch (e) {
      alert('请求失败, 请检查网络或后台服务');
    } finally {
      smartCreateLoading.value = false;
    }
  }

  function openCreateThreadModal() {
    if (!selectedAgent.value) return;
    newThreadTitle.value = '';
    showThreadModal.value = true;
  }

  async function createThread() {
    if (!selectedAgent.value) return;
    try {
      const response = await fetch(`/api/agents/${selectedAgent.value.id}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newThreadTitle.value || undefined }),
      });
      if (response.ok) {
        const thread = await response.json();
        showThreadModal.value = false;
        await loadThreads(selectedAgent.value.id);
        selectThread(thread);
      }
    } catch (error) {
      console.error('Failed to create thread:', error);
    }
  }

  async function selectThread(thread: Thread) {
    if (isLoading.value && selectedThread.value?.id !== thread.id) {
      stopMessage();
    }
    router.replace({ query: { ...route.query, thread: thread.id } }).catch(() => { });
    try {
      const response = await fetch(`/api/threads/${thread.id}`);
      if (response.ok) {
        const threadData = await response.json();
        selectedThread.value = threadData;
        messages.value = threadData.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));
        await nextTick();
        scrollToBottom();
      }
    } catch (error) {
      console.error('Failed to load thread:', error);
    }
  }

  async function deleteThread(thread: Thread) {
    if (!confirm(`确定要删除对话 "${thread.title}" 吗？`)) return;
    try {
      await fetch(`/api/threads/${thread.id}`, { method: 'DELETE' });
      if (selectedThread.value?.id === thread.id) {
        selectedThread.value = null;
        messages.value = [];
      }
      await loadThreads(thread.agentId);
    } catch (error) {
      console.error('Failed to delete thread:', error);
    }
  }

  // Chat functions
  async function sendMessage() {
    if (!inputMessage.value.trim() || (selectedAgent.value && agentWorkingStore.isAgentWorking(selectedAgent.value.id)) || !selectedAgent.value) return;

    abortController.value = new AbortController();

    const msgContent = inputMessage.value.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msgContent,
      timestamp: Date.now(),
    };

    if (!selectedThread.value) {
      try {
        const response = await fetch(`/api/agents/${selectedAgent.value.id}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: msgContent.slice(0, 30) || '新对话' }),
        });
        if (response.ok) {
          const newThread = await response.json();
          await loadThreads(selectedAgent.value.id);
          selectedThread.value = newThread;
        }
      } catch (e) {
        console.error(e);
        return;
      }
    } else if (selectedThread.value.title === '新对话' || selectedThread.value.title === '新话题') {
      // Auto-update title from first message if still default
      const newTitle = msgContent.slice(0, 30);
      try {
        await fetch(`/api/threads/${selectedThread.value.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        selectedThread.value.title = newTitle;
      } catch (e) {
        console.error('Failed to update thread title:', e);
      }
    }

    messages.value.push(userMessage);
    inputMessage.value = '';

    const activeThreadId = selectedThread.value?.id;
    if (activeThreadId) {
      try {
        await fetch(`/api/threads/${activeThreadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: userMessage.content, timestamp: userMessage.timestamp }),
        });
      } catch (e) {
        console.error('Failed to save user message:', e);
      }
    }

    // Process file attachments
    const attachments: Array<{ name: string; type: string; dataUrl: string }> = [];
    if (uploadedFiles.value.length > 0) {
      for (const file of uploadedFiles.value) {
        const dataUrl = await readFileAsDataUrl(file);
        attachments.push({ name: file.name, type: file.type, dataUrl });
      }
      userMessage.attachments = attachments;
      uploadedFiles.value = [];
    }

    if (selectedAgent.value) {
      agentWorkingStore.setAgentWorking(selectedAgent.value.id, true);
    }
    isLoading.value = true;

    const assistantId = (Date.now() + 1).toString();
    messages.value.push({
      id: assistantId,
      role: 'assistant',
      content: '🚀 正在连接API...',
      timestamp: Date.now(),
      loading: true,
    });

    await scrollToBottom();

    let responseContent = '';
    let hasError = false;
    let connectionEstablished = false;

    // Determine Model Type from config (default to 'chat')
    const currentConfig = modelConfigs.value.find(c => c.id === selectedConfigId.value);
    const modelType = (currentConfig as any)?.modelType || 'chat';

    try {
      if (modelType === 'image-gen') {
        // Image generation flow
        const assistantMsg = messages.value.find(m => m.id === assistantId);
        if (assistantMsg) {
          assistantMsg.content = '🎨 正在生成图像...';
        }

        const imgResponse = await fetch('/api/models/image-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configId: selectedConfigId.value,
            prompt: msgContent,
            imageSize: '1024x1024',
          }),
          signal: abortController.value?.signal,
        });

        if (!imgResponse.ok) {
          const errData = await imgResponse.json();
          throw new Error(errData.error || '图像生成失败');
        }

        const imgData = await imgResponse.json();
        const images = imgData.images || [];

        if (images.length > 0) {
          responseContent = images.map((img: any) => `![生成的图片(${img.url})`).join('\n\n');
        } else {
          responseContent = '⚠️ 图像生成成功但未返回图片数据';
        }

        if (assistantMsg) {
          assistantMsg.content = responseContent;
          assistantMsg.loading = false;
        }

        isLoading.value = false;
        await scrollToBottom();

        // Save assistant message to thread (for non-chat models, backend chat-orchestrator is not used)
        if (activeThreadId) {
          await fetch(`/api/threads/${activeThreadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: responseContent, timestamp: Date.now() }),
          });
        }
        return;
      } else if (modelType === 'audio-tts') {
        // Audio TTS flow
        const assistantMsg = messages.value.find(m => m.id === assistantId);
        if (assistantMsg) {
          assistantMsg.content = '🎵 正在合成语音...';
        }

        const ttsResponse = await fetch('/api/models/audio-speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configId: selectedConfigId.value,
            input: msgContent,
          }),
          signal: abortController.value?.signal,
        });

        if (!ttsResponse.ok) {
          const errData = await ttsResponse.json();
          throw new Error(errData.error || '语音合成失败');
        }

        const ttsData = await ttsResponse.json();
        if (ttsData.audio) {
          // Embed HTML audio player
          responseContent = `<audio controls src="${ttsData.audio}" class="mt-2 w-full max-w-sm rounded-lg bg-black/40"></audio>`;
        } else {
          responseContent = '鈿狅笍 璇煶鍚堟垚鎴愬姛浣嗘湭杩斿洖闊抽鏁版嵁';
        }

        if (assistantMsg) {
          assistantMsg.content = responseContent;
          assistantMsg.loading = false;
        }

        isLoading.value = false;
        await scrollToBottom();

        if (activeThreadId) {
          await fetch(`/api/threads/${activeThreadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: responseContent, timestamp: Date.now() }),
          });
        }
        return;
      } else if (modelType === 'video-gen') {
        // Video Generation flow
        const assistantMsg = messages.value.find(m => m.id === assistantId);
        if (assistantMsg) {
          assistantMsg.content = '🎬 正在生成视频（可能需要几分钟）...';
        }

        const vidResponse = await fetch('/api/models/video-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configId: selectedConfigId.value,
            prompt: msgContent,
          }),
          signal: abortController.value?.signal,
        });

        if (!vidResponse.ok) {
          const errData = await vidResponse.json();
          throw new Error(errData.error || '视频生成请求失败');
        }

        const vidData = await vidResponse.json();
        if (vidData.video) {
          // Direct video returned (fast execution)
          responseContent = `![生成的视频](${vidData.video})`;
        } else if (vidData.requestId) {
          // Video is processing asynchronously
          responseContent = `🔄 **视频生成任务已提交**\n\n任务ID: \`${vidData.requestId}\`\n状态: ${vidData.message || '处理中'}\n\n*由于前端轮询限制，请稍后手动检查状态。*`;
        } else {
          responseContent = '⏳ 视频生成任务已下发，但未返回状态。';
        }

        if (assistantMsg) {
          assistantMsg.content = responseContent;
          assistantMsg.loading = false;
          assistantMsg.statusDetail = '';
        }

        isLoading.value = false;
        await scrollToBottom();

        if (activeThreadId) {
          await fetch(`/api/threads/${activeThreadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: responseContent, timestamp: Date.now() }),
          });
        }
        return;
      }

      await fetchSSE('/api/models/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.value
            .filter(m => m.id !== assistantId)
            .map(m => ({ role: m.role, content: m.content, attachments: m.attachments })),
          configId: selectedConfigId.value || undefined,
          stream: true,
          conversationId: selectedThread.value?.id,
          systemPrompt: systemPrompt.value || undefined,
          knowledgeBaseIds: selectedKnowledgeBases.value,
          historyConversationIds: selectedHistoryThreads.value,
          useContextMemory: useHistory.value,
          agentId: selectedAgent.value?.id,
        }),
        signal: abortController.value?.signal,
        onChunk: async (data: any) => {
          if (!connectionEstablished) {
            connectionEstablished = true;
            responseContent = '';
          }
          if (data.delta) {
            responseContent += data.delta;
          }
          const idx = messages.value.findIndex(m => m.id === assistantId);
          if (idx !== -1) {
            messages.value[idx].content = responseContent;
            messages.value[idx].loading = !data.done && !data.error;
          }
          await scrollToBottom();
        },
        onStatus: (data: any) => {
          const idx = messages.value.findIndex(m => m.id === assistantId);
          if (idx !== -1) {
            messages.value[idx].statusDetail = data.detail || (data.status === 'processing' ? '正在准备上下文...' : data.status === 'streaming' ? '正在生成回复...' : '思考中...');
          }
        },
        onToolResult: async (data: any) => {
          const toolName = data.name || 'unknown_tool';
          let rawResult = data.result || '';
          let parsedResult = rawResult;
          const GUI_SCREENSHOT_MARKER = '[GUI_SCREENSHOT]'; // kept for stripping only (not displayed)
          const SEND_FILE_MARKER = '[SEND_FILE]';
          let extractedAttachment: any = null;

          // Strip [GUI_SCREENSHOT] content from display — GUI screenshots are internal to the agent
          if (rawResult.includes(GUI_SCREENSHOT_MARKER)) {
            const markerIdx = rawResult.indexOf(GUI_SCREENSHOT_MARKER);
            parsedResult = rawResult.substring(0, markerIdx).trim();
            // No extractedAttachment — not shown to user
          } else if (rawResult.includes(SEND_FILE_MARKER)) {
            const markerIdx = rawResult.indexOf(SEND_FILE_MARKER);
            const nlIdx = rawResult.indexOf('\n', markerIdx);
            const dataPart = rawResult.substring(markerIdx + SEND_FILE_MARKER.length, nlIdx !== -1 ? nlIdx : rawResult.length).trim();
            const [fileUrl, fileName, mimeType] = dataPart.split('|');
            parsedResult = rawResult.substring(0, markerIdx).trim();
            extractedAttachment = { name: fileName, type: mimeType, dataUrl: fileUrl };
          }

          const toolResult = parsedResult.substring(0, 800);
          const toolBlock = `\n\n<details><summary>⚙️ 工具调用: <code>${toolName}</code></summary>\n\n\`\`\`\n${toolResult}\n\`\`\`\n\n</details>\n\n`;
          responseContent += toolBlock;

          const idx = messages.value.findIndex(m => m.id === assistantId);
          if (idx !== -1) {
            if (!messages.value[idx].toolSteps) messages.value[idx].toolSteps = [];
            messages.value[idx].toolSteps!.push({ name: toolName, result: toolResult, timestamp: Date.now() });

            if (extractedAttachment) {
              if (!messages.value[idx].attachments) messages.value[idx].attachments = [];
              messages.value[idx].attachments!.push(extractedAttachment);
            }

            messages.value[idx].content = responseContent;
          }
          await scrollToBottom();
        },
        onSkillApproval: (data: any) => {
          pendingSkillApproval.value = data;
        },
        onError: (errMessage: any) => {
          // Append error to existing content instead of replacing it
          responseContent += `\n\n❌ API错误: ${errMessage}`;
          hasError = true;
        }
      });
    } catch (error: any) {
      const isAbort = error.name === 'AbortError'
        || error.name === 'DOMException'
        || (error.message && (error.message.includes('aborted') || error.message.includes('abort')));

      if (isAbort) {
        // User clicked STOP — keep all partial content and append a note
        if (responseContent.trim()) {
          responseContent += '\n\n*(已暂停)*';
        } else {
          responseContent = '*(已暂停)*';
        }
      } else {
        // Real error — still preserve partial content if any was received
        if (responseContent.trim()) {
          responseContent += `\n\n❌ ${error.message || '未知错误'}`;
        } else {
          responseContent = `❌ ${error.message || '未知错误'}`;
        }
      }
    } finally {
      const idx = messages.value.findIndex(m => m.id === assistantId);
      if (idx !== -1) {
        // Always keep the accumulated content — never wipe what was already streamed
        messages.value[idx].content = responseContent || messages.value[idx].content || '*(已暂停)*';
        messages.value[idx].loading = false;
        messages.value[idx].statusDetail = '';
      }
      isLoading.value = false;
      abortController.value = null;
      if (selectedAgent.value) {
        agentWorkingStore.setAgentWorking(selectedAgent.value.id, false);
        // Reload agent list to refresh sort order (recently chatted agent moves to top)
        loadAgents();
      }

      // Reload threads to update the list
      if (activeThreadId && selectedAgent.value) {
        // The backend orchestrator saves the assistant message natively.
        // We just reload threads to pick up the updated title or sorted order.
        await loadThreads(selectedAgent.value.id);
      }
    }
  }

  async function scrollToBottom() {
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  }

  function stopMessage() {
    if (abortController.value) {
      // Notify server immediately via a dedicated endpoint (more reliable than socket close detection)
      const convId = selectedThread.value?.id;
      if (convId) {
        fetch('/api/agent/abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convId })
        }).catch(() => { }); // fire-and-forget, ignore errors
      }
      // Also abort the fetch stream
      abortController.value.abort();
      abortController.value = null;
      isLoading.value = false;
      if (selectedAgent.value) {
        agentWorkingStore.setAgentWorking(selectedAgent.value.id, false);
      }
    }
  }

  function renderMarkdown(content: string): string {
    // Pre-process: convert inline base64 image data (from browser_screenshot) into clickable images
    let processed = content.replace(
      /data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/g,
      (match) => `\n\n![浏览器截图](${match})\n\n`
    );

    return marked(processed, {
      highlight: (code: string, lang: string) => {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    } as any) as unknown as string;
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString();
  }

  const copyMessage = async (msg: Message) => {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const deleteMessageFromUI = async (index: number) => {
    if (!selectedThread.value) return;
    messages.value.splice(index, 1);
    await fetch(`/api/threads/${selectedThread.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...selectedThread.value, messages: messages.value })
    });
  };

  const recallMessage = async (index: number) => {
    if (!selectedThread.value) return;
    try {
      const response = await fetch(`/api/threads/${selectedThread.value.id}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromIndex: index })
      });
      if (response.ok) {
        const data = await response.json();
        messages.value.splice(index);

        // Notify user about rolled back files
        if (data.rolledBackFiles && data.rolledBackFiles.length > 0) {
          const fileList = data.rolledBackFiles.map((f: string) => `  • ${f}`).join('\n');
          alert(`撤回成功！以下文件已回滚至操作前状态：\n${fileList}`);
        }
        if (data.failedFiles && data.failedFiles.length > 0) {
          console.warn('Some files failed to roll back:', data.failedFiles);
        }
      } else {
        console.error('Recall API failed:', await response.text());
        // Fallback to simple splice
        messages.value.splice(index);
      }
    } catch (error) {
      console.error('Failed to recall messages:', error);
      messages.value.splice(index);
    }
  };

  const editMessage = async (index: number) => {
    const msgContent = messages.value[index].content;
    inputMessage.value = msgContent;
    await recallMessage(index);
  };

  const replyMessage = (msg: Message) => {
    const quote = msg.content.split('\n').map(line => `> ${line}`).join('\n');
    inputMessage.value = `${quote}\n\n` + inputMessage.value;
  };

  const regenerateMessage = async (index: number) => {
    if (!selectedThread.value) return;
    let userMsgIndex = index - 1;
    while (userMsgIndex >= 0 && messages.value[userMsgIndex].role !== 'user') userMsgIndex--;

    if (userMsgIndex >= 0) {
      const userMsg = messages.value[userMsgIndex].content;
      messages.value.splice(userMsgIndex + 1);
      await fetch(`/api/threads/${selectedThread.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selectedThread.value, messages: messages.value })
      });
      inputMessage.value = userMsg;
      await sendMessage();
    }
  };

  function handleAvatarUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || !target.files[0]) return;
    const file = target.files[0];
    const reader = new FileReader();
    reader.onload = () => { editingAgent.value.avatar = reader.result as string; };
    reader.readAsDataURL(file);
    target.value = '';
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
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

  function getPermissionModeLabel(mode?: string): string {
    const labels: Record<string, string> = { 'normal': '普通模式', 'auto-edit': '自动编辑模式', 'full-auto': '全自动模式' };
    return labels[mode || 'normal'] || '普通模式';
  }


  return {
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
    pendingSkillApproval,
    resolveSkillApproval,
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
    handlePaste,
    previewImage
  };
}
