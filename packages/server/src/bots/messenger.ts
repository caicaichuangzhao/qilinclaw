import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class MessengerAdapter extends BaseBotAdapter {
    readonly platform = 'messenger' as const;
    private pageAccessToken: string;
    private verifyToken: string;
    private isConnecting = false;

    constructor(config: BotConfig) {
        super(config);
        this.pageAccessToken = config.config.pageAccessToken as string;
        this.verifyToken = config.config.verifyToken as string;
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.pageAccessToken) {
                throw new Error('Messenger Page Access Token is required');
            }
            this.setRunning(true);
            console.log(`[Messenger] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[Messenger] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[Messenger] Adapter stopped for ${this.config.name}`);
    }

    public handleWebhookEvent(payload: any): void {
        if (payload.object !== 'page') return;

        payload.entry?.forEach((entry: any) => {
            const webhookEvent = entry.messaging?.[0];
            if (!webhookEvent || !webhookEvent.message || !webhookEvent.message.text) return;

            const senderPsid = webhookEvent.sender.id;

            const botMessage: BotMessage = {
                id: webhookEvent.message.mid,
                platform: 'messenger',
                channelId: senderPsid,
                userId: senderPsid,
                username: senderPsid,
                content: webhookEvent.message.text,
                timestamp: webhookEvent.timestamp || Date.now()
            };

            this.emitMessage(botMessage);
        });
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            const response = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${this.pageAccessToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: channelId },
                    message: { text: content }
                })
            });

            const data = await response.json() as any;
            if (data.error) {
                console.error('[Messenger] Send error:', data.error);
                return '';
            }
            return data.message_id || '';
        } catch (e) {
            console.error('[Messenger] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        try {
            await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${this.pageAccessToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: channelId },
                    sender_action: 'typing_on'
                })
            });
        } catch (e) {
            // Ignore
        }
    }
}
