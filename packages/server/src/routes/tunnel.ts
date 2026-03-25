import express from 'express';
import { tunnelService } from '../services/tunnel-service.js';

export const tunnelRoutes = express.Router();

tunnelRoutes.get('/status', (req, res) => {
  try {
    const status = tunnelService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

tunnelRoutes.post('/start', async (req, res) => {
  try {
    const { provider, subdomain, authToken } = req.body;
    const port = parseInt(process.env.PORT || '3000', 10);
    const status = await tunnelService.start({
      provider: provider,
      localPort: port,
      subdomain,
      authToken
    });
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

tunnelRoutes.post('/stop', async (req, res) => {
  try {
    await tunnelService.stop();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
