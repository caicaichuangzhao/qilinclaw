import AiBot from '@wecom/aibot-node-sdk';
import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class WeComAdapter extends BaseBotAdapter {
  readonly platform = 'wecom' as const;
  private botId: string;
  private secret: string;
  private botClient: InstanceType<typeof AiBot.WSClient> | null = null;

  constructor(config: BotConfig) {
    super(config);
    // Backward compatibility: If the new fields are missing, try old ones
    this.botId = (config.config.botId as string) || (config.config.corpId as string) || '';
    this.secret = (config.config.botSecret as string) || (config.config.secret as string) || '';
  }

  async start(): Promise<void> {
    if (!this.botId || !this.secret) {
      console.warn(`[WeCom] Missing Bot ID or Secret for bot ${this.config.name}`);
      return;
    }

    // The following log statements from the instruction seem to be from a higher-level bot manager
    // and refer to variables (config, botId, message) not directly available in this scope.
    // They are omitted to maintain syntactic correctness and scope integrity.
    // if (!config || !config.enabled) {
    //   console.warn(`[BotMgr] Bot ${botId} not found or disabled. Config: ${JSON.stringify(config)}`);
    //   return;
    // }
    // console.log(`[BotMgr] Authorized message from ${message.username} on ${message.platform}`);

    try {
      console.log(`[WeCom] Starting WebSocket connection for bot ${this.config.name}...`);

      this.botClient = new AiBot.WSClient({
        botId: this.botId,
        secret: this.secret,
      });

      // Catch-all listener for debugging all incoming data
      this.botClient.on('message', (frame: any) => {
        console.log(`[WeCom] Received raw frame: ${JSON.stringify(frame)}`);
      });

      this.botClient.on('event', (frame: any) => {
        console.log(`[WeCom] Received raw event: ${JSON.stringify(frame)}`);
      });

      // Register text message listener
      this.botClient.on('message.text', (frame: any) => {
        try {
          const body = frame.body;
          if (body && body.from && body.from.userid && body.text?.content) {
            console.log(`[WeCom] Received message from ${body.from.userid}: ${body.text.content}`);
            const botMessage: BotMessage = {
              id: body.msgid || Date.now().toString(),
              platform: 'wecom',
              channelId: body.from.userid,
              userId: body.from.userid,
              username: body.from.userid,
              content: body.text.content,
              timestamp: body.create_time ? body.create_time * 1000 : Date.now(),
            };

            this.emitMessage(botMessage);
          } else {
            console.log(`[WeCom] Received message but ignored: ${JSON.stringify(body)}`);
          }
        } catch (e) {
          console.error('[WeCom] Handle message request error:', e);
        }
      });

      // Register event listener (e.g., when a user opens the chat)
      this.botClient.on('event.enter_chat', (frame: any) => {
        const body = frame.body;
        if (body && body.from && body.from.userid) {
          console.log(`[WeCom] User ${body.from.userid} entered chat with bot ${this.config.name}`);
        }
      });

      this.botClient.on('authenticated', () => {
        console.log(`[WeCom] WebSocket authenticated for bot ${this.config.name} 🔐`);
        this.setRunning(true);
      });

      // Start the WebSocket connection
      this.botClient.connect();
    } catch (e) {
      console.error(`[WeCom] Failed to start WebSocket connection:`, e);
      this.emit('error', new Error(`WeCom WebSocket connect failed: ${(e as Error).message}`));
    }
  }

  async stop(): Promise<void> {
    if (this.botClient) {
      try {
        this.botClient.disconnect();
      } catch (e) {
        console.error('[WeCom] Error stopping WebSocket client:', e);
      }
      this.botClient = null;
    }
    this.setRunning(false);
  }

  async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
    if (!this.botClient) {
      throw new Error(`WeCom WebSocket client is not initialized for bot ${this.config.name}`);
    }

    try {
      await this.botClient.sendMessage(channelId, {
        msgtype: 'markdown',
        markdown: { content: content }
      });
      return Date.now().toString();
    } catch (e) {
      console.error('[WeCom] Send error:', e);
      throw new Error(`Failed to send WeCom message: ${(e as Error).message}`);
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    // WeCom doesn't support typing indicators natively
  }
}
