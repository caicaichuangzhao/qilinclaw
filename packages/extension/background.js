/**
 * QilinClaw Browser Bridge — Background Service Worker
 * 
 * Connects to QilinClaw server via WebSocket and dispatches browser commands
 * from the AI agent to the user's real browser tabs.
 * 
 * Connection preference is persisted:
 * - User clicks Connect → autoConnect=true (reconnects on startup & on close)
 * - User clicks Disconnect → autoConnect=false (stays disconnected until manually connected)
 */

// --- State ---
let ws = null;
let connected = false;
let autoConnect = false; // Persisted in chrome.storage.local
let serverUrl = 'ws://localhost:18168/ws/extension';
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

// --- WebSocket Connection ---

function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
    }

    try {
        ws = new WebSocket(serverUrl);
    } catch (e) {
        console.error('[QilinClaw] Failed to create WebSocket:', e);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        console.log('[QilinClaw] Connected to server:', serverUrl);
        connected = true;
        reconnectDelay = 1000;
        updateBadge('ON', '#22c55e');
        // Announce ourselves
        ws.send(JSON.stringify({ type: 'extension_hello', version: '1.0.0' }));
    };

    ws.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'command') {
                const result = await executeCommand(msg.action, msg.params || {}, msg.requestId);
                ws.send(JSON.stringify({
                    type: 'command_result',
                    requestId: msg.requestId,
                    result: result
                }));
            } else if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (err) {
            console.error('[QilinClaw] Message handling error:', err);
            if (event.data) {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.requestId) {
                        ws.send(JSON.stringify({
                            type: 'command_result',
                            requestId: msg.requestId,
                            result: { error: err.message }
                        }));
                    }
                } catch (_) { }
            }
        }
    };

    ws.onclose = () => {
        console.log('[QilinClaw] Disconnected from server');
        connected = false;
        ws = null;
        updateBadge('OFF', '#ef4444');
        // Only auto-reconnect if user preference is to stay connected
        if (autoConnect) {
            scheduleReconnect();
        }
    };

    ws.onerror = (err) => {
        console.error('[QilinClaw] WebSocket error:', err);
    };
}

function disconnect() {
    // Clear any pending reconnect
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    // Close the WebSocket — onclose will NOT reconnect because autoConnect is false
    if (ws) {
        ws.close();
        ws = null;
    }
    connected = false;
    updateBadge('OFF', '#ef4444');
}

