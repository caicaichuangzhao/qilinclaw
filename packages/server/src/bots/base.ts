import { EventEmitter } from 'events';
import type { BotConfig, BotPlatform, ChatMessage, ConversationContext } from '../types/index.js';

export interface BotMessage {
  id: string;
  platform: BotPlatform;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  replyTo?: string;
  attachments?: Array<{
    type: string;
    url: string;
    name: string;
  }>;
}

export interface BotAdapter extends EventEmitter {
  readonly config: BotConfig;
  readonly platform: BotPlatform;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string>;
  sendTyping(channelId: string): Promise<void>;
  isRunning(): boolean;
  getStatusData?(): Record<string, any>;
}

export abstract class BaseBotAdapter extends EventEmitter implements BotAdapter {
  abstract readonly platform: BotPlatform;
  readonly config: BotConfig;
  private running = false;

  constructor(config: BotConfig) {
    super();
    this.config = config;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string>;
  abstract sendTyping(channelId: string): Promise<void>;

  isRunning(): boolean {
    return this.running;
  }

  protected setRunning(value: boolean): void {
    this.running = value;
    this.emit(value ? 'started' : 'stopped');
  }

  protected shouldRespond(message: BotMessage): boolean {
    if (!this.config.enabled) {
      console.log(`[Bot:${this.platform}] Message ignored: bot not enabled`);
      return false;
    }

    if (this.config.allowedChannels?.length) {
      if (!this.config.allowedChannels.includes(message.channelId)) {
        console.log(`[Bot:${this.platform}] Message ignored: channel (${message.channelId}) not in allowedChannels (${JSON.stringify(this.config.allowedChannels)})`);
        return false;
      }
    }

    if (this.config.allowedUsers?.length) {
      if (!this.config.allowedUsers.includes(message.userId)) {
        console.log(`[Bot:${this.platform}] Message ignored: user (${message.userId}) not in allowedUsers (${JSON.stringify(this.config.allowedUsers)})`);
        return false;
      }
    }

    console.log(`[Bot:${this.platform}] Message accepted for processing`);
    return true;
  }

  protected emitMessage(message: BotMessage): void {
    const shouldRespond = this.shouldRespond(message);
    if (shouldRespond) {
      if (!this.isRunning()) {
        this.setRunning(true);
      }
      this.emit('message', message);
    }
  }
}
