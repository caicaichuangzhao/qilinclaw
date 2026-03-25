import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class IMessageAdapter extends BaseBotAdapter {
    readonly platform = 'imessage' as const;
    private serverUrl: string;
    private password: string; // BlueBubbles password
    private isConnecting = false;

    constructor(config: BotConfig) {
        super(config);
        this.serverUrl = config.config.serverUrl as string;
        this.password = config.config.password as string;

        if (this.serverUrl && this.serverUrl.endsWith('/')) {
            this.serverUrl = this.serverUrl.slice(0, -1);
        }
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.serverUrl || !this.password) {
                throw new Error('iMessage (BlueBubbles) Server URL and Password are required');
            }

            // Check connection
            const res = await fetch(`${this.serverUrl}/api/v1/ping?password=${encodeURIComponent(this.password)}`);
            if (!res.ok) throw new Error('Cannot connect to BlueBubbles server');

            // To receive messages from BlueBubbles, you setup a webhook in their UI
            // which will hit our `/api/webhooks/imessage/:botId` endpoint. We don't poll here.
            this.setRunning(true);
            console.log(`[iMessage] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[iMessage] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[iMessage] Adapter stopped for ${this.config.name}`);
    }

    // Handles webhooks from BlueBubbles
    public handleWebhookEvent(payload: any): void {
        const type = payload.type;
        const data = payload.data;

        // only handle new messages
        if (type !== 'new-message' || !data || data.isFromMe) {
            return;
        }

        const chatGuid = data.chats && data.chats.length > 0 ? data.chats[0].guid : null;
        if (!chatGuid) return;

        const botMessage: BotMessage = {
            id: data.guid,
            platform: 'imessage',
            channelId: chatGuid, // BlueBubbles chat guid
            userId: data.handle?.address || chatGuid,
            username: data.handle?.address || 'iMessage User',
            content: data.text || '',
            timestamp: data.dateCreated || Date.now(),
        };

        this.emitMessage(botMessage);
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            const response = await fetch(`${this.serverUrl}/api/v1/message/text?password=${encodeURIComponent(this.password)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatGuid: channelId,
                    text: content
                })
            });
            const data = await response.json() as any;
            if (!response.ok) {
                console.error('[iMessage] Error sending message:', data);
                return '';
            }
            return data.data?.guid || Date.now().toString();
        } catch (e) {
            console.error('[iMessage] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        try {
            await fetch(`${this.serverUrl}/api/v1/chat/${encodeURIComponent(channelId)}/typing?password=${encodeURIComponent(this.password)}`, {
                method: 'POST'
            });
        } catch (e) {
            // Ignore if typing fails
        }
    }
}
