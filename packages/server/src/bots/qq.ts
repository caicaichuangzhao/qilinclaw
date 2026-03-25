import { BaseBotAdapter, type BotMessage } from './base.js';
import type { BotConfig } from '../types/index.js';
import WebSocket from 'ws';
import * as qqApi from './utils/qq-api.js';

export class QQAdapter extends BaseBotAdapter {
    readonly platform = 'qq';
    private ws: WebSocket | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private lastSeq: number | null = null;
    private sessionId: string | null = null;
    private lastMsgId: Map<string, string> = new Map(); // Cache msgId for proper replies
    private appId: string;
    private appSecret: string;
    private intentLevel = 0;

    // Official Intent Levels: from full permissions to basic channel permissions
    private readonly INTENT_LEVELS = [
        (1 << 30) | (1 << 25) | (1 << 12) | (1 << 1) | (1 << 0), // Level 0: Guilds + Members + Public Messages + Group/C2C + DM
        (1 << 30) | (1 << 25),                                   // Level 1: Public Guild Messages + Group/C2C
        (1 << 30) | (1 << 1) | (1 << 0),                        // Level 2: Basic Guild permissions
    ];

    constructor(config: BotConfig) {
        super(config);
        this.appId = config.config.appId as string;
        this.appSecret = config.config.appSecret as string;
    }

    async start(): Promise<void> {
        if (!this.appId || !this.appSecret) {
            throw new Error('QQ AppID and AppSecret are required');
        }

        try {
            this.setRunning(true);
            this.connect();
        } catch (error) {
            console.error('[QQ] Failed to start:', error);
            this.setRunning(false);
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.setRunning(false);
        this.cleanup();
    }

    private cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
    }

    private async connect(): Promise<void> {
        if (!this.isRunning()) return;
        this.cleanup();

        try {
            const accessToken = await qqApi.getAccessToken(this.appId, this.appSecret);
            const gatewayUrl = await qqApi.getGatewayUrl(accessToken);

            console.log(`[QQ] Connecting to gateway: ${gatewayUrl} (Intent Level: ${this.intentLevel})`);
            this.ws = new WebSocket(gatewayUrl);

            this.ws.on('message', (data) => this.onWSMessage(data.toString(), accessToken));

            this.ws.on('close', (code, reason) => {
                console.log(`[QQ] WebSocket closed: ${code} ${reason}`);
                if (this.isRunning()) {
                    const delay = Math.min(5000 + (this.intentLevel * 2000), 30000);
                    setTimeout(() => this.connect(), delay);
                }
            });

            this.ws.on('error', (err) => {
                console.error('[QQ] WebSocket error:', err);
                this.emit('error', err);
            });
        } catch (error) {
            console.error('[QQ] Connection initialization failed:', error);
            if (this.isRunning()) {
                setTimeout(() => this.connect(), 10000);
            }
        }
    }

    private onWSMessage(rawData: string, accessToken: string) {
        let payload: any;
        try {
            payload = JSON.parse(rawData);
        } catch (e) { return; }

        const { op, d, s, t } = payload;

        // Log basic info without branding
        if (op !== 11) { // Avoid heartbeat logs
            console.log(`[QQ Gateway] OpCode: ${op}, Type: ${t || 'N/A'}`);
        }

        if (s !== undefined && s !== null) {
            this.lastSeq = s;
        }

        switch (op) {
            case 10: // Hello
                console.log('[QQ Gateway] Handshake started');
                this.startHeartbeat(d.heartbeat_interval);
                this.identify(accessToken);
                break;
            case 11: // Heartbeat ACK
                break;
            case 0: // Dispatch
                this.handleEvent(t, d);
                break;
            case 7: // Reconnect request from server
                console.log('[QQ Gateway] Server requested reconnect');
                this.connect();
                break;
            case 9: // Invalid Session / Intent Error
                console.warn(`[QQ Gateway] Invalid session or intent permissions. Current Level: ${this.intentLevel}`);
                this.intentLevel++;
                if (this.intentLevel >= this.INTENT_LEVELS.length) {
                    this.intentLevel = 0; // Cycle back
                }
                this.sessionId = null;
                this.lastSeq = null;
                this.connect();
                break;
            default:
                if (op !== 11) {
                    console.log(`[QQ Gateway] Received OpCode: ${op}`);
                }
        }
    }

