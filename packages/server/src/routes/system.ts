import express from 'express';
import { safetyBackupService } from '../services/safety-backup.js';
import { systemHealthMonitor } from '../services/system-health.js';
import { errorRecoveryService } from '../safety/error-recovery.js';
import { healthCheckService } from '../services/health-check.js';
import { systemSafetyService } from '../services/system-safety.js';
import { diagnosticService } from '../services/diagnostic.js';
import { usageTracker } from '../services/usage-tracker.js';
import { databaseService } from '../services/database.js';
import { agentService } from '../services/agent-service.js';
import { knowledgeService } from '../services/knowledge-service.js';
import { fileSafetyService } from '../safety/file-safety.js';
import { smartMemory } from '../services/smart-memory.js';
import { botManager } from '../bots/manager.js';
import { systemUpdateService } from '../services/system-update.js';
import type { SafetyConfig } from '../types/index.js';

const router = express.Router();

router.get('/health', async (_req, res) => {
  try {
    const health = await systemHealthMonitor.runHealthChecks();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/system/stats', (_req, res) => {
  try {
    const stats = systemHealthMonitor.getStats();
    const memoryStats = smartMemory.getStats();
    res.json({
      ...stats,
      memory: memoryStats,
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/recover', async (req, res) => {
  try {
    const { reason = 'Manual recovery' } = req.body;
    const success = await systemHealthMonitor.manualRecovery(reason);
    res.json({ success, message: success ? '恢复成功' : '恢复失败' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/safety/backups', async (_req, res) => {
  try {
    const snapshots = await safetyBackupService.listSnapshots();
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/safety/backup', async (req, res) => {
  try {
    const { type = 'manual', description = '' } = req.body;
    const data = {
      agents: agentService.getAllAgents(),
      bots: databaseService.getAllBotConfigs(),
      llmConfigs: databaseService.getAllLLMConfigs(),
      knowledge: await knowledgeService.getAllKnowledgeBases(),
      safety: databaseService.getSafetyConfig(),
      memory: smartMemory.getStats(),
    };
    const snapshot = await safetyBackupService.createSnapshot(type, description, data);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/safety/restore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await safetyBackupService.restoreSnapshot(id);
    if (!data) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    for (const bot of (data.bots as any[]) || []) {
      databaseService.saveBotConfig(bot);
    }

    for (const config of (data.llmConfigs as any[]) || []) {
      databaseService.saveLLMConfig(config);
    }

    res.json({ success: true, message: '配置已恢复，请重启服务器以应用更改' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/safety/backups/:id', async (req, res) => {
  try {
    await safetyBackupService.deleteSnapshot(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/system-safety/backup', async (_req, res) => {
  try {
    const backup = systemSafetyService.getCurrentBackup();
    res.json(backup);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/system-safety/backup', async (req, res) => {
  try {
    const { type, description } = req.body;
    const backup = await systemSafetyService.createBackup(type || 'manual', description);
    res.json(backup);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/system-safety/restore', async (req, res) => {
  try {
    const { backupId } = req.body;
    const result = await systemSafetyService.restoreBackup(backupId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/system-safety/health', async (_req, res) => {
  try {
    const health = systemSafetyService.checkSystemHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/system-safety/schedule-recovery', async (req, res) => {
  try {
    const safetyConfig = databaseService.getSafetyConfig();
    const delayMs = req.body?.delayMs || safetyConfig.recoveryDelay || 10 * 60 * 1000;
    errorRecoveryService.scheduleRecovery(delayMs);
    res.json({ success: true, message: `Recovery scheduled in ${Math.round(delayMs / 60000)} minutes` });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/safety/config', async (req, res) => {
  try {
    const config = databaseService.getSafetyConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/safety/config', async (req, res) => {
  try {
    databaseService.updateSafetyConfig(req.body as Partial<SafetyConfig>);
    fileSafetyService.updateConfig(req.body);
    healthCheckService.updateConfig(req.body);

    if (req.body.autoRecoveryEnabled !== undefined) {
      errorRecoveryService.setAutoRecovery(req.body.autoRecoveryEnabled);
    }
    if (req.body.recoveryDelay) {
      errorRecoveryService.setRecoveryDelay(req.body.recoveryDelay);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/health', async (_req, res) => {
  try {
    const status = healthCheckService.getStatus();
    res.json({
      ...status,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/health/check', async (_req, res) => {
  try {
    const status = await healthCheckService.forceCheck();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/status', async (_req, res) => {
  try {
    const status = errorRecoveryService.getSystemStatus();
    status.activeBots = botManager.getRunningBots();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/diagnostics', async (req, res) => {
  try {
    const diagnostics = await diagnosticService.runAllChecks();
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/usage/stats', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? parseInt(startDate as string) : undefined;
    const end = endDate ? parseInt(endDate as string) : undefined;
    const stats = usageTracker.getStats(start, end);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/usage/recent', (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const records = usageTracker.getRecentRecords(parseInt(limit as string));
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/usage/clear', (req, res) => {
  try {
    const { olderThanDays = 90 } = req.body;
    const removed = usageTracker.clearOldRecords(olderThanDays);
    res.json({ success: true, removed });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/errors', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const errors = errorRecoveryService.getErrors(parseInt(limit as string));
    res.json(errors);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// -- GitHub Update --
router.post('/update/check', async (_req, res) => {
  try {
    const status = await systemUpdateService.checkUpdate();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/update/pull', async (_req, res) => {
  try {
    const status = await systemUpdateService.performUpdate();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as systemRoutes };
