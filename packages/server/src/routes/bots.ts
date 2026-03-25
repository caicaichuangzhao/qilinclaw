import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { botManager } from '../bots/manager.js';
import { databaseService } from '../services/database.js';
import type { BotConfig } from '../types/index.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const bots = botManager.getAllBots();
    const runningBots = botManager.getRunningBots();
    const result = bots.map(b => ({
      ...b,
      isRunning: runningBots.includes(b.id),
      lastError: botManager.getBotError(b.id) || null,
      statusData: botManager.getBotStatusData(b.id)
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? botManager['formatBotError'](error) : String(error) });
  }
});

router.get('/linked-agents', (_req, res) => {
  const bots = botManager.getAllBots().filter(b => b.agentId);
  const linkedAgents = bots.map(b => ({
    agentId: b.agentId,
    botId: b.id,
    botName: b.name,
    platform: b.platform,
  }));
  res.json(linkedAgents);
});

router.post('/', async (req, res) => {
  try {
    const { agentId } = req.body;

    if (agentId) {
      const existingBots = botManager.getAllBots().filter(b => b.agentId === agentId);
      if (existingBots.length > 0) {
        return res.status(400).json({
          error: `该Agent已被机器人"${existingBots[0].name}"关联，请选择其他Agent`
        });
      }
    }

    const config: BotConfig = {
      id: uuidv4(),
      ...req.body,
    };
    await botManager.addBot(config);
    databaseService.saveBotConfig(config);

    if (config.enabled) {
      try {
        await botManager.startBot(config.id);
        console.log(`[Bot] Auto-started: ${config.name} (${config.platform})`);
      } catch (startError) {
        console.error(`[Bot] Failed to auto-start ${config.name}:`, startError);
      }
    }

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId } = req.body;

    if (agentId) {
      const existingBots = botManager.getAllBots().filter(b => b.agentId === agentId && b.id !== id);
      if (existingBots.length > 0) {
        return res.status(400).json({
          error: `该Agent已被机器人"${existingBots[0].name}"关联，请选择其他Agent`
        });
      }
    }

    await botManager.updateBotConfig(id, req.body);
    const config = botManager.getBot(id);
    if (config) {
      databaseService.saveBotConfig(config);
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? botManager['formatBotError'](error) : String(error) });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await botManager.removeBot(id);
    databaseService.deleteBotConfig(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    // Set enabled = true before starting (stop route sets it to false)
    const config = botManager.getBot(id);
    if (config) {
      config.enabled = true;
      databaseService.saveBotConfig(config);
    }
    await botManager.startBot(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? botManager['formatBotError'](error) : String(error) });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    await botManager.stopBot(id);
    // Also set enabled = false so the UI shows "已停止" instead of "启动中..."
    const config = botManager.getBot(id);
    if (config) {
      config.enabled = false;
      databaseService.saveBotConfig(config);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    const { channelId, content } = req.body;
    const messageId = await botManager.sendMessage(req.params.id, channelId, content);
    res.json({ messageId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as botsRoutes };
