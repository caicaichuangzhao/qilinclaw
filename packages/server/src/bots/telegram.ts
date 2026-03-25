import { Telegraf } from 'telegraf';
import { databaseService } from '../services/database.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_DELAY = 60000; // 60 seconds

export class TelegramAdapter extends BaseBotAdapter {
  readonly platform = 'telegram' as const;
  private bot: Telegraf | null = null;
  private intentionallyStopped = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: BotConfig) {
    super(config);
  }

  async start(): Promise<void> {
    if (this.bot) {
      await this.stop();
    }

    this.intentionallyStopped = false;
    this.reconnectAttempts = 0;

    await this.doLaunch();
  }

  /**
   * Core launch logic — called both on initial start and on reconnect attempts.
   */
  private async doLaunch(): Promise<void> {
    const token = this.config.config.token as string;
    if (!token) {
      throw new Error('Telegram token is required');
    }

    const safetyConfig = databaseService.getSafetyConfig();

    // Build Telegraf options — pass proxy agent for Telegraf's internal HTTP calls.
    // ProxyManager already sets the undici global dispatcher at server startup.
    const telegrafOptions: any = {};
    if (safetyConfig.enableProxy && safetyConfig.proxyUrl) {
      const agent = new HttpsProxyAgent(safetyConfig.proxyUrl);
      telegrafOptions.telegram = { agent };
      process.env.HTTPS_PROXY = safetyConfig.proxyUrl;
      process.env.https_proxy = safetyConfig.proxyUrl;
      console.log(`[Telegram] Proxy enabled for ${this.config.name}: ${safetyConfig.proxyUrl}`);
    }

    this.bot = new Telegraf(token, telegrafOptions);

    this.bot.on('message', (ctx) => {
      const message = ctx.message;
      console.log(`[Telegram adapter debug] received raw message from ${message.from?.username || 'unknown'}`);
      if (!('text' in message)) {
        console.log(`[Telegram adapter debug] ignoring non-text message`);
        return;
      }

      const botMessage: BotMessage = {
        id: String(message.message_id),
        platform: 'telegram',
        channelId: String(message.chat.id),
        userId: String(message.from?.id || message.chat.id),
        username: message.from?.username || message.from?.first_name || 'Unknown',
        content: message.text,
        timestamp: message.date * 1000,
        replyTo: 'reply_to_message' in message && message.reply_to_message ? String(message.reply_to_message.message_id) : undefined,
      };

      this.emitMessage(botMessage);
    });

    this.bot.on('channel_post', (ctx) => {
      const message = ctx.channelPost;
      console.log(`[Telegram adapter debug] received raw channel post from channel ${message.chat.title || message.chat.id}`);
      if (!('text' in message)) {
        console.log(`[Telegram adapter debug] ignoring non-text channel post`);
        return;
      }

      const botMessage: BotMessage = {
        id: String(message.message_id),
        platform: 'telegram',
        channelId: String(message.chat.id),
        userId: String(message.chat.id), // Channels don't have a specific user sender
        username: message.chat.title || 'Channel',
        content: message.text,
        timestamp: message.date * 1000,
        replyTo: 'reply_to_message' in message && message.reply_to_message ? String(message.reply_to_message.message_id) : undefined,
      };

      this.emitMessage(botMessage);
    });

    // When Telegraf's internal error handler fires, it means the polling loop crashed.
    // We intercept this to trigger auto-reconnection instead of letting the process crash.
    this.bot.catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Telegram] Bot error for ${this.config.name}:`, error.message);
      this.emit('error', error);

      // Trigger reconnection if not intentionally stopped
      if (!this.intentionallyStopped) {
        this.scheduleReconnect();
      }
    });

    // Fire-and-forget: don't await launch. Message handlers are already registered.
    // Telegraf will connect in the background when the proxy is available.
    console.log(`[Telegram] Launching ${this.config.name} (attempt ${this.reconnectAttempts + 1})...`);
    this.setRunning(true); // Mark as running immediately — handlers are ready

    this.bot.launch({ dropPendingUpdates: true })
      .then(() => {
        console.log(`[Telegram] Launch successful for ${this.config.name}`);
        this.reconnectAttempts = 0;
        this.monitorPolling();
      })
      .catch((e: any) => {
        console.error(`[Telegram] Launch failed for ${this.config.name}:`, e.message);
        if (this.bot) {
          try { this.bot.stop(); } catch { /* ignore */ }
        }
        this.bot = null;
        this.setRunning(false);

        if (!this.intentionallyStopped) {
          this.emit('error', e instanceof Error ? e : new Error(String(e)));
          this.scheduleReconnect();
        }
      });
  }

  /**
   * Monitor the polling loop. When it exits (due to network error), trigger reconnection.
   */
  private monitorPolling(): void {
    if (!this.bot) return;

    // Telegraf stores the polling instance internally — we can check if it's still alive
    // by periodically calling getMe as a heartbeat. If it fails, reconnect.
    const heartbeatInterval = setInterval(async () => {
      if (this.intentionallyStopped || !this.bot) {
        clearInterval(heartbeatInterval);
        return;
      }

      try {
        await Promise.race([
          this.bot.telegram.getMe(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Heartbeat timeout')), 15000))
        ]);
      } catch (e: any) {
        console.warn(`[Telegram] Heartbeat failed for ${this.config.name}: ${e.message}`);
        clearInterval(heartbeatInterval);

        if (!this.intentionallyStopped) {
          this.emit('error', new Error(`Connection lost: ${e.message}`));
          this.scheduleReconnect();
        }
      }
    }, 60000); // Check every 60 seconds
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.intentionallyStopped) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[Telegram] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached for ${this.config.name}. Giving up.`);
      this.emit('error', new Error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`));
      this.setRunning(false);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    console.log(`[Telegram] Scheduling reconnect for ${this.config.name} in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Clean up old bot instance
    if (this.bot) {
      try { this.bot.stop(); } catch { /* ignore */ }
      this.bot = null;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.intentionallyStopped) return;

      try {
        console.log(`[Telegram] Reconnecting ${this.config.name}...`);
        await this.doLaunch();
      } catch (e: any) {
        console.error(`[Telegram] Reconnect failed for ${this.config.name}:`, e.message);
        // doLaunch will call scheduleReconnect again if needed
      }
    }, delay);
  }

  async stop(): Promise<void> {
    this.intentionallyStopped = true;

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.bot) {
      try {
        this.bot.stop();
      } catch {
        // Telegraf throws "Bot is not running!" if never launched — safe to ignore
      }
      this.bot = null;
    }
    this.setRunning(false);
  }

  async sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }

    const chatId = parseInt(channelId, 10);

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        try {
          if (attachment.dataUrl && attachment.dataUrl.startsWith('data:')) {
            const base64Data = attachment.dataUrl.split(',')[1];
            if (base64Data) {
              const buffer = Buffer.from(base64Data, 'base64');
              if (attachment.type.startsWith('image/')) {
                await this.bot.telegram.sendPhoto(chatId, { source: buffer, filename: attachment.name || 'image.png' });
              } else {
                await this.bot.telegram.sendDocument(chatId, { source: buffer, filename: attachment.name || 'file' });
              }
            }
          } else if (attachment.dataUrl) {
            if (attachment.type.startsWith('image/')) {
              await this.bot.telegram.sendPhoto(chatId, attachment.dataUrl);
            } else {
              await this.bot.telegram.sendDocument(chatId, attachment.dataUrl);
            }
          }
        } catch (e: any) {
          console.error(`[Telegram] Failed to send attachment:`, e.message);
        }
      }
    }

    if (content && content.trim() !== '') {
      try {
        const message = await this.bot.telegram.sendMessage(chatId, content, {
          parse_mode: 'Markdown',
        });
        return String(message.message_id);
      } catch (markdownErr: any) {
        // Markdown parse errors (400) — retry as plain text
        console.warn(`[Telegram] Markdown send failed, retrying as plain text: ${markdownErr.message}`);
        const message = await this.bot.telegram.sendMessage(chatId, content);
        return String(message.message_id);
      }
    }

    return 'media-only';
  }

  async sendTyping(channelId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }

    const chatId = parseInt(channelId, 10);
    await this.bot.telegram.sendChatAction(chatId, 'typing');
  }
}
