import { chromium } from 'playwright-extra';
import type { Browser, Page } from 'playwright';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

// Add stealth plugin to Playwright
chromium.use(stealthPlugin());

export interface FetchOptions {
  timeoutSec?: number;
  waitForSelector?: string;
  extractMainContent?: boolean; // Whether to strip nav/footer and return main content
}

export interface FetchResult {
  url: string;
  status: number;
  html: string;
  mainText?: string;
  error?: string;
}

export class StealthFetcher {
  private browser: Browser | null = null;

  async init(headless = true) {
    if (!this.browser) {
      this.browser = await chromium.launch({ 
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-webrtc'
        ]
      });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 提纯页面内容：移除广告、导航栏等，只剩下主体信息文本
   */
  private extractMainContent(html: string): string {
    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, noscript, svg, nav, footer, header, aside, .advertisement, .ads, [role="banner"], [role="navigation"], iframe').remove();

    // Check if there is an <article> or <main>
    let content = $('main').text() || $('article').text();

    if (!content.trim()) {
      // Fallback: get body text but stripped of noise
      content = $('body').text();
    }

    // Clean up whitespace
    return content.replace(/\s+/g, ' ').trim();
  }

  async fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    await this.init();
    
    const context = await this.browser!.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    const timeout = (options.timeoutSec || 30) * 1000;

    try {
      // Emulate human-like behavior (masking timezone, languages)
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      });

      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout });
      } else {
        // Just wait a little for JS frameworks to hydrate
        await page.waitForTimeout(2000);
      }

      // Random scrolling to avoid behavioral detection
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight / 2);
      });
      await page.waitForTimeout(500);

      const html = await page.content();
      const status = response ? response.status() : 0;

      let mainText;
      if (options.extractMainContent) {
        mainText = this.extractMainContent(html);
      }

      return {
        url: page.url(),
        status,
        html,
        mainText
      };
    } catch (error: any) {
      return {
        url,
        status: 0,
        html: '',
        error: error.message
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }
}

export const stealthFetcher = new StealthFetcher();
