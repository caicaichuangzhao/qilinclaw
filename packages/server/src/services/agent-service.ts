import fs from 'fs';
import path from 'path';
import { agentMemoryManager } from './agent-memory.js';

export interface Agent {
  id: string;
  name: string;
  avatar?: string;
  systemPrompt: string;
  defaultModel?: string;
  permissionMode?: 'normal' | 'auto-edit' | 'full-auto' | 'custom';
  toolsConfig?: Record<string, any>;
  channelsConfig?: string[];
  knowledgeBaseIds?: string[];
  sandboxEnabled?: boolean;
  hardSandboxEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Thread {
  id: string;
  agentId: string;
  title: string;
  messages: ThreadMessage[];
  source?: 'web' | 'feishu' | 'dingtalk' | 'telegram' | 'discord' | 'wecom' | 'whatsapp';
  createdAt: number;
  updatedAt: number;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: any[];
}

export class AgentService {
  private agents: Map<string, Agent> = new Map();
  private threads: Map<string, Thread> = new Map();
  private agentsPath: string;
  private threadsPath: string;

  constructor() {
    this.agentsPath = path.resolve(process.cwd(), '.qilin-claw/agents.json');
    this.threadsPath = path.resolve(process.cwd(), '.qilin-claw/threads.json');
    this.loadData();
  }

  private loadData(): void {
    if (fs.existsSync(this.agentsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.agentsPath, 'utf-8'));
        for (const agent of data) {
          this.agents.set(agent.id, agent);
        }
        console.log(`Loaded ${this.agents.size} agents from disk`);
      } catch (error) {
        console.error('Failed to load agents:', error);
      }
    }

