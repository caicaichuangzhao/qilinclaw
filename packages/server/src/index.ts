// Last updated: 2026-03-13T00:40
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execCb);

// Polyfills for pdf-parse / pdf.js in Node 20+ environments
if (typeof global.DOMMatrix === 'undefined') {
    (global as any).DOMMatrix = class DOMMatrix { };
}
if (typeof global.ImageData === 'undefined') {
    (global as any).ImageData = class ImageData { };
}
if (typeof global.Path2D === 'undefined') {
    (global as any).Path2D = class Path2D { };
}

/**
 * Kill any process occupying the given port.
 * Works on Windows (netstat + taskkill) and Unix (lsof + kill).
 */
async function killPortProcess(port: number): Promise<void> {
    const isWindows = process.platform === 'win32';
    try {
        if (isWindows) {
            const { stdout } = await execAsync(`netstat -ano | findstr :${port} | findstr LISTENING`);
            const lines = stdout.trim().split('\n');
            const pids = new Set<string>();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0' && pid !== String(process.pid)) {
                    pids.add(pid);
                }
            }
            for (const pid of pids) {
                console.log(`[Port] Killing PID ${pid} occupying port ${port}`);
                await execAsync(`taskkill /F /PID ${pid}`).catch(() => { });
            }
            if (pids.size > 0) {
                await new Promise(r => setTimeout(r, 500));
            }
        } else {
            const { stdout } = await execAsync(`lsof -ti :${port}`);
            const pids = stdout.trim().split('\n').filter(Boolean);
            for (const pid of pids) {
                if (pid !== String(process.pid)) {
                    console.log(`[Port] Killing PID ${pid} occupying port ${port}`);
                    await execAsync(`kill -9 ${pid}`).catch(() => { });
                }
            }
            if (pids.length > 0) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
    } catch {
        // No process found on port — that's fine
    }
}

import { databaseService } from './services/database.js';
// Initialize with environment path if available
if (process.env.DATABASE_PATH) {
    (databaseService as any).dbPath = path.resolve(process.cwd(), process.env.DATABASE_PATH);
}
import { proxyManager } from './services/proxy-manager.js';
import { fileService } from './services/file-service.js';
import { modelsManager } from './models/manager.js';
import { botManager } from './bots/manager.js';
import { errorRecoveryService } from './safety/error-recovery.js';
import { diagnosticService } from './services/diagnostic.js';
import { rateLimiter } from './safety/rate-limiter.js';
import { fileSafetyService } from './safety/file-safety.js';
import { healthCheckService } from './services/health-check.js';
import { systemSafetyService } from './services/system-safety.js';
import { smartMemory } from './services/smart-memory.js';
import { safetyBackupService } from './services/safety-backup.js';
import { systemHealthMonitor } from './services/system-health.js';
import { usageTracker } from './services/usage-tracker.js';
import { gatewayService } from './services/gateway.js';
import { agentMemoryManager } from './services/agent-memory.js';
import { extensionBridge } from './services/extension-bridge.js';
import { ChatOrchestrator } from './services/chat-orchestrator-ref.js';
import { guiService } from './services/gui-service.js';

import { modelsRoutes } from './routes/models.js';
import { agentsRoutes } from './routes/agents.js';
import { threadsRoutes } from './routes/threads.js';
import { botsRoutes } from './routes/bots.js';
import { knowledgeRoutes } from './routes/knowledge.js';

import { memoryRoutes } from './routes/memory.js';
import { mcpRoutes } from './routes/mcp.js';
import { filesRoutes } from './routes/files.js';
import { skillsRoutes } from './routes/skills.js';
import { imageRoutes } from './routes/image.js';
import { systemRoutes } from './routes/system.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { officesRoutes } from './routes/offices.js';
import { modelsRoutes as modelRegistryRoutes } from './routes/model-registry.js';
import { tunnelRoutes } from './routes/tunnel.js';
import { modelDatabase } from './services/model-database.js';

config();

const app = express();
const server = createServer(app);

// Use noServer mode so we can manually route WebSocket upgrades by path
const wss = new WebSocketServer({ noServer: true });
const wssExtension = new WebSocketServer({ noServer: true });

// Manual upgrade routing — crucial for supporting multiple WS endpoints
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (pathname === '/ws/extension') {
        wssExtension.handleUpgrade(request, socket, head, (ws) => {
            wssExtension.emit('connection', ws, request);
        });
    } else if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

const PORT = process.env.PORT || 18168;
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const wsClients = new Set<WebSocket>();

function broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log('WebSocket client connected');

    ws.on('close', () => {
        wsClients.delete(ws);
        console.log('WebSocket client disconnected');
    });
});

// Browser Extension WebSocket endpoint
wssExtension.on('connection', (ws) => {
    console.log('[ExtensionBridge] 🌐 Browser extension connected via /ws/extension');
    extensionBridge.setConnection(ws);
});

// 监听 gatewayService 的消息事件，通过 WebSocket 推送给客户端
gatewayService.on('message', (message) => {
    broadcast(message);
});

// 监听 schedulerService 的定时任务触发，主动推送消息给前端
import { schedulerService } from './services/scheduler.js';
import { agentService } from './services/agent-service.js';

