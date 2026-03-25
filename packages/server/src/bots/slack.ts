import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class SlackAdapter extends BaseBotAdapter {
    readonly platform = 'slack' as const;
    private botToken: string;
    private signingSecret: string;
    private isConnecting = false;

    constructor(config: BotConfig) {
        super(config);
        this.botToken = config.config.botToken as string;
        this.signingSecret = config.config.signingSecret as string;
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.botToken) {
                throw new Error('Slack Bot Token is required');
            }
            this.setRunning(true);
            console.log(`[Slack] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[Slack] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[Slack] Adapter stopped for ${this.config.name}`);
    }

    // Handle incoming webhooks from routes/webhooks.ts
    public handleWebhookEvent(payload: any): void {
        const event = payload.event;
        if (!event || event.type !== 'message' || event.bot_id || !event.text) {
            return; // Ignore bot messages or non-messages
        }

        const botMessage: BotMessage = {
            id: event.ts,
            platform: 'slack',
            channelId: event.channel,
            userId: event.user,
            username: event.user, // Slack user ID (can map to real name if needed)
            content: event.text,
            timestamp: parseInt((parseFloat(event.ts) * 1000).toString(), 10),
            replyTo: event.thread_ts || undefined,
        };

        this.emitMessage(botMessage);
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            // Use standard fetch to send message
            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    channel: channelId,
                    text: content
                })
            });
            const data = await response.json() as any;
            if (!data.ok) {
                console.error('[Slack] Error sending message:', data.error);
                return '';
            }
            return data.ts || '';
        } catch (e) {
            console.error('[Slack] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        // Note: Slack's Web API does not support native typing indicators.
        // We could simulate it via chat.postMessage with generic text, but standard behavior is fine.
    }
}
