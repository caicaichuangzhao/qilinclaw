import express from 'express';
import { botManager } from '../bots/manager.js';

const router = express.Router();

router.post('/feishu/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'feishu') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/dingtalk/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'dingtalk') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookMessage) {
        adapter.handleWebhookMessage(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/wecom/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const { msg_signature, timestamp, nonce, echostr } = req.query;

    if (!msg_signature || !timestamp || !nonce || !echostr) {
      return res.status(400).send('Missing parameters');
    }

    const bot = botManager.getBot(botId);
    if (bot?.platform === 'wecom') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.verifyURL) {
        const decrypted = adapter.verifyURL(
          msg_signature as string,
          timestamp as string,
          nonce as string,
          echostr as string
        );
        if (decrypted) {
          return res.send(decrypted);
        } else {
          return res.status(403).send('Invalid signature');
        }
      }
    }
    return res.status(403).send('Forbidden');
  } catch (error) {
    console.error('[WeCom Webhook] Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/wecom/:botId', express.text({ type: ['text/xml', 'application/xml', 'text/plain'] }), async (req, res) => {
  try {
    const { botId } = req.params;
    const { msg_signature, timestamp, nonce } = req.query;

    const bot = botManager.getBot(botId);
    if (bot?.platform === 'wecom') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookRequest) {
        const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        adapter.handleWebhookRequest(
          bodyStr,
          msg_signature as string,
          timestamp as string,
          nonce as string
        );
      }
    }
    res.send('success');
  } catch (error) {
    console.error('[WeCom Webhook] Error:', error);
    res.status(500).send('error');
  }
});

router.get('/whatsapp/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const bot = botManager.getBot(botId);
    if (bot?.platform === 'whatsapp' && mode === 'subscribe') {
      const verifyToken = bot.config.verifyToken as string;
      if (token === verifyToken) {
        return res.send(challenge);
      }
    }
    res.sendStatus(403);
  } catch (error) {
    res.sendStatus(500);
  }
});

router.post('/whatsapp/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'whatsapp') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/slack/:botId', async (req, res) => {
  if (req.body?.type === 'url_verification') {
    return res.send(req.body.challenge);
  }
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'slack') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/line/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'line') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/messenger/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const bot = botManager.getBot(botId);
    if (bot?.platform === 'messenger' && mode === 'subscribe') {
      const verifyToken = bot.config.verifyToken as string;
      if (token === verifyToken) {
        return res.send(challenge);
      }
    }
    res.sendStatus(403);
  } catch (error) {
    res.sendStatus(500);
  }
});

router.post('/messenger/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'messenger') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// QQ is now handled via WebSocket only

// New Webhooks for Signal, iMessage, MS Teams, Google Chat, Mattermost
router.post('/signal/:botId', async (req, res) => {
  res.json({ success: true }); // Signal handles receiving via polling or its own local listener
});

router.post('/imessage/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'imessage') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/msteams/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'msteams') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/googlechat/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'googlechat') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/mattermost/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = botManager.getBot(botId);
    if (bot?.platform === 'mattermost') {
      const adapter = (botManager as any).adapters?.get(botId);
      if (adapter && adapter.handleWebhookEvent) {
        adapter.handleWebhookEvent(req.body);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as webhooksRoutes };
