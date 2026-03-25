import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

/**
 * ExtensionBridge — manages the WebSocket connection to the QilinClaw browser extension.
 *
 * Provides the same interface as BrowserService, but executes commands in the user's
 * real browser via the extension. Falls back gracefully when extension is not connected.
 */

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class ExtensionBridge {
    private static instance: ExtensionBridge;
    private ws: WebSocket | null = null;
    private _connected = false;
    private pendingRequests = new Map<string, PendingRequest>();
    private readonly COMMAND_TIMEOUT = 30000; // 30s timeout per command

    private constructor() { }

    public static getInstance(): ExtensionBridge {
        if (!ExtensionBridge.instance) {
            ExtensionBridge.instance = new ExtensionBridge();
        }
        return ExtensionBridge.instance;
    }

    /**
     * Called by the server when a browser extension connects via WebSocket.
     */
    public setConnection(ws: WebSocket) {
        // Close previous connection if any
        if (this.ws) {
            try { this.ws.close(); } catch (_) { }
        }

        this.ws = ws;
        this._connected = true;
        console.log('[ExtensionBridge] Browser extension connected');

        ws.on('message', (data: Buffer | string) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'command_result' && msg.requestId) {
                    const pending = this.pendingRequests.get(msg.requestId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pendingRequests.delete(msg.requestId);
                        pending.resolve(msg.result);
                    }
                } else if (msg.type === 'extension_hello') {
                    console.log(`[ExtensionBridge] Extension version: ${msg.version}`);
                } else if (msg.type === 'pong') {
                    // heartbeat response
                }
            } catch (err) {
                console.error('[ExtensionBridge] Message parse error:', err);
            }
        });

        ws.on('close', () => {
            console.log('[ExtensionBridge] Browser extension disconnected');
            this._connected = false;
            this.ws = null;
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Extension disconnected'));
            }
            this.pendingRequests.clear();
        });

        ws.on('error', (err) => {
            console.error('[ExtensionBridge] WebSocket error:', err.message);
        });

        // Start heartbeat
        const heartbeat = setInterval(() => {
            if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            } else {
                clearInterval(heartbeat);
            }
        }, 30000);
    }

    /**
     * Check if the browser extension is connected and ready.
     */
    public isConnected(): boolean {
        return this._connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Send a command to the extension and wait for the result.
     */
    private async sendCommand(action: string, params: Record<string, any> = {}): Promise<any> {
        if (!this.isConnected()) {
            throw new Error('Browser extension is not connected');
        }

        const requestId = randomUUID();

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Extension command '${action}' timed out after ${this.COMMAND_TIMEOUT}ms`));
            }, this.COMMAND_TIMEOUT);

            this.pendingRequests.set(requestId, { resolve, reject, timer });

            this.ws!.send(JSON.stringify({
                type: 'command',
                action,
                params,
                requestId
            }));
        });
    }

    // --- BrowserService-compatible methods ---

    /**
     * Navigate to URL and extract page content.
     * Returns formatted string compatible with BrowserService.openAndExtract()
     */
    public async openAndExtract(url: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('navigate', { url, tabId });
        if (result.error) {
            return `[ERROR] ${result.error}`;
        }
        // The extension returns { success, url, title, content }
        // content is the formatted DOM string from content.js
        const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        return `[OK] Page opened in real browser: ${result.url || url}\n\n${content}`;
    }

    public async clickElement(selector: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('click', { selector, tabId });
        if (result.error) return `[ERROR] Click failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Clicked: ${result.text || selector}\n\n${dom}`;
    }

    public async typeText(selector: string, text: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('type', { selector, text, tabId });
        if (result.error) return `[ERROR] Type failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Typed "${text}" into ${selector}\n\n${dom}`;
    }

    public async pressKey(key: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('pressKey', { key, tabId });
        if (result.error) return `[ERROR] PressKey failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Pressed key: ${key}\n\n${dom}`;
    }

    public async takeScreenshot(tabId?: string): Promise<string> {
        const result = await this.sendCommand('screenshot', {});
        if (result.error) return `[ERROR] Screenshot failed: ${result.error}`;
        return result.screenshot; // base64 data URL
    }

    public async refreshPage(tabId?: string): Promise<string> {
        const result = await this.sendCommand('refresh', { tabId });
        if (result.error) return `[ERROR] Refresh failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Page refreshed\n\n${dom}`;
    }

    public async scrollPage(direction: string, amount?: number, selector?: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('scroll', { direction, amount, selector, tabId });
        if (result.error) return `[ERROR] Scroll failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Scrolled ${direction}\n\n${dom}`;
    }

    public async waitForElement(selector: string, timeout?: number, tabId?: string): Promise<string> {
        const result = await this.sendCommand('wait', { selector, timeout, tabId });
        if (result.error) return `[ERROR] Wait failed: ${result.error}`;
        return `[OK] ${result.message}`;
    }

    public async selectOption(selector: string, value: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('select', { selector, value, tabId });
        if (result.error) return `[ERROR] Select failed: ${result.error}`;
        return `[OK] Selected value "${value}" in ${selector}`;
    }

    public async hoverElement(selector: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('hover', { selector, tabId });
        if (result.error) return `[ERROR] Hover failed: ${result.error}`;
        return `[OK] Hovered on ${selector}`;
    }

    public async goBack(tabId?: string): Promise<string> {
        const result = await this.sendCommand('goBack', { tabId });
        if (result.error) return `[ERROR] GoBack failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Navigated back\n\n${dom}`;
    }

    public async goForward(tabId?: string): Promise<string> {
        const result = await this.sendCommand('goForward', { tabId });
        if (result.error) return `[ERROR] GoForward failed: ${result.error}`;
        const dom = result.dom ? (typeof result.dom === 'string' ? result.dom : JSON.stringify(result.dom)) : '';
        return `[OK] Navigated forward\n\n${dom}`;
    }

    public async closeTab(tabId?: string): Promise<string> {
        const result = await this.sendCommand('closeTab', { tabId });
        if (result.error) return `[ERROR] CloseTab failed: ${result.error}`;
        return `[OK] Tab closed`;
    }

    public async evaluateJS(script: string, tabId?: string): Promise<string> {
        const result = await this.sendCommand('evaluateJS', { script, tabId });
        if (result.error) return `[ERROR] EvalJS failed: ${result.error}`;
        return result.result || '[OK]';
    }
}

export const extensionBridge = ExtensionBridge.getInstance();
