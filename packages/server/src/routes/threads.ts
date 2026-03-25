import express from 'express';
import { agentService } from '../services/agent-service.js';
import { fileSafetyService } from '../safety/file-safety.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const threadsWithAgentData = agentService.getAllThreads();
    res.json(threadsWithAgentData);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const thread = agentService.getThread(req.params.id);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.json(thread);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const thread = agentService.updateThread(req.params.id, req.body);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.json(thread);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await agentService.deleteThread(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:id/messages', async (req, res) => {
  try {
    const { role, content, timestamp } = req.body;
    const thread = agentService.addMessageToThread(req.params.id, { role, content, timestamp });
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.json(thread);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Recall messages from a given index and roll back associated file changes
router.post('/:id/recall', async (req, res) => {
  try {
    const thread = agentService.getThread(req.params.id);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const { fromIndex } = req.body;
    if (typeof fromIndex !== 'number' || fromIndex < 0 || fromIndex >= thread.messages.length) {
      return res.status(400).json({ error: 'Invalid fromIndex' });
    }

    // Get the timestamp of the first recalled message to scope file rollback
    const recallTimestamp = thread.messages[fromIndex].timestamp;

    // Roll back file backups created during this conversation after recallTimestamp
    const rollbackResult = await fileSafetyService.restoreBackupsByConversation(req.params.id, recallTimestamp);

    // Truncate messages
    thread.messages.splice(fromIndex);
    agentService.updateThread(req.params.id, { messages: thread.messages });

    // Clear vector memory for this conversation
    try {
      const { contextMemory } = await import('../services/context-memory.js');
      await contextMemory.clearConversation(req.params.id);
    } catch (error) {
      console.error('[Recall] Failed to clear vector memory:', error);
    }

    console.log(`[Recall] Thread ${req.params.id}: recalled from index ${fromIndex}, restored ${rollbackResult.restored.length} files`);

    res.json({
      success: true,
      rolledBackFiles: rollbackResult.restored,
      failedFiles: rollbackResult.failed,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as threadsRoutes };
