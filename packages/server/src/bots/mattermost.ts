import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class MattermostAdapter extends BaseBotAdapter {
    readonly platform = 'mattermost' as const;
    private serverUrl: string;
    private botToken: string;
    private isConnecting = false;

    constructor(config: BotConfig) {
        super(config);
        this.serverUrl = config.config.serverUrl as string;
        this.botToken = config.config.botToken as string;

        if (this.serverUrl && this.serverUrl.endsWith('/')) {
            this.serverUrl = this.serverUrl.slice(0, -1);
        }
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.serverUrl || !this.botToken) {
                throw new Error('Mattermost Server URL and Bot Token are required');
            }

            // Validate connection
            const res = await fetch(`${this.serverUrl}/api/v4/users/me`, {
                headers: { 'Authorization': `Bearer ${this.botToken}` }
            });

            if (!res.ok) throw new Error('Cannot authenticate with Mattermost API');

            this.setRunning(true);
            console.log(`[Mattermost] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[Mattermost] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[Mattermost] Adapter stopped for ${this.config.name}`);
    }

    // Handled from webhook endpoint (Outgoing Webhooks)
    public handleWebhookEvent(payload: any): void {
        // payload from Mattermost Outgoing Webhook
        if (!payload.text) return;

        // Skip messages from bots (avoid loops)
        if (payload.user_name === 'system' || payload.is_bot) return;

        const botMessage: BotMessage = {
            id: payload.post_id || Date.now().toString(),
            platform: 'mattermost',
            channelId: payload.channel_id,
            userId: payload.user_id,
            username: payload.user_name,
            content: payload.text,
            timestamp: payload.timestamp ? parseInt(payload.timestamp, 10) : Date.now(),
        };

        this.emitMessage(botMessage);
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            const response = await fetch(`${this.serverUrl}/api/v4/posts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    channel_id: channelId,
                    message: content
                })
            });
            const data = await response.json() as any;
            if (!response.ok) {
                console.error('[Mattermost] Error sending message:', data);
                return '';
            }
            return data.id || '';
        } catch (e) {
            console.error('[Mattermost] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        try {
            await fetch(`${this.serverUrl}/api/v4/users/me/typing`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                },
                body: JSON.stringify({
                    channel_id: channelId
                })
            });
        } catch (e) {
            // Ignore
        }
    }
}
