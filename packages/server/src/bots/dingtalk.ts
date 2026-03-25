import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';
import { DWClient } from 'dingtalk-stream';

interface DingTalkMessage {
  msgtype: string;
  text?: { content: string };
  msgId: string;
  createAt: number;
  conversationId: string;
  conversationType: string;
  conversationTitle?: string;
  senderId: string;
  senderNick: string;
  senderCorpId?: string;
  senderDingtalkId?: string;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
}

export class DingTalkAdapter extends BaseBotAdapter {
  readonly platform = 'dingtalk' as const;
  private clientId: string;
  private clientSecret: string;
  private client: DWClient | null = null;
  private connectionMode: 'stream' | 'webhook' = 'stream';
  private sessionWebhooks = new Map<string, string>();
  private accessToken: string | null = null;
  private tokenExpireTime = 0;

  constructor(config: BotConfig) {
    super(config);
    this.clientId = config.config.clientId as string || config.config.appKey as string;
    this.clientSecret = config.config.clientSecret as string || config.config.appSecret as string;
    this.connectionMode = (config.config.mode as 'stream' | 'webhook') || 'stream';
  }

  async start(): Promise<void> {
    if (this.connectionMode === 'stream') {
      await this.startStreamMode();
    } else {
      this.setRunning(true);
    }
  }

  private async startStreamMode(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('DingTalk clientId and clientSecret are required for Stream mode');
    }

    try {
      this.client = new DWClient({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        debug: false,
      });

      this.client.registerCallbackListener('/v1.0/im/bot/messages/get', async (res: any) => {
        console.log('[DingTalk] Received message event');
        if (res.headers && res.headers.topic === '/v1.0/im/bot/messages/get') {
          try {
            const data = JSON.parse(res.data) as DingTalkMessage;
            this.handleMessage(data);
          } catch (e) {
            console.error('[DingTalk] Failed to parse message', e);
          }
        }
      });

      await this.client.connect();
      console.log('[DingTalk] Stream mode connected');
      this.setRunning(true);
    } catch (error) {
      console.error('[DingTalk] Failed to start Stream mode:', error);
      throw error;
    }
  }

  private async ensureAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpireTime) {
      try {
        const response = await fetch(
          `https://oapi.dingtalk.com/gettoken?appkey=${this.clientId}&appsecret=${this.clientSecret}`
        );
        const data = (await response.json()) as { access_token: string; expires_in: number };
        if (data.access_token) {
          this.accessToken = data.access_token;
          this.tokenExpireTime = Date.now() + data.expires_in * 1000 - 300000;
          console.log('[DingTalk] Access token refreshed');
        }
      } catch (e) {
        console.error('[DingTalk] Failed to refresh access token:', e);
      }
    }
    return this.accessToken || '';
  }

  private handleMessage(data: DingTalkMessage): void {
    if (data.msgtype !== 'text' || !data.text?.content) {
      return;
    }

    const content = data.text.content.trim();
    if (!content) return;

    if (data.sessionWebhook) {
      this.sessionWebhooks.set(data.conversationId, data.sessionWebhook);
    }

    const botMessage: BotMessage = {
      id: data.msgId,
      platform: 'dingtalk',
      channelId: data.conversationId,
      userId: data.senderId,
      username: data.senderNick,
      content,
      timestamp: data.createAt,
    };

    console.log('[DingTalk] Processed message:', content.substring(0, 50));
    this.emitMessage(botMessage);
  }

  handleWebhookMessage(msg: DingTalkMessage): void {
    if (this.connectionMode === 'webhook') {
      this.handleMessage(msg);
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      console.log('[DingTalk] Stream mode stopped');
    }
    this.setRunning(false);
  }

  async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
    const sessionWebhook = this.sessionWebhooks.get(channelId);
    const isMarkdown = content.includes('`') || content.includes('#');

    if (sessionWebhook) {
      try {
        const payload = isMarkdown ? {
          msgtype: 'markdown',
          markdown: { title: '回复', text: content },
        } : {
          msgtype: 'text',
          text: { content },
        };

        const response = await fetch(sessionWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json() as { errcode?: number; errmsg?: string };
        if (data.errcode === 0) {
          console.log('[DingTalk] Message sent via sessionWebhook');
          return '';
        } else {
          console.warn('[DingTalk] sessionWebhook failed, trying API:', data);
        }
      } catch (error) {
        console.warn('[DingTalk] sessionWebhook error, trying API:', error);
      }
    }

    try {
      const token = await this.ensureAccessToken();
      if (!token) {
        console.error('[DingTalk] No access token available');
        return '';
      }

      const conversationType = channelId.startsWith('cid') ? '1' : '0';
      
      const payload = isMarkdown ? {
        msgtype: 'markdown',
        markdown: {
          title: '回复',
          text: content
        }
      } : {
        msgtype: 'text',
        text: { content }
      };

      const response = await fetch(
        `https://oapi.dingtalk.com/topapi/im/chat/messages/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            open_conversation_id: channelId,
            robot_code: this.clientId,
            msgkey: payload.msgtype,
            msgparam: JSON.stringify(payload[payload.msgtype as keyof typeof payload])
          })
        }
      );

      const data = await response.json() as { errcode?: number; errmsg?: string; processQueryKey?: string };
      if (data.errcode === 0) {
        console.log('[DingTalk] Message sent via API');
        return data.processQueryKey || '';
      } else {
        console.error('[DingTalk] API send failed:', data);
        return '';
      }
    } catch (error) {
      console.error('[DingTalk] All send methods failed:', error);
      return '';
    }
  }

  async sendTyping(): Promise<void> {
    // DingTalk doesn't support typing indicator
  }
}
