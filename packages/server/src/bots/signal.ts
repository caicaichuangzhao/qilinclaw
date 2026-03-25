import { BaseBotAdapter, BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';

export class SignalAdapter extends BaseBotAdapter {
    readonly platform = 'signal' as const;
    private endpoint: string;
    private phoneNumber: string;
    private isConnecting = false;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastTimestamp = Date.now();

    constructor(config: BotConfig) {
        super(config);
        this.endpoint = config.config.endpoint as string;
        this.phoneNumber = config.config.phoneNumber as string;

        // Ensure endpoint does not end with a slash
        if (this.endpoint && this.endpoint.endsWith('/')) {
            this.endpoint = this.endpoint.slice(0, -1);
        }
    }

    async start(): Promise<void> {
        if (this.isConnecting || this.isRunning()) return;
        this.isConnecting = true;
        try {
            if (!this.endpoint || !this.phoneNumber) {
                throw new Error('Signal Endpoint and Phone Number are required');
            }

            // Check connection
            const res = await fetch(`${this.endpoint}/v1/about`);
            if (!res.ok) throw new Error('Cannot connect to Signal REST API');

            this.setRunning(true);
            console.log(`[Signal] Adapter started for ${this.config.name}`);

            // Start polling for messages
            this.startPolling();
        } catch (error) {
            console.error('[Signal] Failed to start:', error);
            this.emit('error', error as Error);
        } finally {
            this.isConnecting = false;
        }
    }

    async stop(): Promise<void> {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.setRunning(false);
        console.log(`[Signal] Adapter stopped for ${this.config.name}`);
    }

    private startPolling() {
        // Poll every 3 seconds
        this.pollInterval = setInterval(async () => {
            if (!this.isRunning()) return;
            try {
                // Signal API mode for receiving
                const res = await fetch(`${this.endpoint}/v1/receive/${this.phoneNumber}`);
                if (!res.ok) return;

                const messages = await res.json();
                if (!Array.isArray(messages)) return;

                for (const msg of messages) {
                    if (msg.envelope && msg.envelope.dataMessage) {
                        const data = msg.envelope.dataMessage;
                        const timestamp = data.timestamp;
                        if (timestamp <= this.lastTimestamp) continue;

                        // Treat individual chat contacts as the channel id in Signal
                        const sender = msg.envelope.sourceNumber || msg.envelope.sourceUuid;

                        const botMessage: BotMessage = {
                            id: timestamp.toString(),
                            platform: 'signal',
                            channelId: sender, // Individual chat is the channel here
                            userId: sender,
                            username: msg.envelope.sourceName || sender,
                            content: data.message || '',
                            timestamp: timestamp,
                        };
                        this.lastTimestamp = timestamp;
                        this.emitMessage(botMessage);
                    }
                }
            } catch (err) {
                // Silently ignore polling network errors
            }
        }, 3000);
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{type: string, dataUrl: string, name: string}>): Promise<string> {
        try {
            const response = await fetch(`${this.endpoint}/v2/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: content,
                    number: this.phoneNumber,
                    recipients: [channelId]
                })
            });
            const data = await response.json() as any;
            if (!response.ok) {
                console.error('[Signal] Error sending message:', data);
                return '';
            }
            return data.timestamp?.toString() || Date.now().toString();
        } catch (e) {
            console.error('[Signal] Exception sending message:', e);
            return '';
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        try {
            const response = await fetch(`${this.endpoint}/v1/typing-indicator/${this.phoneNumber}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: channelId
                })
            });
            if (!response.ok) {
                console.error('[Signal] Error sending typing indicator');
            }
        } catch (e) {
            console.error('[Signal] Exception sending typing indicator:', e);
        }
    }
}