    private startHeartbeat(interval: number) {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
            }
        }, interval);
    }

    private identify(accessToken: string) {
        const payload = {
            op: 2,
            d: {
                token: `QQBot ${accessToken}`,
                intents: this.INTENT_LEVELS[this.intentLevel],
                shard: [0, 1],
                properties: {
                    $os: process.platform,
                    $browser: 'qilinclaw',
                    $device: 'qilinclaw',
                },
            },
        };
        this.ws?.send(JSON.stringify(payload));
    }

    private async handleEvent(type: string, data: any) {
        if (type === 'READY') {
            this.sessionId = data.session_id;
            console.log(`[QQ] Connected as ${data.user.username}`);
            return;
        }

        let botMsg: BotMessage | null = null;

        const attachments = (data.attachments || []).map((a: any) => {
            let url = a.url;
            if (url && !url.startsWith('http')) {
                url = `https://${url}`;
            }
            return {
                type: a.content_type || 'image/jpeg',
                url,
                name: a.filename || 'attachment.jpg'
            };
        });

        if (type === 'C2C_MESSAGE_CREATE') {
            botMsg = {
                id: data.id,
                platform: this.platform,
                channelId: data.author.user_openid,
                userId: data.author.user_openid,
                username: 'QQ用户',
                content: data.content,
                timestamp: new Date(data.timestamp).getTime(),
                attachments: attachments.length > 0 ? attachments : undefined,
            };
        } else if (type === 'GROUP_AT_MESSAGE_CREATE') {
            botMsg = {
                id: data.id,
                platform: this.platform,
                channelId: data.group_openid,
                userId: data.author.member_openid,
                username: '群成员',
                content: (data.content || '').replace(/<@!\d+>/g, '').trim(),
                timestamp: new Date(data.timestamp).getTime(),
                attachments: attachments.length > 0 ? attachments : undefined,
            };
        } else if (type === 'AT_MESSAGE_CREATE') {
            botMsg = {
                id: data.id,
                platform: this.platform,
                channelId: data.channel_id,
                userId: data.author.id,
                username: data.author.username,
                content: (data.content || '').replace(/<@!\d+>/g, '').trim(),
                timestamp: new Date(data.timestamp).getTime(),
                attachments: attachments.length > 0 ? attachments : undefined,
            };
        }

        if (botMsg) {
            this.lastMsgId.set(botMsg.channelId, botMsg.id);
            this.emitMessage(botMsg);
        }
    }

    async sendMessage(channelId: string, content: string, attachments?: Array<{ type: string, dataUrl: string, name: string }>): Promise<string> {
        const accessToken = await qqApi.getAccessToken(this.appId, this.appSecret);
        const replyMsgId = this.lastMsgId.get(channelId);

        let res: any;
        try {
            // 1. Send text first if it exists
            const textContent = content.trim();
            if (textContent) {
                if (channelId.includes('GROUP_')) {
                    res = await qqApi.sendGroupMessage(accessToken, channelId, textContent, { msgId: replyMsgId });
                } else if (channelId.startsWith('u_') || channelId.length > 20) {
                    res = await qqApi.sendC2CMessage(accessToken, channelId, textContent, { msgId: replyMsgId });
                } else {
                    res = await qqApi.sendChannelMessage(accessToken, channelId, textContent, { msgId: replyMsgId });
                }
            }

            // 2. Send images one by one
            if (attachments && attachments.length > 0) {
                for (const attachment of attachments) {
                    if (attachment.dataUrl && attachment.dataUrl.startsWith('data:')) {
                        const base64Data = attachment.dataUrl.split(',')[1];
                        if (base64Data) {
                            const buffer = Buffer.from(base64Data, 'base64');

                            if (channelId.includes('GROUP_')) {
                                const uploadRes = await qqApi.uploadGroupFile(accessToken, channelId, buffer, attachment.type);
                                if (uploadRes && uploadRes.file_info) {
                                    res = await qqApi.sendGroupMessage(accessToken, channelId, " ", { msgType: 7, mediaInfo: { file_info: uploadRes.file_info } });
                                }
                            } else if (channelId.startsWith('u_') || channelId.length > 20) {
                                const uploadRes = await qqApi.uploadC2CFile(accessToken, channelId, buffer, attachment.type);
                                if (uploadRes && uploadRes.file_info) {
                                    res = await qqApi.sendC2CMessage(accessToken, channelId, " ", { msgType: 7, mediaInfo: { file_info: uploadRes.file_info } });
                                }
                            } else {
                                // Fallback for Guilds since they use a different file_image upload format not yet supported here
                                await qqApi.sendChannelMessage(accessToken, channelId, `[系统提示] 模型发送了一张图片 (${attachment.name})，频道暂不支持显示。`);
                            }
                        }
                    }
                }
            }

            // Fallback for empty messages with no supported attachments
            if (!textContent && (!attachments || attachments.length === 0)) {
                if (channelId.includes('GROUP_')) {
                    res = await qqApi.sendGroupMessage(accessToken, channelId, " ", { msgId: replyMsgId });
                } else if (channelId.startsWith('u_') || channelId.length > 20) {
                    res = await qqApi.sendC2CMessage(accessToken, channelId, " ", { msgId: replyMsgId });
                } else {
                    res = await qqApi.sendChannelMessage(accessToken, channelId, " ", { msgId: replyMsgId });
                }
            }

            this.lastMsgId.delete(channelId);
            return res ? res.id : '';
        } catch (error) {
            console.error('[QQ] Send message error:', error);
            throw error;
        }
    }

    async sendTyping(channelId: string): Promise<void> {
        // Optional: Implement typing status
    }
}
