// Updated: 2026-03-05 - All memory routes use async methods
import express from 'express';
import { agentService } from '../services/agent-service.js';
import { agentMemoryManager } from '../services/agent-memory.js';
import { modelsManager } from '../models/manager.js';
import { officeService } from '../services/office-service.js';
import { dockerSandboxService } from '../services/docker-sandbox.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const agents = agentService.getAllAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const agent = agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/smart-create', async (req, res) => {
  try {
    const { prompt, modelConfigId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    console.log('[SmartCreate] Starting smart create with prompt:', prompt);

    const systemPrompt = `你是一个顶级的团队架构师和AI协同专家。你的目标是解析用户的复杂需求，并设计一个高度协作的智能体团队。

用户需求：${prompt}

请根据需求，灵活决定生成1-8个智能体。如果任务很复杂（如：写小说、代码开发、营销策划），必须生成一个多角色的团队，并规划他们的协作关系。

你的回复必须是一个JSON对象，格式如下：
{
  "officeName": "一个能体现团队目标的办公室名称",
  "agents": [
    {
      "name": "智能体名称",
      "systemPrompt": "极其详细的角色设定、技能说明和工作准则",
      "roleName": "在团队中的职位（如：主审、执行、创意、测试）",
      "mission": "该角色的核心关键任务说明"
    }
  ],
  "leaderIndex": 0, // 哪一个agent应该担任组长
  "isTeam": true // 是否建议组建办公室
}

注意：
1. leaderIndex 指向 agents 数组中的索引。
2. 每个 agent 的 systemPrompt 必须足够强大，让它知道自己的职责。
3. 必须只输出JSON，不要有任何 Markdown 代码块包裹或多余文字。`;

    console.log('[SmartCreate] Calling modelsManager.chat...');
    const response = await modelsManager.chat({
      messages: [
        { role: 'system', content: systemPrompt }
      ]
    }, modelConfigId);

    const content = response.content || '';
    console.log('[SmartCreate] LLM response:', content);

    let parsedAgents: any[] = [];
    let officeName = '智能创建工作组';
    let leaderId: string | undefined = undefined;
    let agentRoles: Record<string, { position: string; mission: string }> = {};
    let isTeamRecommended = false;

    try {
      let cleaned = content.trim();

      // 移除可能存在的 Markdown 代码块
      cleaned = cleaned.replace(/```json\s?/g, '').replace(/```\s?/g, '').trim();

      const jsonStart = Math.min(
        cleaned.indexOf('{') === -1 ? Infinity : cleaned.indexOf('{'),
        cleaned.indexOf('[') === -1 ? Infinity : cleaned.indexOf('[')
      );
      const jsonEnd = Math.max(
        cleaned.lastIndexOf('}'),
        cleaned.lastIndexOf(']')
      );

      if (jsonStart !== Infinity && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }

      console.log('[SmartCreate] Cleaned content:', cleaned);

      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        parsedAgents = parsed;
        isTeamRecommended = parsed.length > 1;
      } else if (parsed.agents && Array.isArray(parsed.agents)) {
        parsedAgents = parsed.agents;
        officeName = parsed.officeName || officeName;
        isTeamRecommended = parsed.isTeam !== undefined ? parsed.isTeam : (parsedAgents.length > 1);

        // 提取角色信息和组长索引
        const leaderIdx = typeof parsed.leaderIndex === 'number' ? parsed.leaderIndex : -1;

        // 预处理角色信息，稍后在创建完 agent 后映射 ID
        parsedAgents.forEach((a, idx) => {
          if (idx === leaderIdx) a._isLeader = true;
          if (a.roleName || a.mission) {
            a._roleInfo = { position: a.roleName || '成员', mission: a.mission || '协作执行' };
          }
        });
      } else {
        parsedAgents = [parsed];
      }

      console.log('[SmartCreate] Parsed agents count:', parsedAgents.length);
    } catch (e) {
      console.error('[SmartCreate] Parse error:', e);
      parsedAgents = [{
        name: '智能助手',
        systemPrompt: prompt
      }];
    }

    const createdAgents = [];
    for (const agentData of parsedAgents) {
      const newAgent = agentService.createAgent({
        name: agentData.name || '智能体',
        systemPrompt: agentData.systemPrompt || prompt,
        permissionMode: 'normal'
      });
      createdAgents.push(newAgent);

      // 记录组长 ID
      if (agentData._isLeader) {
        leaderId = newAgent.id;
      }

      // 记录角色分配
      if (agentData._roleInfo) {
        agentRoles[newAgent.id] = agentData._roleInfo;
      }

      console.log('[SmartCreate] Created agent:', newAgent.name);
    }

    // 如果只有一个且没有被标记为组长，默认第一个是组长（如果需要组建办公室）
    if (createdAgents.length > 0 && !leaderId) {
      leaderId = createdAgents[0].id;
    }

    if (officeName !== '智能创建工作组' || parsedAgents.length > 0) {
      isTeamRecommended = isTeamRecommended || parsedAgents.length > 1;
    }

    if (isTeamRecommended && createdAgents.length > 0) {
      // Deduplicate agent IDs for safety
      const uniqueAgentIds = [...new Set(createdAgents.map(a => a.id))];

      try {
        const office = await officeService._createOffice({
          name: officeName,
          status: 'loafing',
          agentIds: uniqueAgentIds,
          leaderId: leaderId,
          agentRoles: Object.keys(agentRoles).length > 0 ? agentRoles : undefined
        });
        console.log('[SmartCreate] Created office:', office.name, 'with', createdAgents.length, 'agents');
        return res.json({ agents: createdAgents, office });
      } catch (officeErr) {
        console.error('[SmartCreate] Office creation failed:', officeErr);
        return res.json({ agents: createdAgents, officeError: (officeErr as Error).message });
      }
    } else {
      console.log('[SmartCreate] Created agents without office. Agents count:', createdAgents.length);
      return res.json({ agents: createdAgents });
    }
  } catch (error) {
    console.error('[SmartCreate] Unhandled error:', error);

    try {
      const { prompt } = req.body;
      const fallbackAgent = agentService.createAgent({
        name: '智能助手 (故障模式)',
        systemPrompt: prompt || '你是一个有帮助的AI助手。',
        permissionMode: 'normal'
      });
      console.log('[SmartCreate] Created fallback agent due to error');
      return res.json({ agents: [fallbackAgent], error: (error as Error).message });
    } catch (fallbackError) {
      console.error('[SmartCreate] Fallback creation failed:', fallbackError);
      res.status(500).json({ error: (error as Error).message });
    }
  }
});