function scheduleReconnect() {
    if (reconnectTimer || !autoConnect) return;
    console.log(`[QilinClaw] Reconnecting in ${reconnectDelay}ms...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
        connect();
    }, reconnectDelay);
}

function updateBadge(text, color) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
}

// --- Command Execution ---

async function executeCommand(action, params, requestId) {
    console.log(`[QilinClaw] Executing: ${action}`, params);

    try {
        switch (action) {
            case 'navigate':
                return await cmdNavigate(params.url, params.tabId);
            case 'extractDOM':
                return await cmdExtractDOM(params.tabId);
            case 'click':
                return await cmdClick(params.selector, params.tabId);
            case 'type':
                return await cmdType(params.selector, params.text, params.tabId);
            case 'pressKey':
                return await cmdPressKey(params.key, params.tabId);
            case 'screenshot':
                return await cmdScreenshot();
            case 'scroll':
                return await cmdScroll(params.direction, params.amount, params.selector, params.tabId);
            case 'select':
                return await cmdSelect(params.selector, params.value, params.tabId);
            case 'hover':
                return await cmdHover(params.selector, params.tabId);
            case 'goBack':
                return await cmdGoBack(params.tabId);
            case 'goForward':
                return await cmdGoForward(params.tabId);
            case 'refresh':
                return await cmdRefresh(params.tabId);
            case 'closeTab':
                return await cmdCloseTab(params.tabId);
            case 'evaluateJS':
                return await cmdEvalJS(params.script, params.tabId);
            case 'wait':
                return await cmdWait(params.selector, params.timeout, params.tabId);
            default:
                return { error: `Unknown action: ${action}` };
        }
    } catch (err) {
        console.error(`[QilinClaw] Command ${action} failed:`, err);
        return { error: err.message || String(err) };
    }
}

// --- Helper: Get target tab ---

async function getTargetTab(tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');
    return tab;
}

// --- Helper: Inject script and get result ---

async function injectScript(tabId, func, args = []) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args,
        world: 'MAIN'
    });
    if (results && results[0]) {
        return results[0].result;
    }
    return null;
}

// --- Commands ---

async function cmdNavigate(url, tabId) {
    let tab = await getTargetTab(tabId);

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    await chrome.tabs.update(tab.id, { url, active: true });

    // Wait for page load
    await new Promise((resolve) => {
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 15000);
    });

    await sleep(500);
    return await cmdExtractDOM(tabId);
}

async function cmdExtractDOM(tabId) {
    const tab = await getTargetTab(tabId);

    try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractDOM' });
        return { success: true, url: tab.url, title: tab.title, content: response };
    } catch (err) {
        // Content script might not be loaded yet, inject it
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
            await sleep(200);
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractDOM' });
            return { success: true, url: tab.url, title: tab.title, content: response };
        } catch (err2) {
            return { error: `Failed to extract DOM: ${err2.message}` };
        }
    }
}

async function cmdClick(selector, tabId) {
    const tab = await getTargetTab(tabId);
    const result = await injectScript(tab.id, (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true, text: el.textContent?.substring(0, 100) };
    }, [selector]);

    if (result?.error) return result;
    await sleep(800);
    const dom = await cmdExtractDOM(tabId);
    return { ...result, dom: dom.content || dom };
}

async function cmdType(selector, text, tabId) {
    const tab = await getTargetTab(tabId);
    const result = await injectScript(tab.id, (sel, txt) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        el.focus();
        el.value = '';
        el.value = txt;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
    }, [selector, text]);

    if (result?.error) return result;
    await sleep(300);
    const dom = await cmdExtractDOM(tabId);
    return { ...result, dom: dom.content || dom };
}

async function cmdPressKey(key, tabId) {
    const tab = await getTargetTab(tabId);
    const result = await injectScript(tab.id, (keyName) => {
        const keyMap = {
            'enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
            'tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
            'escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
            'backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
            'arrowup': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
            'arrowdown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
            'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
            'arrowright': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        };
        const k = keyMap[keyName.toLowerCase()] || { key: keyName, code: `Key${keyName.toUpperCase()}`, keyCode: keyName.charCodeAt(0) };
        const target = document.activeElement || document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keypress', { ...k, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { ...k, bubbles: true }));
        if (keyName.toLowerCase() === 'enter' && target.form) {
            target.form.dispatchEvent(new Event('submit', { bubbles: true }));
        }
        return { success: true };
    }, [key]);

    await sleep(500);
    const dom = await cmdExtractDOM(tabId);
    return { ...result, dom: dom.content || dom };
}

async function cmdScreenshot() {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        return { success: true, screenshot: dataUrl };
    } catch (err) {
        return { error: `Screenshot failed: ${err.message}` };
    }
}

async function cmdScroll(direction, amount, selector, tabId) {
    const tab = await getTargetTab(tabId);
    const scrollAmount = amount || 3;
    const pixels = scrollAmount * 200;

    await injectScript(tab.id, (dir, px, sel) => {
        const target = sel ? document.querySelector(sel) : window;
        const scrollOpts = dir === 'up' ? { top: -px } : { top: px };
        if (target === window) {
            window.scrollBy({ ...scrollOpts, behavior: 'smooth' });
        } else if (target) {
            target.scrollBy({ ...scrollOpts, behavior: 'smooth' });
        }
    }, [direction, pixels, selector]);

    await sleep(500);
    const dom = await cmdExtractDOM(tabId);
    return { success: true, dom: dom.content || dom };
}

async function cmdSelect(selector, value, tabId) {
    const tab = await getTargetTab(tabId);
    const result = await injectScript(tab.id, (sel, val) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
    }, [selector, value]);
    return result;
}

async function cmdHover(selector, tabId) {
    const tab = await getTargetTab(tabId);
    const result = await injectScript(tab.id, (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        return { success: true };
    }, [selector]);
    return result;
}

async function cmdGoBack(tabId) {
    const tab = await getTargetTab(tabId);
    await chrome.tabs.goBack(tab.id);
    await sleep(1500);
    const dom = await cmdExtractDOM(tabId);
    return { success: true, dom: dom.content || dom };
}

async function cmdGoForward(tabId) {
    const tab = await getTargetTab(tabId);
    await chrome.tabs.goForward(tab.id);
    await sleep(1500);
    const dom = await cmdExtractDOM(tabId);
    return { success: true, dom: dom.content || dom };
}

async function cmdRefresh(tabId) {
    const tab = await getTargetTab(tabId);
    await chrome.tabs.reload(tab.id);
    await sleep(2000);
    const dom = await cmdExtractDOM(tabId);
    return { success: true, dom: dom.content || dom };
}

async function cmdCloseTab(tabId) {
    const tab = await getTargetTab(tabId);
    await chrome.tabs.remove(tab.id);
    return { success: true };
}

async function cmdEvalJS(script, tabId) {
    const tab = await getTargetTab(tabId);
    try {
        const result = await injectScript(tab.id, (code) => {
            try {
                return { success: true, result: String(eval(code)) };
            } catch (e) {
                return { error: e.message };
            }
        }, [script]);
        return result;
    } catch (err) {
        return { error: err.message };
    }
}

async function cmdWait(selector, timeout, tabId) {
    const tab = await getTargetTab(tabId);
    const maxWait = timeout || 10000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
        const found = await injectScript(tab.id, (sel) => {
            return !!document.querySelector(sel);
        }, [selector]);

        if (found) {
            return { success: true, message: `Element ${selector} found` };
        }
        await sleep(500);
    }

    return { error: `Timeout waiting for element: ${selector}` };
}

// --- Utility ---

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Message Listener (from popup) ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getStatus') {
        sendResponse({ connected, serverUrl, autoConnect });
    } else if (msg.action === 'connect') {
        // User explicitly wants to connect → persist preference
        serverUrl = msg.serverUrl || serverUrl;
        autoConnect = true;
        chrome.storage.local.set({ serverUrl, autoConnect: true });

        // Reset reconnect state and connect
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectDelay = 1000;
        disconnect();
        // Small delay to ensure clean disconnect before reconnect
        setTimeout(() => {
            autoConnect = true; // Re-set after disconnect() would have been called
            connect();
        }, 100);
        sendResponse({ ok: true });
    } else if (msg.action === 'disconnect') {
        // User explicitly wants to disconnect → persist preference
        autoConnect = false;
        chrome.storage.local.set({ autoConnect: false });
        disconnect();
        sendResponse({ ok: true });
    }
    return true;
});

// --- Startup ---
// Load persisted preferences and auto-connect if user previously chose to connect

chrome.storage.local.get(['serverUrl', 'autoConnect'], (data) => {
    if (data.serverUrl) {
        serverUrl = data.serverUrl;
    }
    if (data.autoConnect) {
        autoConnect = true;
        connect();
    } else {
        updateBadge('OFF', '#ef4444');
    }
});
