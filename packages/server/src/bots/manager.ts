import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import type { BotConfig, BotPlatform, ChatMessage, ConversationContext } from '../types/index.js';
import type { BotAdapter, BotMessage } from './base.js';
import { DiscordAdapter } from './discord.js';
import { TelegramAdapter } from './telegram.js';
import { FeishuAdapter } from './feishu.js';
import { DingTalkAdapter } from './dingtalk.js';
import { WeComAdapter } from './wecom.js';
import { WhatsAppAdapter } from './whatsapp.js';
import { SlackAdapter } from './slack.js';
import { LineAdapter } from './line.js';
import { MessengerAdapter } from './messenger.js';
import { QQAdapter } from './qq.js';
import { SignalAdapter } from './signal.js';
import { IMessageAdapter } from './imessage.js';
import { MsTeamsAdapter } from './msteams.js';
import { GoogleChatAdapter } from './googlechat.js';
import { MattermostAdapter } from './mattermost.js';
import { modelsManager } from '../models/manager.js';
import { rateLimiter } from '../safety/rate-limiter.js';
import { agentService } from '../services/agent-service.js';
import { ChatOrchestrator } from '../services/chat-orchestrator.js';

function debugLog(msg: string) {
  const logPath = path.resolve(process.cwd(), '.qilin-claw/debug.log');
  const timestamp = new Date().toISOString();
  try {
    if (!fs.existsSync(path.dirname(logPath))) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
    }
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  } catch (e) {
    // ignore
  }
}

export class BotManager extends EventEmitter {
  private configs: Map<string, BotConfig> = new Map();
  private adapters: Map<string, BotAdapter> = new Map();
  private conversations: Map<string, ConversationContext> = new Map();
  private botErrors: Map<string, string> = new Map();
  private maxConversationLength = 50;

  constructor() {
    super();
    // Catch-all to prevent unhandled 'error' event crashes in Node.js
    this.on('error', (err) => {
      console.error('[BotManager] Internal error event caught:', err.error?.message || err.message || err);
    });
  }

  private setupAdapterListeners(adapter: BotAdapter, botId: string): void {
    adapter.on('message', async (message: BotMessage) => {
      try {
        await this.handleMessage(botId, message);
      } catch (err) {
        console.error(`[Bot:${botId}] Message processing failed:`, err);
      }
    });

    adapter.on('error', (error: Error) => {
      this.botErrors.set(botId, error.message);
      this.emit('error', { botId, error });
    });

    adapter.on('started', () => {
      const config = this.configs.get(botId);
      if (config) {
        config.isRunning = true;
        this.botErrors.delete(botId); // Clear error on successful (re)connection
        this.emit('started', { botId });
      }
    });

    adapter.on('stopped', () => {
      const config = this.configs.get(botId);
      if (config) {
        config.isRunning = false;
        this.emit('stopped', { botId });
      }
    });
  }

  createAdapter(config: BotConfig): BotAdapter {
    switch (config.platform) {
      case 'discord':
        return new DiscordAdapter(config);
      case 'telegram':
        return new TelegramAdapter(config);
      case 'feishu':
        return new FeishuAdapter(config);
      case 'dingtalk':
        return new DingTalkAdapter(config);
      case 'wecom':
        return new WeComAdapter(config);
      case 'whatsapp':
        return new WhatsAppAdapter(config);
      case 'slack':
        return new SlackAdapter(config);
      case 'line':
        return new LineAdapter(config);
      case 'messenger':
        return new MessengerAdapter(config);
      case 'qq':
        return new QQAdapter(config);
      case 'signal':
        return new SignalAdapter(config);
      case 'imessage':
        return new IMessageAdapter(config);
      case 'msteams':
        return new MsTeamsAdapter(config);
      case 'googlechat':
        return new GoogleChatAdapter(config);
      case 'mattermost':
        return new MattermostAdapter(config);
      default:
        throw new Error(`Unsupported platform: ${config.platform}`);
    }
  }

  async addBot(config: BotConfig): Promise<void> {
    if (this.adapters.has(config.id)) {
      await this.removeBot(config.id);
    }

    this.configs.set(config.id, config);
    const adapter = this.createAdapter(config);

    this.adapters.set(config.id, adapter);
    this.setupAdapterListeners(adapter, config.id);
    console.log(`[BotMgr] Added bot: ${config.name} (${config.platform})`);
  }