schedulerService.on('task_fired', (task: any) => {
    console.log(`[Scheduler->WS] Pushing proactive message for conversation ${task.conversationId}`);

    // Add the reminder as a message to the thread
    if (task.conversationId) {
        agentService.addMessageToThread(task.conversationId, {
            role: 'assistant',
            content: `🔔 **定时提醒**\n\n${task.message}`,
            timestamp: Date.now(),
        });
    }

    // Broadcast to all WebSocket clients — frontend will filter by conversationId
    broadcast({
        type: 'reminder',
        agentId: task.agentId,
        conversationId: task.conversationId,
        content: task.message,
        taskId: task.id,
        timestamp: Date.now(),
    });
});

app.use('/api/models', modelsRoutes);

// Extension status API
app.get('/api/extension/status', (req, res) => {
    res.json({ connected: extensionBridge.isConnected() });
});

// Agent abort endpoint — called by frontend STOP button for immediate server-side abort
// More reliable than req.on('close') which doesn't fire on HTTP keep-alive connections
app.post('/api/agent/abort', express.json(), (req, res) => {
    const { conversationId } = req.body || {};
    if (conversationId) {
        ChatOrchestrator.requestAbort(conversationId);
        guiService.cancelCurrentOperation(); // Kill any in-progress PowerShell GUI action
        console.log(`[Server] Abort requested for conversation: ${conversationId}`);
    }
    res.json({ ok: true });
});

app.use('/api', systemRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/threads', threadsRoutes);
app.use('/api/bots', botsRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/image', imageRoutes);

app.use('/', webhooksRoutes);
app.use('/api/offices', officesRoutes);
app.use('/api/models', modelRegistryRoutes);
app.use('/api/tunnel', tunnelRoutes);

// Temporary screenshot hosting for GUI vision (served to LLM API since most reject data: URLs)
const screenshotsTempDir = path.resolve(process.cwd(), '.qilin-claw', 'gui-screenshots-temp');
if (!fs.existsSync(screenshotsTempDir)) {
    fs.mkdirSync(screenshotsTempDir, { recursive: true });
}
app.use('/screenshots', express.static(screenshotsTempDir));

// Auto-clean screenshots older than 5 minutes
setInterval(() => {
    try {
        const files = fs.readdirSync(screenshotsTempDir);
        const now = Date.now();
        for (const f of files) {
            const fp = path.join(screenshotsTempDir, f);
            const stat = fs.statSync(fp);
            if (now - stat.mtimeMs > 5 * 60 * 1000) {
                fs.unlinkSync(fp);
            }
        }
    } catch (_) { }
}, 60 * 1000);

const clientDistPath = path.resolve(process.cwd(), '../client/dist');
app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) {
        return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
});

async function start(): Promise<void> {
    try {
        await modelDatabase.initialize();
        await databaseService.initialize();
        proxyManager.init();
        await fileService.initialize();

        const safetyConfig = databaseService.getSafetyConfig();
        fileSafetyService.updateConfig(safetyConfig);

        const llmConfigs = databaseService.getAllLLMConfigs();
        for (const config of llmConfigs) {
            modelsManager.addConfig(config);
        }

        const botConfigs = databaseService.getAllBotConfigs();
        for (const config of botConfigs) {
            await botManager.addBot(config);
        }

        smartMemory.startHeartbeat();
        console.log('[SmartMemory] Heartbeat started');

        agentMemoryManager.startAllHeartbeats()
            .then(() => console.log('[AgentMemory] All Agent heartbeats started'))
            .catch(e => console.error('[AgentMemory] Failed to start Agent heartbeats:', e));

        errorRecoveryService.on('error', (record) => {
            console.error(`[ErrorRecovery] Error recorded: ${record.context}`, record.error?.message || record.error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('[Process] Unhandled Rejection:', reason);
        });

        process.on('uncaughtException', (error) => {
            console.error('[Process] Uncaught Exception:', error);
        });

        errorRecoveryService.registerHealthCheck('database', async () => {
            try {
                databaseService.getSafetyConfig();
                return true;
            } catch {
                return false;
            }
        });

        errorRecoveryService.registerHealthCheck('fileService', async () => {
            try {
                await fileService.listFiles('');
                return true;
            } catch {
                return false;
            }
        });

        // Auto-release port if occupied
        await killPortProcess(Number(PORT));

        server.listen(Number(PORT), '0.0.0.0', async () => {
            console.log(`🐉 Qilin Claw server running on http://localhost:${PORT}`);
            console.log(`Workspace: ${WORKSPACE_ROOT}`);

            await systemSafetyService.initialize();

            if (!systemSafetyService.getCurrentBackup()) {
                console.log('[SystemSafety] Creating initial backup...');
                await systemSafetyService.createBackup('auto', '系统启动时自动备份');
            }

            try {
                const runningBots = botManager.getRunningBots();
                const allEnabledBots = botManager.getAllBots().filter(b => b.enabled);
                const bots = allEnabledBots.filter(b => !runningBots.includes(b.id));

                const startPromises = bots.map(async (bot) => {
                    try {
                        await botManager.startBot(bot.id);
                        console.log(`[Bot] Started: ${bot.name} (${bot.platform})`);
                    } catch (error) {
                        console.error(`[Bot] Failed to start ${bot.name}:`, error);
                    }
                });
                await Promise.allSettled(startPromises);
            } catch (error) {
                console.error('[Bot] Failed to start bots:', error);
            }
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await botManager.stopAll();
    databaseService.close();
    server.close();
});