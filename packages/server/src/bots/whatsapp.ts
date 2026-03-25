import { Client, LocalAuth, Events } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

function debugLog(msg: string) {
  const logPath = path.resolve(process.cwd(), '.qilin-claw/debug.log');
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
}

export class WhatsAppAdapter extends BaseBotAdapter {
  readonly platform = 'whatsapp' as const;
  private client: Client | null = null;
  private qrCode: string | null = null;
  private recentlySentBodies = new Set<string>();

  constructor(config: BotConfig) {
    super(config);
  }

  async start(): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    console.log(`[WhatsApp] Starting adapter for ${this.config.name}...`);

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.config.id,
        dataPath: '.qilin-claw/whatsapp-sessions'
      }),
      puppeteer: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        headless: true
      }
    });

    this.client.on(Events.QR_RECEIVED, async (qr) => {
      debugLog(`[WhatsApp:${this.config.name}] QR received`);
      try {
        this.qrCode = await QRCode.toDataURL(qr);
      } catch (err) {
        debugLog(`[WhatsApp:${this.config.name}] QR generation error: ${err}`);
        console.error('[WhatsApp] QR generation error:', err);
      }
    });

    this.client.on(Events.READY, () => {
      debugLog(`[WhatsApp:${this.config.name}] Ready`);
      console.log(`[WhatsApp] Ready for ${this.config.name}`);
      this.qrCode = null;
      this.setRunning(true);
    });

    this.client.on(Events.AUTHENTICATED, () => {
      debugLog(`[WhatsApp:${this.config.name}] Authenticated`);
      console.log(`[WhatsApp] Authenticated for ${this.config.name}`);
    });

    this.client.on(Events.AUTHENTICATION_FAILURE, (msg) => {
      debugLog(`[WhatsApp:${this.config.name}] Auth failure: ${msg}`);
      console.error(`[WhatsApp] Auth failure for ${this.config.name}:`, msg);
      this.emit('error', new Error(`WhatsApp Auth failure: ${msg}`));
    });

    this.client.on(Events.DISCONNECTED, (reason) => {
      debugLog(`[WhatsApp:${this.config.name}] Disconnected: ${reason}`);
      console.warn(`[WhatsApp] Disconnected for ${this.config.name}:`, reason);
      this.emit('error', new Error(`WhatsApp Disconnected: ${reason || 'Unknown reason'}`));
      this.stop(); // Force teardown
    });

    this.client.on('message', (msg) => {
      debugLog(`[WhatsApp:${this.config.name}] Received 'message': from=${msg.from}, body=${msg.body}`);
      this.processMessage(msg);
    });

    this.client.on('message_create', (msg) => {
      debugLog(`[WhatsApp:${this.config.name}] Received 'message_create': from=${msg.from}, to=${msg.to}, fromMe=${msg.fromMe}, body=${msg.body}`);
      if (msg.fromMe && msg.type === 'chat') {
        debugLog(`[WhatsApp:${this.config.name}] Self-chat detected`);
        this.processMessage(msg);
      }
    });

    await this.initializeWithRetry();
  }

  private async initializeWithRetry(attempts = 3): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        debugLog(`[WhatsApp:${this.config.name}] Initializing client (attempt ${i + 1})...`);
        if (!this.client) return;
        await Promise.race([
          this.client.initialize(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('WhatsApp initialize timed out after 60 seconds')), 60000))
        ]);
        return;
      } catch (error) {
        debugLog(`[WhatsApp:${this.config.name}] Initialize error (attempt ${i + 1}): ${error}`);
        if (i === attempts - 1) {
          this.emit('error', error as Error);
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async processMessage(msg: any): Promise<void> {
    console.log(`[WhatsApp Debug] processMessage called for:`, { from: msg.from, to: msg.to, body: msg.body, type: msg.type, fromMe: msg.fromMe });
    if (msg.from === 'status@broadcast') return;

    // Accept text messages and extended text messages (replies/forwarded)
    if (msg.type !== 'chat' && msg.type !== 'text' && msg.type !== 'extended_text') {
      console.log(`[WhatsApp Debug] Ignoring message of type: ${msg.type}`);
      return;
    }

    // Determine the actual conversational channel (the remote user or group)
    const channelId = msg.fromMe ? msg.to : msg.from;

    // Loop prevention for our own bot replies
    if (msg.fromMe && this.recentlySentBodies.has(msg.body)) {
      debugLog(`[WhatsApp:${this.config.name}] Loop prevention: ignoring own reply`);
      this.recentlySentBodies.delete(msg.body);
      return;
    }

    const botMessage: BotMessage = {
      id: msg.id?.id || String(Date.now()),
      platform: 'whatsapp',
      channelId: channelId,
      userId: msg.author || msg.from, // Who actually sent the message
      username: msg.author || msg.from,
      content: msg.body || '',
      timestamp: (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000,
    };

    debugLog(`[WhatsApp:${this.config.name}] Emitting to manager: ${botMessage.content} on channel ${botMessage.channelId}`);
    this.emitMessage(botMessage);
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (e) {
        console.error('[WhatsApp] Destroy error:', e);
      }
      this.client = null;
    }
    this.qrCode = null;
    this.setRunning(false);
  }

  getStatusData(): Record<string, any> {
    return {
      qrCode: this.qrCode
    };
  }

  async sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
    if (!this.client) {
      throw new Error('WhatsApp client not initialized');
    }

    try {
      this.recentlySentBodies.add(content);
      // Automatically clean up after 10 seconds if it wasn't caught by message_create
      setTimeout(() => this.recentlySentBodies.delete(content), 10000);

      const msg = await this.client.sendMessage(channelId, content);
      return msg.id.id;
    } catch (e) {
      console.error('[WhatsApp] Send error:', e);
      return '';
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    // Unsupported by whatsapp-web.js easily without chat context
  }
}
