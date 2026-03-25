import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';
import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface FeishuEvent {
  schema?: string;
  event_id?: string;
  event_type?: string;
  create_time?: string;
  token?: string;
  tenant_key?: string;
  app_id?: string;
  sender?: {
    sender_id: {
      open_id: string;
      union_id: string;
      user_id: string;
    };
    sender_type: string;
    tenant_key: string;
  };
  message?: {
    chat_id: string;
    chat_type: string;
    content: string;
    create_time: string;
    message_id: string;
    message_type: string;
    update_time?: string;
    user_agent?: string;
  };
}

export class FeishuAdapter extends BaseBotAdapter {
  readonly platform = 'feishu' as const;
  private appId: string;
  private appSecret: string;
  private client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private connectionMode: 'websocket' | 'webhook' = 'websocket';
  private typingMessages = new Map<string, string>();

  constructor(config: BotConfig) {
    super(config);
    this.appId = config.config.appId as string;
    this.appSecret = config.config.appSecret as string;
    this.connectionMode = (config.config.mode as 'websocket' | 'webhook') || 'websocket';
  }

  async start(): Promise<void> {
    console.log(`[Feishu] Starting with mode: ${this.connectionMode}`);

    // Create lark client
    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    if (this.connectionMode === 'websocket') {
      // Fire-and-forget WebSocket start to prevent network issues from blocking the server script
      this.startWebSocket()
        .then(() => console.log('[Feishu] WebSocket long connection established'))
        .catch(e => {
          console.error('[Feishu] Failed to start WebSocket:', e);
          this.setRunning(false);
          this.emit('error', e instanceof Error ? e : new Error(String(e)));
        });
    }

    this.setRunning(true);
    console.log('[Feishu] Adapter initialization complete (WebSocket connecting in background)');
  }

  private async startWebSocket(): Promise<void> {
    try {
      // Create event dispatcher
      const eventDispatcher = new lark.EventDispatcher({
        loggerLevel: lark.LoggerLevel.info,
      });

      // Register message event handler
      eventDispatcher.register({
        'im.message.receive_v1': (data: any) => {
          console.log('[Feishu] Received message event, raw data:', JSON.stringify(data).substring(0, 500));
          this.handleEvent(data as unknown as FeishuEvent);
          return;
        },
      });

      // Create WebSocket client for long connection
      this.wsClient = new lark.WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
        domain: lark.Domain.Feishu,
        loggerLevel: lark.LoggerLevel.info,
      });

      // Start long connection with eventDispatcher
      await this.wsClient.start({
        eventDispatcher: eventDispatcher,
      });