  async removeBot(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.stop();
      this.adapters.delete(id);
    }
    this.configs.delete(id);
  }

  async startBot(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Bot not found: ${id}`);
    }

    try {
      this.botErrors.delete(id);
      await adapter.start();
      this.emit('started', { botId: id });
    } catch (error) {
      this.botErrors.set(id, (error as Error).message);
      console.warn(`[Bot:${id}] Start failed (non-system):`, (error as Error).message);
      throw error;
    }
  }

  async stopBot(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.stop();
      this.emit('stopped', { botId: id });
    }
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, config] of this.configs) {
      if (config.enabled) {
        promises.push(
          this.startBot(id).catch(error => {
            console.error(`[BotMgr] Failed to auto-start bot ${config.name} (${config.platform}):`, error.message);
          })
        );
      }
    }
    await Promise.allSettled(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const id of this.adapters.keys()) {
      promises.push(this.stopBot(id));
    }
    await Promise.all(promises);
  }

  private async handleMessage(botId: string, message: BotMessage): Promise<void> {
    debugLog(`[BotMgr] Handling message from bot ${botId} (${message.platform}): ${message.content}`);
    const config = this.configs.get(botId);
    if (!config || !config.enabled) {
      debugLog(`[BotMgr] Bot ${botId} not found or disabled (enabled=${config?.enabled}). Dropping message.`);
      console.warn(`[BotMgr] Bot ${botId} not found or disabled. Config: ${JSON.stringify(config)}`);
      return;
    }
    console.log(`[BotMgr] Authorized message from ${message.username} on ${message.platform}`);

    // Check permissions
    let allowedChannels = config.allowedChannels || [];
    let allowedUsers = config.allowedUsers || [];

    if (config.agentId) {
      const agent = agentService.getAgent(config.agentId);
      if (agent) {
        if (agent.channelsConfig && agent.channelsConfig.length > 0) {
          allowedChannels = agent.channelsConfig;
        }
      }
    }

    if (allowedChannels.length > 0 && !allowedChannels.includes(message.channelId)) {
      debugLog(`[BotMgr] Channel ${message.channelId} not in allowed list: ${allowedChannels.join(',')}`);
      return;
    }

    if (allowedUsers.length > 0 && !allowedUsers.includes(message.userId)) {
      debugLog(`[BotMgr] User ${message.userId} not in allowed list: ${allowedUsers.join(',')}`);
      return;
    }

    const rateLimitResult = await rateLimiter.checkRateLimit(`${botId}:${message.channelId}`);
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for ${botId}:${message.channelId}`);
      return;
    }

    const conversationKey = `${message.platform}:${message.channelId}`;
    let conversation = this.conversations.get(conversationKey);

    if (!conversation) {
      conversation = {
        id: conversationKey,
        platform: message.platform,
        channelId: message.channelId,
        userId: message.userId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.conversations.set(conversationKey, conversation);
    }

    const parsedAttachments = message.attachments ? await Promise.all(message.attachments.map(async a => {
      let finalDataUrl = a.url;
      if (a.url.startsWith('http')) {
        try {
          const res = await fetch(a.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const b64 = Buffer.from(buf).toString('base64');
            const mime = res.headers.get('content-type') || a.type;
            finalDataUrl = `data:${mime};base64,${b64}`;
          } else {
            console.error(`[BotMgr] Failed to download attachment ${a.name} from ${a.url}. Status: ${res.status} ${res.statusText}`);
          }
        } catch (e) {
          console.error(`[BotMgr] Failed to download attachment ${a.name}:`, e);
        }
      }
      return { name: a.name, type: a.type, dataUrl: finalDataUrl };
    })) : undefined;

    conversation.messages.push({
      role: 'user',
      content: message.content,
      timestamp: message.timestamp,
      attachments: parsedAttachments
    });

    while (conversation.messages.length > this.maxConversationLength) {
      conversation.messages.shift();
    }

    conversation.updatedAt = Date.now();

    try {
      const adapter = this.adapters.get(botId);
      if (!adapter) {
        debugLog(`[BotMgr] No adapter found for ${botId}, skipping`);
        return;
      }

      try {
        await Promise.race([
          adapter.sendTyping(message.channelId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('sendTyping timeout')), 10000))
        ]);
      } catch (typingError: any) {
        debugLog(`[BotMgr] sendTyping failed for ${botId}: ${typingError.message}`);
        // Don't throw — continue processing the message even if typing indicator fails
      }

      let systemPrompt = config.systemPrompt || 'You are a helpful assistant.';
      let threadId: string | undefined;
      let llmConfigId = config.llmConfigId;

      if (config.agentId) {
        const agent = agentService.getAgent(config.agentId);
        if (agent) {
          // Use agent's system prompt only if bot hasn't set one
          systemPrompt = (config.systemPrompt && config.systemPrompt.trim() !== '') ? config.systemPrompt : (agent.systemPrompt || systemPrompt);
          // Only inherit agent's model if bot hasn't explicitly selected one
          if (agent.defaultModel && !config.llmConfigId) {
            llmConfigId = agent.defaultModel;
          }

          const platformNames: Record<string, string> = {
            feishu: '飞书',
            dingtalk: '钉钉',
            telegram: 'Telegram',
            discord: 'Discord',
            wecom: '企业微信',
            whatsapp: 'WhatsApp',
          };

          const platformName = platformNames[message.platform] || message.platform;
          const threadTitle = `${platformName}对话`;

          const threads = agentService.getThreadsByAgent(config.agentId);
          let thread = threads.find(t => t.title === threadTitle);
          if (!thread) {
            thread = agentService.createThread(config.agentId, threadTitle, message.platform as any);
            debugLog(`[BotMgr] Created thread "${threadTitle}" for agent ${agent.name}`);
          }
          threadId = thread.id;
        }
      }

      // Fallback logic for invalid or deleted LLM configs
      let targetConfig = llmConfigId ? modelsManager.getConfig(llmConfigId) : modelsManager.getDefaultConfig();
      const isLocalNative = targetConfig?.provider === 'local-native';

      if ((llmConfigId && (!targetConfig || (!isLocalNative && (!targetConfig.apiKey || targetConfig.apiKey.trim() === '')))) ||
        (!llmConfigId && (!targetConfig || (!isLocalNative && (!targetConfig.apiKey || targetConfig.apiKey.trim() === ''))))) {

        const allConfigs = modelsManager.getAllConfigs();
        const chatConfigs = allConfigs.filter(c => c.apiKey && c.apiKey.trim() !== '' && !c.name.includes('Image') && !c.name.includes('image'));

        targetConfig = chatConfigs.length > 0 ? chatConfigs[0] : allConfigs.find(c => c.apiKey && c.apiKey.trim() !== '');

        if (targetConfig) {
          debugLog(`[BotMgr] Invalid LLM config ${llmConfigId}. Falling back to ${targetConfig.name}`);
          llmConfigId = targetConfig.id;
        } else {
          throw new Error('没有可用的LLM配置，请先在模型配置页面添加一个有效的API密钥');
        }
      }

      const messages: ChatMessage[] = [...conversation.messages];

      if (config.agentId && threadId) {
        agentService.addMessageToThread(threadId, {
          role: 'user',
          content: message.content,
          timestamp: message.timestamp,
          attachments: parsedAttachments
        });
      }

      debugLog(`[BotMgr] Calling Orchestrator for ${botId} with ${messages.length} msgs (Config: ${llmConfigId})`);

      const orchestrator = new ChatOrchestrator();
      const response = await Promise.race([
        orchestrator.generateResponse({
          messages,
          configId: llmConfigId,
          conversationId: threadId,
          useContextMemory: false,
          systemPrompt: systemPrompt,
          agentId: config.agentId
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Orchestrator response timed out after 120 seconds')), 120000)
        )
      ]);

      if (response.error) {
        throw new Error(response.error);
      }

      debugLog(`[BotMgr] Orchestrator OK for ${botId}: ${response.content.substring(0, 60)}...`);

      conversation.messages.push({
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
      });

      debugLog(`[BotMgr] Sending reply to ${message.channelId} via adapter...`);
      await Promise.race([
        adapter.sendMessage(message.channelId, response.content, response.attachments),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('sendMessage timed out after 30 seconds')), 30000)
        )
      ]);
      debugLog(`[BotMgr] Reply sent successfully for ${botId}`);

      this.emit('messageProcessed', {
        botId,
        message,
        response: response.content,
        threadId,
        agentId: config.agentId,
      });
    } catch (error) {
      debugLog(`[BotMgr] ERROR for ${botId}: ${(error as Error).message}`);
      console.error(`[Bot] Error handling message for ${botId}:`, error);
      this.emit('error', { botId, error, context: 'messageHandling' });

      // On LLM 400 errors, the conversation context is likely corrupted (too many messages,
      // invalid content, etc.). Reset it so subsequent messages start fresh.
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('400') || errMsg.includes('Bad Request') || errMsg.includes('timed out')) {
        const conversationKey = `${message.platform}:${message.channelId}`;
        const conv = this.conversations.get(conversationKey);
        if (conv) {
          debugLog(`[BotMgr] Resetting conversation ${conversationKey} due to error`);
          conv.messages = []; // Clear accumulated messages to prevent repeated failures
        }
      }

      try {
        const adapter = this.adapters.get(botId);
        if (adapter) {
          const errorMessage = this.formatBotError(error as Error);
          await Promise.race([
            adapter.sendMessage(message.channelId, errorMessage),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Error message send timeout')), 10000)
            )
          ]);
        }
      } catch (sendError) {
        debugLog(`[BotMgr] Failed to send error msg for ${botId}: ${(sendError as Error).message}`);
      }
    }
  }

  async sendMessage(botId: string, channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
    const adapter = this.adapters.get(botId);
    if (!adapter) {
      throw new Error(`Bot not found: ${botId}`);
    }
    return adapter.sendMessage(channelId, content, attachments);
  }

  getBot(id: string): BotConfig | undefined {
    return this.configs.get(id);
  }

  getAllBots(): BotConfig[] {
    return Array.from(this.configs.values());
  }

  getRunningBots(): string[] {
    return Array.from(this.adapters.entries())
      .filter(([_, adapter]) => adapter.isRunning())
      .map(([id]) => id);
  }

  getBotError(id: string): string | undefined {
    return this.botErrors.get(id);
  }

  getBotStatusData(id: string): Record<string, any> | undefined {
    const adapter = this.adapters.get(id);
    return adapter?.getStatusData?.();
  }

  getConversation(key: string): ConversationContext | undefined {
    return this.conversations.get(key);
  }

  getConversationsByBot(botId: string): Record<string, ConversationContext> {
    const bot = this.configs.get(botId);
    if (!bot) return {};

    const result: Record<string, ConversationContext> = {};
    for (const [key, conv] of this.conversations) {
      if (key.startsWith(bot.platform)) {
        result[key] = conv;
      }
    }
    return result;
  }

  clearConversation(key: string): void {
    this.conversations.delete(key);
  }

  clearAllConversations(): void {
    this.conversations.clear();
  }

  async updateBotConfig(id: string, updates: Partial<BotConfig>): Promise<void> {
    const config = this.configs.get(id);
    if (!config) return;

    const newConfig = { ...config, ...updates };
    this.configs.set(id, newConfig);

    // Always remove old adapter if it exists
    if (this.adapters.has(id)) {
      console.log(`[Bot] Updating config for ${newConfig.name}, restarting...`);
      await this.removeBot(id);
    }

    // Always re-add and restart if enabled
    await this.addBot(newConfig);
    if (newConfig.enabled) {
      // Start in background - don't block the HTTP response
      this.startBot(id)
        .then(() => console.log(`[Bot] Restarted: ${newConfig.name} (${newConfig.platform})`))
        .catch((error) => console.error(`[Bot] Failed to restart ${newConfig.name}:`, error));
    }
  }

  private formatBotError(error: Error): string {
    const message = error.message || '未知错误';

    if (message.includes('DNS解析失败') || message.includes('ENOTFOUND')) {
      return `❌ DNS解析失败\n\n请检查LLM配置中的API地址是否正确。\n可能原因：域名拼写错误或网络问题`;
    }

    if (message.includes('连接被拒绝') || message.includes('ECONNREFUSED')) {
      return `❌ 连接被拒绝\n\n无法连接到API服务器。\n可能原因：服务未启动或端口错误`;
    }

    if (message.includes('连接超时') || message.includes('ETIMEDOUT')) {
      return `❌ 连接超时\n\n服务器响应时间过长。\n可能原因：网络不稳定或服务器负载过高`;
    }

    if (message.includes('认证失败') || message.includes('401')) {
      return `❌ 认证失败\n\nAPI密钥无效或已过期。\n请检查LLM配置中的API密钥`;
    }

    if (message.includes('访问被拒绝') || message.includes('403')) {
      return `❌ 访问被拒绝\n\n没有权限访问此API。\n请检查账户权限设置`;
    }

    if (message.includes('API地址错误') || message.includes('404')) {
      return `❌ API地址错误\n\n找不到接口。\n请检查LLM配置中的Base URL和模型名称`;
    }

    if (message.includes('请求过于频繁') || message.includes('429')) {
      return `❌ 请求过于频繁\n\n已达到速率限制，请稍后重试`;
    }

    if (message.includes('服务器内部错误') || message.includes('500')) {
      return `❌ 服务器错误\n\nAPI服务异常，请稍后重试`;
    }

    if (message.includes('网络请求失败') || message.includes('fetch failed')) {
      return `❌ 网络请求失败\n\n请检查网络连接`;
    }

    if (message.includes('请求参数错误') || message.includes('400')) {
      return `❌ 请求参数错误\n\n${message}`;
    }

    return `❌ 错误: ${message}`;
  }
}

export const botManager = new BotManager();

