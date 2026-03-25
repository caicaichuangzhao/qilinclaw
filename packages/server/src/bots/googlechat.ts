import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';
import { google } from 'googleapis';

export class GoogleChatAdapter extends BaseBotAdapter {
    readonly platform = 'googlechat' as const;
    private credentialsJson: string; // Service account JSON string
    private isConnecting = false;
    private auth: any;

    constructor(config: BotConfig) {
        super(config);
        this.credentialsJson = config.config.credentialsJson as string;
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.credentialsJson) {
                throw new Error('Google Chat Service Account Credentials are required');
            }

            const keys = JSON.parse(this.credentialsJson);
            this.auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: keys.client_email,
                    private_key: keys.private_key,
                },
                scopes: ['https://www.googleapis.com/auth/chat.bot']
            });

            // Verify auth
            await this.auth.getClient();

            this.setRunning(true);
            console.log(`[GoogleChat] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[GoogleChat] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[GoogleChat] Adapter stopped for ${this.config.name}`);
    }

    // Handled from webhook endpoint
    public handleWebhookEvent(payload: any): void {
        if (payload.type !== 'MESSAGE' || !payload.message || !payload.message.text) return;

        const spaceName = payload.space.name; // e.g. "spaces/xxxx"
        const threadName = payload.message.thread?.name; // e.g. "spaces/xxxx/threads/yyyy"

        const channelId = threadName || spaceName;

        const botMessage: BotMessage = {
            id: payload.message.name,
            platform: 'googlechat',
            channelId: channelId,
            userId: payload.user.name,
            username: payload.user.displayName,
            content: payload.message.text.trim(),
            timestamp: new Date(payload.message.createTime).getTime(),
        };

        this.emitMessage(botMessage);
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            const client = await this.auth.getClient();
            const token = await client.getAccessToken();

            // channelId might be a thread name or a space name
            let url = `https://chat.googleapis.com/v1/${channelId}/messages`;
            let body: any = { text: content };

            if (channelId.includes('/threads/')) {
                const spaceMatch = channelId.match(/(spaces\/[^/]+)/);
                if (spaceMatch) {
                    url = `https://chat.googleapis.com/v1/${spaceMatch[1]}/messages`;
                    body.thread = { name: channelId };
                }
            }

            const response = await fetch(url + '?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token.token}`
                },
                body: JSON.stringify(body)
            });
            const data = await response.json() as any;
            if (!response.ok) {
                console.error('[GoogleChat] Error sending message:', data);
                return '';
            }
            return data.name || '';
        } catch (e) {
            console.error('[GoogleChat] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        // Not natively supported for bots via Chat API alone without web-based UI integrations
    }
}