router.post('/', async (req, res) => {
  try {
    const agent = agentService.createAgent(req.body);

    // Auto-provision Docker container if hardSandbox is enabled
    let dockerStatus: any = undefined;
    if (agent.hardSandboxEnabled) {
      try {
        const result = await dockerSandboxService.provisionForAgent(agent.id);
        dockerStatus = { status: result.status, containerId: result.containerId };
      } catch (err: any) {
        dockerStatus = { status: 'error', error: err.message };
        console.error(`[Agents] Docker provisioning failed for new agent ${agent.id}:`, err.message);
      }
    }

    res.json({ ...agent, dockerStatus });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const oldAgent = agentService.getAgent(req.params.id);
    const agent = agentService.updateAgent(req.params.id, req.body);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Handle Docker sandbox state changes
    let dockerStatus: any = undefined;
    const wasEnabled = oldAgent?.hardSandboxEnabled === true;
    const isEnabled = agent.hardSandboxEnabled === true;

    if (isEnabled && !wasEnabled) {
      // Newly enabled → provision
      try {
        const result = await dockerSandboxService.provisionForAgent(agent.id);
        dockerStatus = { status: result.status, containerId: result.containerId };
      } catch (err: any) {
        dockerStatus = { status: 'error', error: err.message };
        console.error(`[Agents] Docker provisioning failed for agent ${agent.id}:`, err.message);
      }
    } else if (!isEnabled && wasEnabled) {
      // Turned off → deprovision
      try {
        await dockerSandboxService.deprovisionForAgent(agent.id);
        dockerStatus = { status: 'removed' };
      } catch (err: any) {
        dockerStatus = { status: 'cleanup_error', error: err.message };
      }
    } else if (isEnabled && wasEnabled) {
      // Already enabled → check container status
      const containerStatus = await dockerSandboxService.getContainerStatus(agent.id);
      if (containerStatus === 'running') {
        dockerStatus = { status: 'already_running' };
      } else {
        // Container crashed/missing → re-provision
        try {
          const result = await dockerSandboxService.provisionForAgent(agent.id);
          dockerStatus = { status: result.status, containerId: result.containerId };
        } catch (err: any) {
          dockerStatus = { status: 'error', error: err.message };
        }
      }
    }

    res.json({ ...agent, dockerStatus });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    // Deprovision Docker container before deleting agent
    const agent = agentService.getAgent(req.params.id);
    if (agent?.hardSandboxEnabled) {
      try {
        await dockerSandboxService.deprovisionForAgent(req.params.id);
      } catch (err) {
        console.error(`[Agents] Docker cleanup failed for deleted agent ${req.params.id}:`, err);
      }
    }

    await agentService.deleteAgent(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:agentId/threads', async (req, res) => {
  try {
    const threads = agentService.getThreadsByAgent(req.params.agentId);
    const threadsWithCount = threads.map(t => ({
      id: t.id,
      agentId: t.agentId,
      title: t.title,
      source: t.source,
      messageCount: t.messages?.length || 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    res.json(threadsWithCount);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/threads', async (req, res) => {
  try {
    const thread = agentService.createThread(req.params.agentId, req.body.title);
    res.json(thread);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/send-message', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { content, channelId } = req.body;

    const bot = (req as any).botManager?.getAllBots().find((b: any) => b.agentId === agentId);
    if (!bot) {
      return res.status(404).json({ error: '该Agent没有关联任何机器人' });
    }

    if (!bot.enabled) {
      return res.status(400).json({ error: '关联的机器人未启用' });
    }

    const targetChannelId = channelId || Object.keys((req as any).botManager?.getConversationsByBot(bot.id) || {})[0];
    if (!targetChannelId) {
      return res.status(400).json({ error: '娌℃湁鍙敤鐨勫璇濋閬擄紝璇锋彁渚沜hannelId' });
    }

    const messageId = await (req as any).botManager?.sendMessage(bot.id, targetChannelId, content);
    res.json({
      success: true,
      messageId,
      platform: bot.platform,
      botName: bot.name,
      channelId: targetChannelId
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:agentId/memory/stats', async (req, res) => {
  try {
    const { agentId } = req.params;
    let stats = await agentMemoryManager.getAgentStatsAsync(agentId);
    if (!stats) {
      await agentMemoryManager.initAgentAsync(agentId);
      stats = await agentMemoryManager.getAgentStatsAsync(agentId);
    }
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:agentId/memory/key-info', (req, res) => {
  try {
    const { agentId } = req.params;
    const { query, limit = 10 } = req.query;
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:agentId/memory/config', async (req, res) => {
  try {
    const { agentId } = req.params;
    // First try to update existing config
    let config = await agentMemoryManager.updateAgentConfigAsync(agentId, req.body);
    if (!config) {
      // Agent not initialized yet 鈥?init first, then update
      await agentMemoryManager.initAgentAsync(agentId, req.body);
      config = await agentMemoryManager.getAgentConfigAsync(agentId);
    }
    if (!config) {
      return res.status(500).json({ error: 'Failed to initialize agent config' });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/memory/heartbeat/start', (req, res) => {
  try {
    const { agentId } = req.params;
    agentMemoryManager.startHeartbeat(agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/memory/heartbeat/stop', (req, res) => {
  try {
    const { agentId } = req.params;
    agentMemoryManager.stopHeartbeat(agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:agentId/memory', async (req, res) => {
  try {
    const { agentId } = req.params;
    await agentMemoryManager.clearAgentAsync(agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:agentId/memory/files', async (req, res) => {
  try {
    const { agentId } = req.params;
    const files = await agentMemoryManager.getAgentMemoryFilesAsync(agentId);
    res.json(files.map(f => ({
      id: f.id,
      filename: f.filename,
      size: f.size,
      type: f.type,
      embeddingStatus: f.embeddingStatus,
      embeddingError: f.embeddingError,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/memory/regenerate-embeddings', async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await agentMemoryManager.regenerateAllEmbeddings(agentId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/memory/files/:fileId/regenerate-embedding', async (req, res) => {
  try {
    const { fileId } = req.params;
    const success = await agentMemoryManager.regenerateEmbedding(fileId);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:agentId/memory/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await agentMemoryManager.getMemoryFileAsync(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/memory/files', async (req, res) => {
  try {
    const { agentId } = req.params;
    let { filename, content, type, base64Content, mimeType } = req.body;

    if (!filename || (!content && !base64Content)) {
      return res.status(400).json({ error: 'filename and either content or base64Content are required' });
    }

    // Process custom base64 file uploads using the knowledge service string extractor
    if (base64Content && mimeType && !content) {
      const { knowledgeService } = await import('../services/knowledge-service.js');
      const buffer = Buffer.from(base64Content, 'base64');
      content = await knowledgeService.extractContent(buffer, mimeType, filename);
    }

    const file = await agentMemoryManager.createMemoryFileAsync(agentId, filename, content, type || 'custom');
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:agentId/memory/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const file = await agentMemoryManager.updateMemoryFileAsync(fileId, content);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:agentId/memory/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const success = await agentMemoryManager.deleteMemoryFileAsync(fileId);
    if (!success) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:agentId/memory/context', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { query, maxTokens } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const context = await agentMemoryManager.getContextForAgent(agentId, query, maxTokens || 2000);
    res.json({ context });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as agentsRoutes };
