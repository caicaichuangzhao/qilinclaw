import express from 'express';
import { fileService } from '../services/file-service.js';
import { fileSafetyService } from '../safety/file-safety.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { path: dirPath = '' } = req.query;
    const files = await fileService.listFiles(dirPath as string);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/download', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).send('Missing path');
    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/*', async (req, res) => {
  try {
    const filePath = (req.params as any)[0];
    const result = await fileService.readFile(filePath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/*', async (req, res) => {
  try {
    const filePath = (req.params as any)[0];
    const { content, operation } = req.body;
    await fileService.writeFile({ path: filePath, content }, operation);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    await fileService.createFile(filePath, content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/*', async (req, res) => {
  try {
    const filePath = (req.params as any)[0];
    await fileService.deleteFile(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { query, inContent } = req.body;
    const results = inContent
      ? await fileService.searchInFiles(query)
      : await fileService.searchFiles(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/backups', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    const backups = filePath
      ? fileSafetyService.getBackups(filePath as string)
      : Object.fromEntries(fileSafetyService.getAllBackups());
    res.json(backups);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/backups/:id/restore', async (req, res) => {
  try {
    const success = fileSafetyService.restoreBackup(req.params.id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/backups/:id', async (req, res) => {
  try {
    const success = fileSafetyService.deleteBackup(req.params.id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as filesRoutes };
