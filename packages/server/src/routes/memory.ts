import express from 'express';
import { smartMemory } from '../services/smart-memory.js';
import { agentMemoryManager } from '../services/agent-memory.js';
import { contextMemory } from '../services/context-memory.js';
import { vectorStore } from '../services/vector-store.js';
import { embeddingService } from '../services/embedding-service.js';

const router = express.Router();

router.get('/stats', async (req, res) => {
  try {
    const stats = contextMemory.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/key-info', (req, res) => {
  try {
    const { query, limit = 10 } = req.query;
    const keyInfo = smartMemory.getRelevantKeyInfo(query as string, parseInt(limit as string));
    res.json(keyInfo);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/process', async (req, res) => {
  try {
    const { message, role, conversationId } = req.body;
    await smartMemory.processMessage(message, role, conversationId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/compress', async (_req, res) => {
  try {
    await smartMemory.compressMemories();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/agents/stats', async (_req, res) => {
  try {
    const allStats = await agentMemoryManager.getAllStatsAsync();
    res.json(allStats);
  } catch (error) {
    console.error('[Memory] Failed to get agent stats:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/conversation/:id', async (req, res) => {
  try {
    const stats = contextMemory.getConversationStats(req.params.id);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/conversation/:id', async (req, res) => {
  try {
    contextMemory.clearConversation(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { query, limit = 10, threshold = 0.15 } = req.body;
    console.log(`[MemorySearch] Searching for: "${query}" with threshold ${threshold}`);
    const results = await contextMemory.searchAcrossConversations(query, limit, threshold);
    console.log(`[MemorySearch] Found ${results.length} results`);
    const formattedResults = results.map(r => ({
      content: r.entry.content,
      source: '对话记录',
      similarity: r.similarity,
      conversationId: r.entry.metadata.conversationId,
      role: r.entry.metadata.role,
      timestamp: r.entry.metadata.timestamp,
    }));
    res.json(formattedResults);
  } catch (error) {
    console.error('[MemorySearch] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = contextMemory.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/config', async (req, res) => {
  try {
    contextMemory.setConfig(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/entries', async (req, res) => {
  try {
    const entries = vectorStore.getAllEntries();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const metas = vectorStore.getAllConversationMetas();
    res.json(metas);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/conversations/:id/title', async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    vectorStore.updateConversationTitle(id, title);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/summaries', async (req, res) => {
  try {
    const summaries = vectorStore.getAllSummaries();
    res.json(summaries);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    vectorStore.deleteEntry(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/clear', async (req, res) => {
  try {
    vectorStore.clear();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});



router.get('/embedding/config', async (req, res) => {
  try {
    const config = embeddingService.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/embedding/config', async (req, res) => {
  try {
    embeddingService.setConfig(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/embedding/status', async (req, res) => {
  try {
    const status = embeddingService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/embedding/test', async (req, res) => {
  try {
    const result = await embeddingService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/embedding/cache/clear', async (req, res) => {
  try {
    embeddingService.clearCache();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/embedding/local-models', async (req, res) => {
  try {
    const models = embeddingService.listLocalModels();
    const modelsPath = embeddingService.getLocalModelsPath();
    res.json({
      modelsPath,
      models,
      count: models.length
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/embedding/local-models/load', async (req, res) => {
  try {
    const { modelPath } = req.body;
    if (!modelPath) {
      return res.status(400).json({ error: 'modelPath is required' });
    }

    const success = await embeddingService.loadLocalModel(modelPath);
    if (success) {
      res.json({ success: true, message: 'Local model loaded successfully' });
    } else {
      res.status(500).json({ error: 'Failed to load local model' });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/embedding/local-models/unload', async (req, res) => {
  try {
    embeddingService.unloadLocalModel();
    res.json({ success: true, message: 'Local model unloaded' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as memoryRoutes };
