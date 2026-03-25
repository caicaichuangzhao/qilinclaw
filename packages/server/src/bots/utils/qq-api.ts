/**
 * QQ Bot API 鉴权和请求封装 - QilinClaw 专用版
 * 基于官方协议实现，已移除所有第三方品牌信息。
 */

const API_BASE = "https://api.sgroup.qq.com";
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

const tokenCacheMap = new Map<string, { token: string; expiresAt: number }>();
const tokenFetchPromises = new Map<string, Promise<string>>();

/**
 * 获取 AccessToken（带缓存）
 */
export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
    const cachedToken = tokenCacheMap.get(appId);
    if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
        return cachedToken.token;
    }

    let fetchPromise = tokenFetchPromises.get(appId);
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        try {
            const response = await fetch(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ appId, clientSecret }),
            });

            if (!response.ok) {
                throw new Error(`Failed to get access_token: ${response.statusText}`);
            }

            const data = await response.json() as { access_token: string; expires_in: number };
            const expiresAt = Date.now() + (data.expires_in || 7200) * 1000;

            tokenCacheMap.set(appId, {
                token: data.access_token,
                expiresAt,
            });

            return data.access_token;
        } finally {
            tokenFetchPromises.delete(appId);
        }
    })();

    tokenFetchPromises.set(appId, fetchPromise);
    return fetchPromise;
}

/**
 * 获取全局唯一的消息序号
 */
export function getNextMsgSeq(): number {
    return Math.floor(Math.random() * 65535);
}

/**
 * API 请求封装
 */
async function apiRequest<T = any>(
    accessToken: string,
    method: string,
    path: string,
    body?: any,
    timeoutMs: number = 30000
): Promise<T> {
    const url = `${API_BASE}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method,
            headers: {
                Authorization: `QQBot ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        const data = await response.json() as T;
        if (!response.ok) {
            const err = data as any;
            throw new Error(`QQ API Error [${path}]: ${err.message || JSON.stringify(data)}`);
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * API Multipart 请求封装 (用于传图)
 */
async function apiUpload<T = any>(
    accessToken: string,
    path: string,
    formData: FormData,
    timeoutMs: number = 30000
): Promise<T> {
    const url = `${API_BASE}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `QQBot ${accessToken}`,
            },
            body: formData,
            signal: controller.signal,
        });

        const data = await response.json() as T;
        if (!response.ok) {
            const err = data as any;
            throw new Error(`QQ API Upload Error [${path}]: ${err.message || JSON.stringify(data)}`);
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * 获取 Gateway URL
 */
export async function getGatewayUrl(accessToken: string): Promise<string> {
    const data = await apiRequest<{ url: string }>(accessToken, "GET", "/gateway");
    return data.url;
}

/**
 * 发送频道消息
 */
export async function sendChannelMessage(
    accessToken: string,
    channelId: string,
    content: string,
    options?: { msgId?: string, image?: string }
): Promise<any> {
    return apiRequest(accessToken, "POST", `/channels/${channelId}/messages`, {
        content,
        ...(options?.msgId ? { msg_id: options.msgId } : {}),
        ...(options?.image ? { image: options.image } : {}),
    });
}

/**
 * 上传群文件 (返回 file_info 或者直接发送)
 */
export async function uploadGroupFile(
    accessToken: string,
    groupOpenid: string,
    fileBuffer: Buffer,
    mimeType: string,
    srvSendMsg: boolean = false
): Promise<any> {
    const formData = new FormData();
    formData.append('file_type', '1');
    formData.append('srv_send_msg', srvSendMsg ? 'true' : 'false');
    formData.append('file_data', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), 'image.jpg');

    return apiUpload(accessToken, `/v2/groups/${groupOpenid}/files`, formData);
}

/**
 * 上传 C2C (单聊) 文件 (返回 file_info 或者直接发送)
 */
export async function uploadC2CFile(
    accessToken: string,
    openid: string,
    fileBuffer: Buffer,
    mimeType: string,
    srvSendMsg: boolean = false
): Promise<any> {
    const formData = new FormData();
    formData.append('file_type', '1');
    formData.append('srv_send_msg', srvSendMsg ? 'true' : 'false');
    formData.append('file_data', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), 'image.jpg');

    return apiUpload(accessToken, `/v2/users/${openid}/files`, formData);
}

/**
 * 发送群聊消息
 */
export async function sendGroupMessage(
    accessToken: string,
    groupOpenid: string,
    content: string,
    options?: { msgId?: string, msgType?: number, mediaInfo?: any }
): Promise<any> {
    return apiRequest(accessToken, "POST", `/v2/groups/${groupOpenid}/messages`, {
        content,
        msg_type: options?.msgType !== undefined ? options.msgType : 0,
        msg_seq: getNextMsgSeq(),
        ...(options?.msgId ? { msg_id: options.msgId } : {}),
        ...(options?.mediaInfo ? { media: options.mediaInfo } : {}),
    });
}

/**
 * 发送私聊消息
 */
export async function sendC2CMessage(
    accessToken: string,
    openid: string,
    content: string,
    options?: { msgId?: string, msgType?: number, mediaInfo?: any }
): Promise<any> {
    return apiRequest(accessToken, "POST", `/v2/users/${openid}/messages`, {
        content,
        msg_type: options?.msgType !== undefined ? options.msgType : 0,
        msg_seq: getNextMsgSeq(),
        ...(options?.msgId ? { msg_id: options.msgId } : {}),
        ...(options?.mediaInfo ? { media: options.mediaInfo } : {}),
    });
}
