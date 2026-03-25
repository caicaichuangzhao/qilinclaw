import puppeteer, { Browser, Page } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';

export class BrowserService {
    private static instance: BrowserService;
    private browser: Browser | null = null;
    private pages: Map<string, Page> = new Map();
    private lastOperations: Map<string, { op: string; time: number; args: any }> = new Map();
    private readonly REPEAT_WINDOW_MS = 10000;
    private readonly MAX_REPEATS = 2;

    private constructor() { }

    public static getInstance(): BrowserService {
        if (!BrowserService.instance) {
            BrowserService.instance = new BrowserService();
        }
        return BrowserService.instance;
    }

    private checkRepeatOperation(op: string, identifier: string, args: any): boolean {
        const key = `${op}-${identifier}`;
        const now = Date.now();
        const lastOp = this.lastOperations.get(key);

        if (lastOp) {
            if (now - lastOp.time < this.REPEAT_WINDOW_MS) {
                const argsMatch = JSON.stringify(lastOp.args) === JSON.stringify(args);
                if (argsMatch) {
                    console.log(`[BrowserService] Blocked repeat operation: ${op} on ${identifier}`);
                    return true;
                }
            }
        }

        this.lastOperations.set(key, { op, time: now, args });
        return false;
    }

    private normalizeUrl(url: string): string {
        let normalized = url.trim().toLowerCase();
        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
            normalized = 'https://' + normalized;
        }
        try {
            const urlObj = new URL(normalized);
            urlObj.hash = '';
            // Keep query params — they distinguish different pages (e.g. search results)
            let hostname = urlObj.hostname;
            if (hostname.startsWith('www.')) {
                hostname = hostname.substring(4);
            }
            urlObj.hostname = hostname;
            return urlObj.toString().replace(/\/$/, '');
        } catch {
            return normalized.replace(/\/$/, '');
        }
    }

    public async getBrowser(): Promise<Browser> {
        if (!this.browser) {
            const userDataDir = path.join(process.cwd(), '.qilin-claw', 'browser-data');
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }

            const possibleEdgePaths = [
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
            ];
            let executablePath = undefined;
            for (const p of possibleEdgePaths) {
                if (fs.existsSync(p)) {
                    executablePath = p;
                    break;
                }
            }

            this.browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                executablePath,
                userDataDir,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });
            console.log('[BrowserService] Puppeteer browser launched');
        }
        return this.browser;
    }

    public async getPage(identifier: string = 'default'): Promise<Page> {
        if (this.pages.has(identifier)) {
            const page = this.pages.get(identifier)!;
            if (!page.isClosed()) {
                return page;
            }
        }

        const browser = await this.getBrowser();
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        this.pages.set(identifier, page);
        return page;
    }

    public async closePage(identifier: string = 'default'): Promise<void> {
        if (this.pages.has(identifier)) {
            const page = this.pages.get(identifier)!;
            if (!page.isClosed()) {
                await page.close();
            }
            this.pages.delete(identifier);
        }
    }

    public async closeAll(): Promise<void> {
        for (const [, page] of this.pages.entries()) {
            if (!page.isClosed()) {
                await page.close();
            }
        }
        this.pages.clear();

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    public async extractCurrentPage(identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);

        const pageContent = await page.evaluate(() => {
            const getSelector = (el: HTMLElement) => {
                if (el.id) return '#' + el.id;
                let path = el.tagName.toLowerCase();
                if (el.className && typeof el.className === 'string') {
                    const classes = el.className.split(' ').filter(c => c.trim()).slice(0, 2).map(c => '.' + c).join('');
                    if (classes) path += classes;
                }
                return path;
            };

            const interactives: string[] = [];
            const allElements = document.querySelectorAll('*');
            let matchedCount = 0;
            const seenTexts = new Set<string>();

            allElements.forEach((el) => {
                if (matchedCount > 400) return;
                const htmlEl = el as HTMLElement;

                if (['SCRIPT', 'STYLE', 'META', 'HEAD', 'LINK', 'NOSCRIPT'].includes(htmlEl.tagName)) return;

                const style = window.getComputedStyle(htmlEl);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

                const tagName = htmlEl.tagName.toLowerCase();
                const isStandard = ['a', 'button', 'input', 'select', 'textarea'].includes(tagName);
                const isRoleButton = htmlEl.getAttribute('role') === 'button' || htmlEl.getAttribute('role') === 'tab' || htmlEl.getAttribute('role') === 'link';
                const isPointer = style.cursor === 'pointer';

                if (!isStandard && !isRoleButton && !isPointer) return;

                const rect = htmlEl.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    let desc = '';
                    if (tagName === 'a') {
                        const anchor = el as HTMLAnchorElement;
                        const linkText = anchor.innerText.trim().substring(0, 60);
                        const href = anchor.href;
                        // Show both text and href for better navigation decisions
                        desc = 'Link: ' + (linkText || '[no text]') + (href ? ' → ' + href : '');
                    }
                    else if (tagName === 'button') desc = 'Button: ' + (el as HTMLButtonElement).innerText.substring(0, 60);
                    else if (tagName === 'input') {
                        const inputEl = el as HTMLInputElement;
                        desc = 'Input [' + inputEl.type + ']: placeholder=' + "'" + inputEl.placeholder + "'" + ' value=' + "'" + inputEl.value + "'";
                    }
                    else if (tagName === 'textarea') {
                        const textEl = el as HTMLTextAreaElement;
                        desc = 'Textarea: placeholder=' + "'" + textEl.placeholder + "'";
                    }
                    else if (tagName === 'select') {
                        const selectEl = el as HTMLSelectElement;
                        const options = Array.from(selectEl.options).map(o => o.text).slice(0, 5).join(', ');
                        desc = 'Select: options=[' + options + '] current=' + selectEl.value;
                    }
                    else {
                        desc = htmlEl.tagName + ' [Interactive]: ' + htmlEl.innerText.substring(0, 50);
                    }

                    const selector = getSelector(htmlEl);
                    desc = desc.trim() || el.tagName + ' Element';
                    if (desc.includes('Element') && rect.width > 300) return;

                    // Dedup: skip links with identical display text
                    const dedupeKey = desc.substring(0, 80);
                    if (seenTexts.has(dedupeKey)) return;
                    seenTexts.add(dedupeKey);

                    if (desc) {
                        interactives.push('- ' + desc.replace(/\n| /g, ' ') + ' (Selector: ' + selector + ')');
                        matchedCount++;
                    }
                }
            });

            const bodyClone = document.body.cloneNode(true) as HTMLElement;
            const elementsToRemove = bodyClone.querySelectorAll('script, style, svg, noscript, iframe');
            elementsToRemove.forEach(el => el.remove());

            const textContent = bodyClone.innerText.replace(/\n{3,}/g, '\n\n').substring(0, 8000);

            return '## PAGE TITLE\n' + document.title + '\n\n## URL\n' + window.location.href + '\n\n## VISIBLE TEXT (Truncated)\n' + textContent + '\n\n## INTERACTIVE ELEMENTS\n' + interactives.join('\n');
        });

        return pageContent;
    }

    public async openAndExtract(url: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        const currentUrl = page.url();

        // Skip navigation if already on the target URL (compare normalized, but allow re-navigation for about:blank)
        if (currentUrl !== 'about:blank') {
            const normalizedCurrentUrl = this.normalizeUrl(currentUrl);
            const normalizedFinalUrl = this.normalizeUrl(targetUrl);

            console.log('[BrowserService] URL check:', { current: normalizedCurrentUrl, target: normalizedFinalUrl });

            if (normalizedCurrentUrl === normalizedFinalUrl) {
                console.log('[BrowserService] Already on target URL, returning current page state');
                const currentPage = await this.extractCurrentPage(identifier);
                return '[SUCCESS] 页面已处于目标URL。当前URL: ' + currentUrl + '\n你可以直接使用 browser_click / browser_type / browser_scroll 等工具与页面交互。\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
            }
        }

        try {
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        } catch (error) {
            return '[ERROR] 页面加载失败: ' + String(error);
        }

        const finalUrl = page.url();
        const extractedPage = await this.extractCurrentPage(identifier);
        return '[SUCCESS] 页面已成功打开。最终URL: ' + finalUrl + '\n\n--- CURRENT PAGE STATE ---\n' + extractedPage;
    }

    public async clickElement(selector: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            await page.click(selector);
            await new Promise(r => setTimeout(r, 2000));

            const updatedPage = await this.extractCurrentPage(identifier);
            return '[OK] Clicked element ' + selector + '\n\n--- UPDATED PAGE STATE ---\n' + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return '[ERROR] Failed to click element ' + selector + ': ' + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async typeText(selector: string, text: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 10000 });

            // Click to focus and position cursor
            await page.click(selector);
            await new Promise(r => setTimeout(r, 200));

            // Clear existing content using keyboard shortcuts (works with SPAs and contenteditable)
            // Select all → Delete
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await new Promise(r => setTimeout(r, 100));
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 200));

            // Type the new text character by character (Puppeteer dispatches keydown/keypress/keyup/input events)
            await page.type(selector, text, { delay: 30 });

            // Dispatch native input & change events for React/Vue/Angular compatibility
            await page.evaluate((sel) => {
                const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
                if (el) {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, selector);

            await new Promise(r => setTimeout(r, 600));
            const updatedPage = await this.extractCurrentPage(identifier);
            return '[OK] Typed text into ' + selector + ': "' + text + '"\n\n--- UPDATED PAGE STATE ---\n' + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return '[ERROR] Failed to type into ' + selector + ': ' + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async refreshPage(identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 1000));
            const updatedPage = await this.extractCurrentPage(identifier);
            return '[OK] Page refreshed\n\n--- UPDATED PAGE STATE ---\n' + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return '[ERROR] Failed to refresh page: ' + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async takeScreenshot(identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
            return 'data:image/png;base64,' + screenshot;
        } catch (e) {
            return '[ERROR] Failed to take screenshot: ' + String(e);
        }
    }

    public async pressKey(key: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.keyboard.press(key as any);
            await new Promise(r => setTimeout(r, 1000));
            const updatedPage = await this.extractCurrentPage(identifier);
            return '[OK] Pressed key ' + key + '\n\n--- UPDATED PAGE STATE ---\n' + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return '[ERROR] Failed to press key ' + key + ': ' + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async scrollPage(direction: string, amount?: number, selector?: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            if (selector) {
                // Scroll to a specific element
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, selector);
            } else {
                const pixels = amount || 500;
                const scrollY = direction === 'up' ? -pixels : pixels;
                await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), scrollY);
            }
            await new Promise(r => setTimeout(r, 800));
            const updatedPage = await this.extractCurrentPage(identifier);
            const desc = selector ? `to element ${selector}` : `${direction} ${amount || 500}px`;
            return `[OK] Scrolled ${desc}\n\n--- UPDATED PAGE STATE ---\n` + updatedPage;
        } catch (e) {
            return '[ERROR] Failed to scroll: ' + String(e);
        }
    }

    public async waitForElement(selector: string, timeout: number = 10000, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.waitForSelector(selector, { visible: true, timeout });
            const updatedPage = await this.extractCurrentPage(identifier);
            return `[OK] Element ${selector} found\n\n--- UPDATED PAGE STATE ---\n` + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return `[ERROR] Element ${selector} not found within ${timeout}ms\n\n--- CURRENT PAGE STATE ---\n` + currentPage;
        }
    }

    public async selectOption(selector: string, value: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            await page.select(selector, value);
            await new Promise(r => setTimeout(r, 500));
            const updatedPage = await this.extractCurrentPage(identifier);
            return `[OK] Selected value "${value}" in ${selector}\n\n--- UPDATED PAGE STATE ---\n` + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return `[ERROR] Failed to select option in ${selector}: ` + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async hoverElement(selector: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            await page.hover(selector);
            await new Promise(r => setTimeout(r, 800));
            const updatedPage = await this.extractCurrentPage(identifier);
            return `[OK] Hovered over ${selector}\n\n--- UPDATED PAGE STATE ---\n` + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return `[ERROR] Failed to hover over ${selector}: ` + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async goBack(identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.goBack({ waitUntil: 'networkidle2', timeout: 15000 });
            await new Promise(r => setTimeout(r, 1000));
            const updatedPage = await this.extractCurrentPage(identifier);
            return '[OK] Navigated back\n\n--- UPDATED PAGE STATE ---\n' + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return '[ERROR] Failed to go back: ' + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async goForward(identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            await page.goForward({ waitUntil: 'networkidle2', timeout: 15000 });
            await new Promise(r => setTimeout(r, 1000));
            const updatedPage = await this.extractCurrentPage(identifier);
            return '[OK] Navigated forward\n\n--- UPDATED PAGE STATE ---\n' + updatedPage;
        } catch (e) {
            const currentPage = await this.extractCurrentPage(identifier);
            return '[ERROR] Failed to go forward: ' + String(e) + '\n\n--- CURRENT PAGE STATE ---\n' + currentPage;
        }
    }

    public async closeTab(identifier: string = 'default'): Promise<string> {
        try {
            await this.closePage(identifier);
            return `[OK] Tab "${identifier}" closed`;
        } catch (e) {
            return `[ERROR] Failed to close tab "${identifier}": ` + String(e);
        }
    }

    public async evaluateJS(script: string, identifier: string = 'default'): Promise<string> {
        const page = await this.getPage(identifier);
        try {
            const result = await page.evaluate((code) => {
                try {
                    const res = eval(code);
                    return JSON.stringify(res, null, 2) || 'undefined';
                } catch (e) {
                    return 'Error: ' + String(e);
                }
            }, script);
            return `[OK] JS Result:\n${result}`;
        } catch (e) {
            return '[ERROR] Failed to evaluate JS: ' + String(e);
        }
    }
}

export const browserService = BrowserService.getInstance();
