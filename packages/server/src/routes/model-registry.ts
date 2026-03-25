import express from 'express';
import { modelDatabase } from '../services/model-database.js';

const router = express.Router();

// Get the full model registry
// Full path: /api/models/registry
router.get('/registry', (req, res) => {
    try {
        const registry = modelDatabase.getRegistry();
        res.json(registry);
    } catch (error) {
        console.error('Failed to get registry:', error);
        res.status(500).json({ error: 'Failed to get model registry' });
    }
});

// Update the registry from the network
// Full path: /api/models/update
router.post('/update', async (req, res) => {
    try {
        const result = await modelDatabase.updateFromNetwork();
        res.json(result);
    } catch (error) {
        console.error('Failed to update registry:', error);
        res.status(500).json({ error: 'Failed to update model registry' });
    }
});

export { router as modelsRoutes };
