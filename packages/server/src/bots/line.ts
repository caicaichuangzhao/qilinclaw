import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class LineAdapter extends BaseBotAdapter {
    readonly platform = 'line' as const;
    private channelAccessToken: string;
    private channelSecret: string;
    private isConnecting = false;

    constructor(config: BotConfig) {
        super(config);
        this.channelAccessToken = config.config.channelAccessToken as string;
        this.channelSecret = config.config.channelSecret as string;
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.channelAccessToken) {
                throw new Error('LINE Channel Access Token is required');
            }
            this.setRunning(true);
            console.log(`[Line] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[Line] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[Line] Adapter stopped for ${this.config.name}`);
    }

    public handleWebhookEvent(payload: any): void {
        const events = payload.events || [];
        for (const event of events) {
            if (event.type !== 'message' || event.message.type !== 'text') continue;

            const sourceId = event.source.groupId || event.source.roomId || event.source.userId;
            const botMessage: BotMessage = {
                id: event.message.id,
                platform: 'line',
                channelId: sourceId,
                userId: event.source.userId,
                username: event.source.userId, // Profile lookup requires separate API call
                content: event.message.text,
                timestamp: event.timestamp || Date.now(),
                // Line webhook includes a replyToken but we use push messages generically for async LLM responses
            };

            this.emitMessage(botMessage);
        }
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            const response = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.channelAccessToken}`
                },
                body: JSON.stringify({
                    to: channelId,
                    messages: [
                        {
                            type: 'text',
                            text: content
                        }
                    ]
                })
            });

            const text = await response.text();
            if (!response.ok) {
                console.error('[Line] Send error:', text);
                return '';
            }
            return 'line-pushed-' + Date.now();
        } catch (e) {
            console.error('[Line] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        try {
            await fetch('https://api.line.me/v2/bot/chat/loading/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.channelAccessToken}`
                },
                body: JSON.stringify({
                    chatId: channelId,
                    loadingSeconds: 20
                })
            });
        } catch (e) {
            // Ignore typing errors
        }
    }
}