    if (fs.existsSync(this.threadsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.threadsPath, 'utf-8'));
        for (const thread of data) {
          this.threads.set(thread.id, thread);
        }
        console.log(`Loaded ${this.threads.size} threads from disk`);
        // Convert existing threads to vector storage
        this.convertThreadsToVectorStorage();
      } catch (error) {
        console.error('Failed to load threads:', error);
      }
    }

    if (this.agents.size === 0) {
      this.createAgent({
        name: '默认助手',
        systemPrompt: '你是一个 helpful AI assistant.',
      });
    }
  }

  private async convertThreadsToVectorStorage(): Promise<void> {
    const { contextMemory } = await import('./context-memory.js');

    for (const thread of this.threads.values()) {
      if (thread.messages && thread.messages.length > 0) {
        console.log(`[AgentService] Converting thread ${thread.id} (${thread.title}) to vector storage...`);
        for (const message of thread.messages) {
          try {
            await contextMemory.addMessage(thread.id, {
              role: message.role,
              content: message.content,
              timestamp: message.timestamp
            });
          } catch (error) {
            console.error(`[AgentService] Failed to convert message ${message.id}:`, error);
          }
        }
      }
    }
    console.log('[AgentService] Thread conversion to vector storage completed');
  }

  private saveAgents(): void {
    try {
      const dir = path.dirname(this.agentsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.agentsPath, JSON.stringify(Array.from(this.agents.values()), null, 2));
    } catch (error) {
      console.error('Failed to save agents:', error);
    }
  }

  private saveThreads(): void {
    try {
      const dir = path.dirname(this.threadsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.threadsPath, JSON.stringify(Array.from(this.threads.values()), null, 2));
    } catch (error) {
      console.error('Failed to save threads:', error);
    }
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  createAgent(data: Partial<Agent>): Agent {
    const now = Date.now();
    const agent: Agent = {
      id: `agent-${now}-${Math.random().toString(36).substr(2, 6)}`,
      name: data.name || '未命名助手',
      avatar: data.avatar,
      systemPrompt: data.systemPrompt || '',
      defaultModel: data.defaultModel,
      permissionMode: data.permissionMode || 'normal',
      toolsConfig: data.toolsConfig || {},
      channelsConfig: data.channelsConfig || [],
      knowledgeBaseIds: data.knowledgeBaseIds || [],
      sandboxEnabled: data.sandboxEnabled !== undefined ? data.sandboxEnabled : true,
      hardSandboxEnabled: data.hardSandboxEnabled !== undefined ? data.hardSandboxEnabled : false,
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    this.saveAgents();

    // Fire-and-forget async memory init (don't block agent creation)
    this.initializeAgentMemory(agent).catch(e => console.error('[AgentService] Memory init failed:', e));

    return agent;
  }

  updateAgent(id: string, data: Partial<Agent>): Agent | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;

    const oldName = agent.name;
    Object.assign(agent, data, { updatedAt: Date.now() });
    this.agents.set(id, agent);
    this.saveAgents();

    if (data.name && data.name !== oldName) {
      this.updateAgentMemoryName(agent).catch(e => console.error('[AgentService] Memory name update failed:', e));
    }

    return agent;
  }


  private async initializeAgentMemory(agent: Agent): Promise<void> {
    try {
      const permissionModeDesc = agent.permissionMode === 'normal' ? '普通模式 - 可自由读取文件，编辑或执行命令前会询问' :
        agent.permissionMode === 'auto-edit' ? '自动编辑模式 - 可自由读取和编辑文件，执行命令前会询问' :
          agent.permissionMode === 'full-auto' ? '全自动模式 - 可执行任何操作，无需询问（谨慎使用）' : '普通模式';

      const memoryContent = `# ${agent.name} 的记忆文件

## 身份信息
${agent.name} 是一个AI助手。

## 权限模式
${permissionModeDesc}

## 系统提示词
${agent.systemPrompt || '你是一个有帮助的AI助手。'}

## 创建时间
${new Date().toLocaleString('zh-CN')}

---

# 关键信息摘要
此部分记录对话中提取的关键信息。

---

此文件由系统自动生成，记录了助手的身份信息和对话中的关键信息。你可以通过对话让助手记住更多信息。
`;

      await agentMemoryManager.initAgentAsync(agent.id);

      const existingFiles = await agentMemoryManager.getAgentMemoryFilesAsync(agent.id);
      const hasMemoryFile = existingFiles.some(f => f.filename === 'memory.md');

      if (!hasMemoryFile) {
        await agentMemoryManager.createMemoryFileAsync(agent.id, 'memory.md', memoryContent, 'knowledge');
        console.log(`[AgentService] Created memory file for agent: ${agent.name}`);
      }
    } catch (error) {
      console.error('[AgentService] Failed to initialize agent memory:', error);
    }
  }

  private async updateAgentMemoryName(agent: Agent): Promise<void> {
    try {
      const existingFiles = await agentMemoryManager.getAgentMemoryFilesAsync(agent.id);
      const memoryFile = existingFiles.find(f => f.filename === 'memory.md');

      if (memoryFile) {
        const content = memoryFile.content;
        const lines = content.split('\n');
        const updatedLines = lines.map(line => {
          if (line.startsWith('# ') && line.includes('的记忆文件')) {
            return `# ${agent.name} 的记忆文件`;
          }
          if (line.startsWith('## 身份信息')) {
            return '## 身份信息';
          }
          if (line.trim() && !line.startsWith('#') && !line.startsWith('##') && lines[lines.indexOf(line) - 1]?.startsWith('## 身份信息')) {
            return `${agent.name} 是一个AI助手。`;
          }
          return line;
        });

        const updatedContent = updatedLines.join('\n');
        await agentMemoryManager.updateMemoryFileAsync(memoryFile.id, updatedContent);
        console.log(`[AgentService] Updated agent name in memory file: ${agent.name}`);
      }
    } catch (error) {
      console.error('[AgentService] Failed to update agent memory name:', error);
    }
  }

  async deleteAgent(id: string): Promise<boolean> {
    const deleted = this.agents.delete(id);
    if (deleted) {
      for (const [threadId, thread] of this.threads) {
        if (thread.agentId === id) {
          this.threads.delete(threadId);
        }
      }
      this.saveAgents();
      this.saveThreads();

      try {
        await agentMemoryManager.deleteAgentAsync(id);
      } catch (error) {
        console.error('[AgentService] Failed to delete agent memory:', error);
      }
    }
    return deleted;
  }

  getThreadsByAgent(agentId: string): Thread[] {
    return Array.from(this.threads.values())
      .filter(t => t.agentId === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getAllThreads(): { thread: Thread, agentName: string }[] {
    return Array.from(this.threads.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(t => {
        const agent = this.agents.get(t.agentId);
        return {
          thread: t,
          agentName: agent ? agent.name : 'Unknown Agent'
        };
      });
  }

  getThread(id: string): Thread | undefined {
    return this.threads.get(id);
  }

  createThread(agentId: string, title?: string, source?: Thread['source']): Thread {
    const now = Date.now();
    const thread: Thread = {
      id: `thread-${now}-${Math.random().toString(36).substr(2, 6)}`,
      agentId,
      title: title || '新对话',
      source: source || 'web',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(thread.id, thread);
    this.saveThreads();
    return thread;
  }

  updateThread(id: string, data: Partial<Thread>): Thread | undefined {
    const thread = this.threads.get(id);
    if (!thread) return undefined;

    // Auto-title: if thread title is default and new messages include a user message, use it as title
    if ((thread.title === '新对话' || thread.title === '新话题') && data.messages && data.messages.length > 0) {
      const firstUserMsg = data.messages.find(m => m.role === 'user');
      if (firstUserMsg && firstUserMsg.content) {
        data.title = firstUserMsg.content.substring(0, 30);
      }
    }

    Object.assign(thread, data, { updatedAt: Date.now() });
    this.threads.set(id, thread);
    this.saveThreads();

    // Bump parent agent's updatedAt so recently-chatted agents sort to the top
    const agent = this.agents.get(thread.agentId);
    if (agent) {
      agent.updatedAt = Date.now();
      this.agents.set(agent.id, agent);
      this.saveAgents();
    }

    return thread;
  }

  async deleteThread(id: string): Promise<boolean> {
    const deleted = this.threads.delete(id);
    if (deleted) {
      this.saveThreads();

      try {
        const { contextMemory } = await import('./context-memory.js');
        await contextMemory.clearConversation(id);
        console.log(`[AgentService] Cleared vector store for deleted thread: ${id}`);
      } catch (error) {
        console.error('[AgentService] Failed to clear vector store for thread:', error);
      }
    }
    return deleted;
  }

  addMessageToThread(threadId: string, message: Omit<ThreadMessage, 'id'>): Thread | undefined {
    const thread = this.threads.get(threadId);
    if (!thread) return undefined;

    const msg: ThreadMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...message,
    };
    thread.messages.push(msg);
    thread.updatedAt = Date.now();

    if (thread.messages.length === 1 && message.role === 'user' && (thread.title === '新对话' || thread.title === '新话题')) {
      thread.title = message.content.substring(0, 30) || '新对话';
    }

    this.threads.set(threadId, thread);
    this.saveThreads();

    // Bump parent agent's updatedAt so recently-chatted agents sort to the top
    const agent = this.agents.get(thread.agentId);
    if (agent) {
      agent.updatedAt = Date.now();
      this.agents.set(agent.id, agent);
      this.saveAgents();
    }

    // Convert new message to vector storage
    this.convertMessageToVectorStorage(threadId, msg);

    return thread;
  }

  private async convertMessageToVectorStorage(threadId: string, message: ThreadMessage): Promise<void> {
    try {
      const { contextMemory } = await import('./context-memory.js');
      await contextMemory.addMessage(threadId, {
        role: message.role,
        content: message.content,
        timestamp: message.timestamp
      });
    } catch (error) {
      console.error(`[AgentService] Failed to convert message to vector storage:`, error);
    }
  }

  clearThreadMessages(threadId: string): Thread | undefined {
    const thread = this.threads.get(threadId);
    if (!thread) return undefined;

    thread.messages = [];
    thread.updatedAt = Date.now();
    this.threads.set(threadId, thread);
    this.saveThreads();
    return thread;
  }
}

export const agentService = new AgentService();
