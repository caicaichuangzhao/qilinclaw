import { Client, GatewayIntentBits, Events, ChannelType, ActivityType, AttachmentBuilder } from 'discord.js';
import { BaseBotAdapter, BotMessage } from './base.js';
import { databaseService } from '../services/database.js';
import { ProxyAgent } from 'undici';
import type { BotConfig } from '../types/index.js';

export class DiscordAdapter extends BaseBotAdapter {
  readonly platform = 'discord' as const;
  private client: Client | null = null;
  private originalProxyEnv: string | undefined;

  constructor(config: BotConfig) {
    super(config);
  }

  async start(): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    const token = this.config.config.token as string;
    if (!token) {
      throw new Error('Discord token is required');
    }

    // Set up proxy for Discord.js
    const safetyConfig = databaseService.getSafetyConfig();
    let proxyAgent: ProxyAgent | undefined;

    if (safetyConfig.enableProxy && safetyConfig.proxyUrl) {
      try {
        proxyAgent = new ProxyAgent(safetyConfig.proxyUrl);
      } catch (e: any) {
        console.error(`[Discord Debug] ProxyAgent instantiation failed: ${e.message}`);
        throw e;
      }

      // Discord.js v14's underlying WebSocket relies on the standard `ws` package which doesn't
      // use Undici's Global Dispatcher. The best and officially recommended workaround
      // for Discord.js without overriding internal components is setting standard environment variables.
      // We set them temporarily before login.
      this.originalProxyEnv = process.env.HTTPS_PROXY || process.env.https_proxy;
      process.env.HTTPS_PROXY = safetyConfig.proxyUrl;
      process.env.https_proxy = safetyConfig.proxyUrl;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      rest: proxyAgent ? {
        agent: proxyAgent
      } : undefined
    });

    this.client.on(Events.MessageCreate, async (message) => {
      console.log(`[Discord adapter debug] received raw message from ${message.author.username}`);
      if (message.author.bot) {
        console.log(`[Discord adapter debug] ignoring bot message`);
        return;
      }

      const botMessage: BotMessage = {
        id: message.id,
        platform: 'discord',
        channelId: message.channelId,
        userId: message.author.id,
        username: message.author.username,
        content: message.content,
        timestamp: message.createdTimestamp,
        replyTo: message.reference?.messageId,
        attachments: message.attachments.map(a => ({
          type: a.contentType || 'unknown',
          url: a.url,
          name: a.name,
        })),
      };

      this.emitMessage(botMessage);
    });

    this.client.once(Events.ClientReady, () => {
      console.log(`[Discord] Client is ready for ${this.config.name}`);
      this.setRunning(true);
      if (this.client?.user) {
        this.client.user.setActivity('Ready to help!', { type: ActivityType.Watching });
      }
    });

    this.client.on(Events.Error, (error) => {
      this.emit('error', error);
    });

    this.client.on(Events.ShardDisconnect, () => {
      this.emit('disconnected');
    });

    try {
      console.log(`[Discord] Logging in ${this.config.name}...`);
      await this.client.login(token);
      console.log(`[Discord] Login successful for ${this.config.name}`);
      this.setRunning(true); // Fallback if ClientReady didn't fire yet
    } catch (e: any) {
      console.error(`[Discord] Login failed for ${this.config.name}:`, e.message);
      this.client = null;
      throw e;
    } finally {
      // Restore proxy environment variable to not affect other system parts unintentionally
      // though proxyManager already configures the main undici.
      if (proxyAgent) {
        if (this.originalProxyEnv) {
          process.env.HTTPS_PROXY = this.originalProxyEnv;
          process.env.https_proxy = this.originalProxyEnv;
        } else {
          delete process.env.HTTPS_PROXY;
          delete process.env.https_proxy;
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.setRunning(false);
  }

  async sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
    if (!this.client) {
      throw new Error('Discord client not initialized');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type === ChannelType.GuildCategory) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if ('send' in channel) {
      let files: AttachmentBuilder[] = [];
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (attachment.dataUrl && attachment.dataUrl.startsWith('data:')) {
            const base64Data = attachment.dataUrl.split(',')[1];
            if (base64Data) {
              const buffer = Buffer.from(base64Data, 'base64');
              files.push(new AttachmentBuilder(buffer, { name: attachment.name || 'attachment.png' }));
            }
          } else if (attachment.dataUrl) {
            files.push(new AttachmentBuilder(attachment.dataUrl, { name: attachment.name || 'attachment' }));
          }
        }
      }

      const message = await channel.send({ content: content || ' ', files });
      return message.id;
    }

    throw new Error(`Cannot send message to channel: ${channelId}`);
  }

  async sendTyping(channelId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Discord client not initialized');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (channel && 'sendTyping' in channel) {
      await channel.sendTyping();
    }
  }
}
