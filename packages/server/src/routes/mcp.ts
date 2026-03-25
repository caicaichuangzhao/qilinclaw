import express from 'express';
import { mcpService } from '../services/mcp-service.js';

const router = express.Router();

router.get('/servers', async (req, res) => {
  try {
    const servers = mcpService.getAllServers();
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/servers/:id', async (req, res) => {
  try {
    const server = mcpService.getServer(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/servers', async (req, res) => {
  try {
    const server = mcpService.addServer(req.body);
    res.json(server);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/servers/:id', async (req, res) => {
  try {
    const server = mcpService.updateServer(req.params.id, req.body);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/servers/:id', async (req, res) => {
  try {
    const result = mcpService.deleteServer(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/servers/:id/start', async (req, res) => {
  try {
    const result = await mcpService.startServer(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/servers/:id/stop', async (req, res) => {
  try {
    const result = mcpService.stopServer(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/servers/:id/tools', async (req, res) => {
  try {
    const tools = await mcpService.listTools(req.params.id);
    res.json(tools);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/servers/:id/tools/:toolName', async (req, res) => {
  try {
    const result = await mcpService.callTool(req.params.id, req.params.toolName, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/servers/:id/resources', async (req, res) => {
  try {
    const resources = await mcpService.listResources(req.params.id);
    res.json(resources);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as mcpRoutes };
