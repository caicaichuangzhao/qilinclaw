import express from 'express';
import { imageService } from '../services/image-service.js';

const router = express.Router();

router.get('/configs', async (req, res) => {
  try {
    const configs = imageService.getAllConfigs();
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/configs', async (req, res) => {
  try {
    const config = imageService.addConfig(req.body);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/configs/:id', async (req, res) => {
  try {
    const config = imageService.updateConfig(req.params.id, req.body);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/configs/:id', async (req, res) => {
  try {
    const result = imageService.deleteConfig(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { configId, prompt, negativePrompt, size, steps, seed, cfgScale, style } = req.body;
    const result = await imageService.generateImage(configId, {
      prompt,
      negativePrompt,
      size,
      steps,
      seed,
      cfgScale,
      style,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const images = imageService.getAllImages();
    res.json(images);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const data = imageService.getImageData(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.set('Content-Type', 'image/png');
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = imageService.deleteImage(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as imageRoutes };