      console.log('[Feishu] WebSocket long connection established');

    } catch (error) {
      console.error('[Feishu] Failed to start WebSocket:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      try {
        await this.wsClient.close();
        console.log('[Feishu] WebSocket stopped');
      } catch (error) {
        console.error('[Feishu] Error stopping WebSocket:', error);
      }
      this.wsClient = null;
    }

    this.client = null;
    this.setRunning(false);
  }

  private async handleEvent(event: FeishuEvent): Promise<void> {
    console.log('[Feishu] handleEvent called, type:', event?.event_type);

    if (event?.event_type !== 'im.message.receive_v1') {
      console.log('[Feishu] Ignoring event type:', event?.event_type);
      return;
    }

    const message = event.message;
    console.log('[Feishu] Message data:', JSON.stringify(message).substring(0, 200));

    if (!message) {
      console.log('[Feishu] No message in event');
      return;
    }

    let content = '';
    let attachments: Array<{ type: string, url: string, name: string }> | undefined = undefined;

    try {
      const parsed = JSON.parse(message.content);
      content = parsed.text || '';

      if (message.message_type === 'image') {
        const imageKey = parsed.image_key;
        if (imageKey && this.client) {
          try {
            console.log(`[Feishu] Fetching imageResource for key: ${imageKey}`);
            const res = await this.client.im.messageResource.get({
              path: { message_id: message.message_id, file_key: imageKey },
              params: { type: 'image' }
            });
            const readable = res.getReadableStream();
            const chunks: any[] = [];
            for await (const chunk of readable) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            const base64Data = buffer.toString('base64');
            const mime = res.headers?.['content-type'] || 'image/jpeg';
            attachments = [{
              type: mime,
              name: `image_${imageKey}.jpg`,
              url: `data:${mime};base64,${base64Data}`
            }];
          } catch (e: any) {
            console.error('[Feishu] Failed to download image resource:', e.message);
          }
        }
        content = content || '[图片]'; // Provide fallback text if image has no accompanying text
      } else if (message.message_type === 'post') {
        let postText = '';
        attachments = [];
        const contentObj = parsed.zh_cn || parsed.en_us;
        if (contentObj && Array.isArray(contentObj.content)) {
          for (const line of contentObj.content) {
            for (const elem of line) {
              if (elem.tag === 'text') {
                postText += elem.text;
              } else if (elem.tag === 'img' && elem.image_key && this.client) {
                try {
                  console.log(`[Feishu] Fetching post imageResource for key: ${elem.image_key}`);
                  const res = await this.client.im.messageResource.get({
                    path: { message_id: message.message_id, file_key: elem.image_key },
                    params: { type: 'image' }
                  });
                  const readable = res.getReadableStream();
                  const chunks: any[] = [];
                  for await (const chunk of readable) {
                    chunks.push(chunk);
                  }
                  const buffer = Buffer.concat(chunks);
                  const base64Data = buffer.toString('base64');
                  const mime = res.headers?.['content-type'] || 'image/jpeg';
                  attachments.push({
                    type: mime,
                    name: `image_${elem.image_key}.jpg`,
                    url: `data:${mime};base64,${base64Data}`
                  });
                } catch (e: any) {
                  console.error('[Feishu] Failed to download post image resource:', e.message);
                }
              }
            }
            postText += '\n'; // new line for each paragraph cluster
          }
        }
        content = postText.trim() || '[富文本消息]';
        if (attachments.length === 0) attachments = undefined;
      }
    } catch {
      content = message.content;
    }

    if (!content.trim() && !attachments) {
      console.log('[Feishu] Empty content and no attachments');
      return;
    }

    const botMessage: BotMessage = {
      id: message.message_id,
      platform: 'feishu',
      channelId: message.chat_id,
      userId: event.sender?.sender_id?.open_id || 'unknown',
      username: event.sender?.sender_id?.open_id || 'unknown',
      content,
      timestamp: parseInt(message.create_time),
      attachments,
    };

    console.log('[Feishu] Processed message:', content);
    this.emitMessage(botMessage);
  }

  async handleWebhookEvent(event: FeishuEvent): Promise<void> {
    if (this.connectionMode === 'webhook') {
      await this.handleEvent(event);
    }
  }

  async sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
    if (!this.client) {
      console.error('[Feishu] Client not initialized');
      return '';
    }

    // Try to clean up any temporary typing message
    const typingMsgId = this.typingMessages.get(channelId);
    if (typingMsgId) {
      this.typingMessages.delete(channelId);
      try {
        await this.client.im.message.delete({
          path: { message_id: typingMsgId }
        });
      } catch (e) {
        console.log('[Feishu] Failed to delete typing message, might be already deleted:', e);
      }
    }

    try {
      let msgType = 'text';
      let finalContentStr = '';

      if (attachments && attachments.length > 0) {
        msgType = 'post';
        const postContent: any[] = [];

        if (content && content.trim()) {
          postContent.push([{ tag: 'text', text: content }]);
        }

        for (const attachment of attachments) {
          if (attachment.dataUrl && attachment.dataUrl.startsWith('data:')) {
            const base64Data = attachment.dataUrl.split(',')[1];
            if (base64Data) {
              const buffer = Buffer.from(base64Data, 'base64');
              console.log(`[Feishu] Uploading image: ${attachment.name}`);
              const tempFilePath = path.join(os.tmpdir(), `feishu_upload_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);
              try {
                fs.writeFileSync(tempFilePath, buffer);
                const uploadRes = await this.client.im.image.create({
                  data: {
                    image_type: 'message',
                    image: fs.createReadStream(tempFilePath) as any
                  }
                });
                if (uploadRes?.image_key) {
                  postContent.push([{ tag: 'img', image_key: uploadRes.image_key }]);
                } else {
                  console.error(`[Feishu] Failed to upload image: ${JSON.stringify(uploadRes)}`);
                }
              } catch (uploadError: any) {
                console.error(`[Feishu] Exception during image upload:`, uploadError);
              } finally {
                if (fs.existsSync(tempFilePath)) {
                  try { fs.unlinkSync(tempFilePath); } catch (e) { }
                }
              }
            }
          }
        }

        finalContentStr = JSON.stringify({
          zh_cn: { title: '', content: postContent }
        });
      } else {
        msgType = 'text';
        finalContentStr = JSON.stringify({ text: content });
      }

      const response = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: channelId,
          msg_type: msgType,
          content: finalContentStr,
        },
      });

      if (response.code === 0) {
        console.log('[Feishu] Message sent successfully');
        return response.data?.message_id || '';
      } else {
        console.error('[Feishu] Send message failed:', response);
        return '';
      }
    } catch (error) {
      console.error('[Feishu] Send message error:', error);
      return '';
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    if (!this.client) return;

    // Feishu doesn't have a reliable native typing indicator API for all bot types.
    // So we simulate it by sending a temporary "thinking" message status, which gets deleted when the real message arrives.
    if (!this.typingMessages.has(channelId)) {
      try {
        const response = await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: channelId,
            msg_type: 'text',
            content: JSON.stringify({ text: '⏳ 机器人正在思考中...' }),
          },
        });

        if (response.code === 0 && response.data?.message_id) {
          const sentMsgId = response.data.message_id;
          this.typingMessages.set(channelId, sentMsgId);

          // Auto-cleanup after 60s in case the generation fails or gets stuck
          setTimeout(() => {
            const currentMsg = this.typingMessages.get(channelId);
            if (currentMsg === sentMsgId) {
              this.typingMessages.delete(channelId);
              this.client!.im.message.delete({ path: { message_id: currentMsg } }).catch(() => { });
            }
          }, 60000);
        }
      } catch (error) {
        console.error('[Feishu] Failed to send simulated typing indicator:', error);
      }
    }
  }
}
