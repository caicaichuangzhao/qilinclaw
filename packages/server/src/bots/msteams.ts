import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class MsTeamsAdapter extends BaseBotAdapter {
    readonly platform = 'msteams' as const;
    private botId: string;
    private botPassword: string;
    private isConnecting = false;
    private token: string | null = null;
    private tokenExpiry: number = 0;

    constructor(config: BotConfig) {
        super(config);
        this.botId = config.config.botId as string;
        this.botPassword = config.config.botPassword as string;
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.botId || !this.botPassword) {
                throw new Error('MS Teams Bot ID and Password are required');
            }

            // Test auth
            await this.getAuthToken();
            this.setRunning(true);
            console.log(`[MsTeams] Adapter started for ${this.config.name}`);
        } catch (error) {
            console.error('[MsTeams] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        console.log(`[MsTeams] Adapter stopped for ${this.config.name}`);
    }

    private async getAuthToken(): Promise<string> {
        if (this.token && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        const url = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', this.botId);
        params.append('client_secret', this.botPassword);
        params.append('scope', 'https://api.botframework.com/.default');

        const res = await fetch(url, {
            method: 'POST',
            body: params
        });

        if (!res.ok) {
            throw new Error(`Failed to authenticate with Bot Framework: ${res.statusText}`);
        }

        const data = await res.json() as any;
        this.token = data.access_token;
        // expires_in is in seconds, subtract buffer of 300s (5min)
        this.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);
        return this.token as string;
    }

    // Handled from webhook endpoint
    public handleWebhookEvent(activity: any): void {
        if (activity.type !== 'message' || !activity.text) return;

        // Prevent infinite loops or responding to bots
        const isBot = activity.from?.role === 'bot';
        if (isBot) return;

        // Strip HTML/mentions if needed. activity.text might have <at>...</at>
        let content = activity.text;

        // Save the serviceUrl mapping for the channel so we can reply
        // We will encode it in the channelId or store it temporarily so sendMessage can use it
        const channelId = Buffer.from(JSON.stringify({
            cId: activity.conversation.id,
            sUrl: activity.serviceUrl
        })).toString('base64');

        const botMessage: BotMessage = {
            id: activity.id,
            platform: 'msteams',
            channelId: channelId,
            userId: activity.from.id,
            username: activity.from.name,
            content: content,
            timestamp: Date.now(),
            replyTo: activity.conversation.id
        };

        this.emitMessage(botMessage);
    }

    async sendMessage(encodedChannelInfo: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
        try {
            const token = await this.getAuthToken();
            const info = JSON.parse(Buffer.from(encodedChannelInfo, 'base64').toString('utf-8'));
            const sUrl = info.sUrl;
            const cId = info.cId;

            const endpoint = `${sUrl}/v3/conversations/${encodeURIComponent(cId)}/activities`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    type: 'message',
                    text: content
                })
            });
            const data = await response.json() as any;
            if (!response.ok) {
                console.error('[MsTeams] Error sending message:', data);
                return '';
            }
            return data.id || '';
        } catch (e) {
            console.error('[MsTeams] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(encodedChannelInfo: string): Promise<void> {
        try {
            const token = await this.getAuthToken();
            const info = JSON.parse(Buffer.from(encodedChannelInfo, 'base64').toString('utf-8'));
            const sUrl = info.sUrl;
            const cId = info.cId;

            const endpoint = `${sUrl}/v3/conversations/${encodeURIComponent(cId)}/activities`;

            await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    type: 'typing'
                })
            });
        } catch (e) {
            // Ignore
        }
    }
}
