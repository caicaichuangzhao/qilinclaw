import { setGlobalDispatcher, ProxyAgent, EnvHttpProxyAgent, Agent } from 'undici';
import { databaseService } from './database.js';

class ProxyManager {
    private currentDispatcher: any = null;

    init() {
        this.applyProxyConfig();
    }

    applyProxyConfig() {
        const config = databaseService.getSafetyConfig();
        try {
            if (config.enableProxy && config.proxyUrl) {
                console.log(`[ProxyManager] Enabling Global HTTP Proxy: ${config.proxyUrl}`);
                const proxyAgent = new ProxyAgent({ uri: config.proxyUrl });
                setGlobalDispatcher(proxyAgent);
                this.currentDispatcher = proxyAgent;
            } else {
                console.log('[ProxyManager] Using Custom Agent with DNS servers');
                // Create a default agent without custom DNS (undici doesn't support this option)
                const agent = new Agent();
                setGlobalDispatcher(agent);
                this.currentDispatcher = agent;
            }
        } catch (error) {
            console.error('[ProxyManager] Failed to apply proxy settings:', error);
            // Fallback to default agent
            setGlobalDispatcher(new EnvHttpProxyAgent());
            this.currentDispatcher = null;
        }
    }
}

export const proxyManager = new ProxyManager();
