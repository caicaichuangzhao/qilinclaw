import express from 'express';
import { knowledgeService } from '../services/knowledge-service.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const knowledgeBases = await knowledgeService.getAllKnowledgeBases();
    const results = [];
    for (const kb of knowledgeBases) {
      try {
        const docs = await knowledgeService.getDocumentsForKnowledgeBase(kb.id);
        results.push({ ...kb, documents: docs });
      } catch (docError) {
        console.error(`[Knowledge] Failed to load documents for KB ${kb.id}:`, docError);
        results.push({ ...kb, documents: [] });
      }
    }
    res.json(results);
  } catch (error) {
    console.error('[Knowledge] Failed to load knowledge bases:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    const kb = await knowledgeService.createKnowledgeBase(name, description);
    res.json(kb);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const kb = await knowledgeService.getKnowledgeBase(req.params.id);
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    (kb as any).documents = await knowledgeService.getDocumentsForKnowledgeBase(kb.id);
    res.json(kb);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const kb = await knowledgeService.updateKnowledgeBase(req.params.id, req.body);
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    res.json(kb);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await knowledgeService.deleteKnowledgeBase(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:id/documents', async (req, res) => {
  try {
    const { filename, content, mimeType, tags, source } = req.body;

    console.log(`[KnowledgeRoute] Received file upload: ${filename}, content length: ${content?.length || 0}, mimeType: ${mimeType}`);
    const buffer = Buffer.from(content, 'base64');
    console.log(`[KnowledgeRoute] Decoded buffer length: ${buffer.length} bytes`);

    const doc = await knowledgeService.addDocument(req.params.id, {
      originalname: filename,
      mimetype: mimeType || 'text/plain',
      size: buffer.length,
      buffer,
    }, { tags, source });

    res.json(doc);
  } catch (error) {
    console.error('[KnowledgeRoute] Error uploading file:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id/documents', async (req, res) => {
  try {
    const kb = await knowledgeService.getKnowledgeBase(req.params.id);
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    const documents = await knowledgeService.getDocumentsForKnowledgeBase(req.params.id);
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:kbId/documents/:docId/content', async (req, res) => {
  try {
    const doc = await knowledgeService.getDocument(req.params.docId);
    if (!doc || doc.knowledgeBaseId !== req.params.kbId) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({ content: doc.content });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:kbId/documents/:docId', async (req, res) => {
  try {
    const result = await knowledgeService.deleteDocument(req.params.docId);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.patch('/:kbId/documents/:docId/metadata', async (req, res) => {
  try {
    const result = await knowledgeService.updateDocumentMetadata(req.params.docId, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:kbId/documents/:docId/regenerate-embeddings', async (req, res) => {
  try {
    const result = await knowledgeService.regenerateDocumentEmbeddings(req.params.docId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:kbId/regenerate-embeddings', async (req, res) => {
  try {
    const result = await knowledgeService.regenerateKnowledgeBaseEmbeddings(req.params.kbId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:kbId/embedding-status', async (req, res) => {
  try {
    const status = await knowledgeService.getKnowledgeBaseEmbeddingStatus(req.params.kbId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { query, knowledgeBaseId, limit, threshold } = req.body;
    console.log(`[KnowledgeSearch] Searching for: "${query}"`);
    const results = await knowledgeService.search(query, {
      knowledgeBaseId,
      limit: limit || 10,
      threshold: threshold || 0.15,
    });
    console.log(`[KnowledgeSearch] Found ${results.length} results`);
    const formattedResults = results.map(r => ({
      content: r.chunk.content,
      source: r.document.originalName,
      similarity: r.similarity,
      documentId: r.document.id,
      chunkId: r.chunk.id,
    }));
    res.json(formattedResults);
  } catch (error) {
    console.error('[KnowledgeSearch] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as knowledgeRoutes };
