/**
 * QilinClaw Browser Bridge — Content Script
 * 
 * Extracts page DOM structure and interactive elements.
 * Format is compatible with BrowserService.extractCurrentPage() output.
 */

(function () {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'extractDOM') {
            try {
                const result = extractPageContent();
                sendResponse(result);
            } catch (err) {
                sendResponse({ error: err.message });
            }
        }
        return true;
    });

    function getSelector(el) {
        if (el.id) return `#${el.id}`;

        // Try unique attribute selectors
        if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
        if (el.getAttribute('name')) {
            const byName = document.querySelectorAll(`[name="${el.getAttribute('name')}"]`);
            if (byName.length === 1) return `[name="${el.getAttribute('name')}"]`;
        }

        // Build path with tag + nth-child
        const parts = [];
        let current = el;
        while (current && current !== document.body && parts.length < 5) {
            let selector = current.tagName.toLowerCase();
            if (current.className && typeof current.className === 'string') {
                const cls = current.className.trim().split(/\s+/)
                    .filter(c => c && !c.includes(':') && c.length < 30)
                    .slice(0, 2)
                    .map(c => `.${CSS.escape(c)}`)
                    .join('');
                if (cls) selector += cls;
            }

            // Add nth-child if not unique
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
                if (siblings.length > 1) {
                    const idx = siblings.indexOf(current) + 1;
                    selector += `:nth-child(${Array.from(parent.children).indexOf(current) + 1})`;
                }
            }

            parts.unshift(selector);

            // Check if current path is unique
            const testSelector = parts.join(' > ');
            try {
                if (document.querySelectorAll(testSelector).length === 1) {
                    return testSelector;
                }
            } catch (_) { }

            current = current.parentElement;
        }

        return parts.join(' > ');
    }

    function extractPageContent() {
        const title = document.title || '';
        const url = window.location.href;

        // Extract main text content (truncated)
        const bodyText = document.body?.innerText || '';
        const textPreview = bodyText.substring(0, 3000);

        // Extract interactive elements
        const interactiveElements = [];
        const seen = new Set();

        // Links
        document.querySelectorAll('a[href]').forEach((el, i) => {
            if (i > 50) return;
            const text = (el.textContent || '').trim().substring(0, 80);
            if (!text || seen.has(text)) return;
            seen.add(text);
            const sel = getSelector(el);
            interactiveElements.push({
                type: 'link',
                selector: sel,
                text: text,
                href: el.href
            });
        });

        // Buttons
        document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el, i) => {
            if (i > 30) return;
            const text = (el.textContent || el.value || el.title || '').trim().substring(0, 80);
            if (!text) return;
            const sel = getSelector(el);
            interactiveElements.push({
                type: 'button',
                selector: sel,
                text: text
            });
        });

        // Input fields
        document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((el, i) => {
            if (i > 20) return;
            const sel = getSelector(el);
            const label = el.placeholder || el.getAttribute('aria-label') || el.name || el.type || '';
            interactiveElements.push({
                type: el.tagName.toLowerCase() === 'select' ? 'select' : 'input',
                selector: sel,
                inputType: el.type || 'text',
                placeholder: label,
                value: el.value || ''
            });
        });

        // Format output compatible with BrowserService.extractCurrentPage()
        let output = `📄 PAGE TITLE: ${title}\n🔗 URL: ${url}\n\n`;
        output += `--- PAGE CONTENT ---\n${textPreview}\n\n`;
        output += `--- INTERACTIVE ELEMENTS ---\n`;

        interactiveElements.forEach((el, i) => {
            if (el.type === 'link') {
                output += `[${i}] 🔗 LINK: "${el.text}" → selector: \`${el.selector}\`\n`;
            } else if (el.type === 'button') {
                output += `[${i}] 🔘 BUTTON: "${el.text}" → selector: \`${el.selector}\`\n`;
            } else if (el.type === 'input') {
                output += `[${i}] ✏️ INPUT [${el.inputType}]: "${el.placeholder}" → selector: \`${el.selector}\`${el.value ? ` (value: "${el.value}")` : ''}\n`;
            } else if (el.type === 'select') {
                output += `[${i}] 📋 SELECT: "${el.placeholder}" → selector: \`${el.selector}\`\n`;
            }
        });

        output += `\nTotal interactive elements: ${interactiveElements.length}`;

        return output;
    }
})();
