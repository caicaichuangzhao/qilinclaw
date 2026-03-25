import { DatabaseManager, getDatabaseManager } from '../config/database';
import { embeddingService } from './embedding-service.js';
import { vectorStore, type VectorEntry, type SearchResult } from './vector-store.js';

export type OfficeStatus = 'busy' | 'loafing' | 'pending';

export interface Office {
    id: string;
    name: string;
    status: OfficeStatus;
    agentIds: string[];
    leaderId?: string;      // 组长 Agent ID
    currentTask?: string;   // 当前任务描述
    agentConfigs?: Record<string, { configId: string }>;  // per-agent model config
    agentRoles?: Record<string, { position: string; mission: string }>;  // per-agent role info
    botChannels?: Record<string, { channelId: string; platform: string }>;  // per-agent bot channel config
    createdAt: number;
    updatedAt: number;
}

export interface OfficeMessage {
    id: string;
    officeId: string;
    agentId: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: any[];
    timestamp: number;
}

export interface TaskDispatchResult {
    officeId: string;
    taskId: string;
    leaderId: string;
    status: 'dispatched' | 'error';
    message: string;
}

export class OfficeService {
    private db: DatabaseManager | null = null;
    private initialized: boolean = false;

    constructor() { }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        this.db = await getDatabaseManager();
        this.initialized = true;
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    // Ensure an agent can only be in one office at a time
    private removeAgentsFromOtherOffices(agentIds: string[], excludeOfficeId?: string): void {
        if (agentIds.length === 0) return;

        const placeholders = agentIds.map(() => '?').join(',');
        const params = [...agentIds];
        let sql = `DELETE FROM office_agents WHERE agent_id IN (${placeholders})`;

        if (excludeOfficeId) {
            sql += ' AND office_id != ?';
            params.push(excludeOfficeId);
        }

        this.db!.run(sql, params);

        // Touch all updated offices so their updated_at is bumped
        this.db!.run(`
            UPDATE offices
            SET updated_at = ?
            WHERE id IN (
                SELECT DISTINCT office_id FROM office_agents WHERE agent_id IN (${placeholders})
            )
        `, [Date.now(), ...agentIds]);
    }

    // Legacy methods that throw error to ensure routes are updated
    getAllOffices(): Office[] {
        throw new Error('Use _getAllOffices() directly in async routes context since migration to SQLite.');
    }

    getOffice(id: string): Office | undefined {
        throw new Error('Use _getOffice() directly in async routes context since migration to SQLite.');
    }

    createOffice(data: { name: string; status?: OfficeStatus; agentIds?: string[] }): Office {
        throw new Error('Use _createOffice() directly in async routes context since migration to SQLite.');
    }

    updateOffice(id: string, data: Partial<Office>): Office | undefined {
        throw new Error('Use _updateOffice() directly in async routes context since migration to SQLite.');
    }

    deleteOffice(id: string): boolean {
        throw new Error('Use _deleteOffice() directly in async routes context since migration to SQLite.');
    }

    private rowToOffice(row: any, agentResults: any[]): Office {
        let agentConfigs: Record<string, { configId: string }> | undefined;
        if (row.agent_configs) {
            try { agentConfigs = JSON.parse(row.agent_configs); } catch { /* ignore */ }
        }
        let agentRoles: Record<string, { position: string; mission: string }> | undefined;
        if (row.agent_roles) {
            try { agentRoles = JSON.parse(row.agent_roles); } catch { /* ignore */ }
        }
        let botChannels: Record<string, { channelId: string; platform: string }> | undefined;
        if (row.bot_channels) {
            try { botChannels = JSON.parse(row.bot_channels); } catch { /* ignore */ }
        }
        return {
            id: row.id,
            name: row.name,
            status: row.status as OfficeStatus,
            agentIds: agentResults.map((a: any) => a.agent_id),
            leaderId: row.leader_id || undefined,
            currentTask: row.current_task || undefined,
            agentConfigs,
            agentRoles,
            botChannels,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    // New Async SQLite migrated methods
    async _getAllOffices(): Promise<Office[]> {
        await this.ensureInitialized();
        const results = this.db!.all('SELECT * FROM offices ORDER BY updated_at DESC');
        const offices: Office[] = [];

        for (const row of results) {
            const agentResults = this.db!.all('SELECT agent_id FROM office_agents WHERE office_id = ?', [row.id]);
            offices.push(this.rowToOffice(row, agentResults));
        }
        return offices;
    }

    async _getOffice(id: string): Promise<Office | undefined> {
        await this.ensureInitialized();
        const row = this.db!.get('SELECT * FROM offices WHERE id = ?', [id]);
        if (!row) return undefined;

        const agentResults = this.db!.all('SELECT agent_id FROM office_agents WHERE office_id = ?', [id]);
        return this.rowToOffice(row, agentResults);
    }

    async _createOffice(data: {
        name: string;
        status?: OfficeStatus;
        agentIds?: string[];
        leaderId?: string;
        currentTask?: string;
        agentConfigs?: Record<string, { configId: string }>;
        agentRoles?: Record<string, { position: string; mission: string }>;
        botChannels?: Record<string, { channelId: string; platform: string }>;
    }): Promise<Office> {
        await this.ensureInitialized();
        const now = Date.now();
        const id = `office-${now}-${Math.random().toString(36).substr(2, 9)}`;
        const office: Office = {
            id,
            name: data.name || '新办公室',
            status: data.status || 'loafing',
            agentIds: data.agentIds || [],
            leaderId: data.leaderId,
            currentTask: data.currentTask,
            agentConfigs: data.agentConfigs,
            agentRoles: data.agentRoles,
            botChannels: data.botChannels,
            createdAt: now,
            updatedAt: now,
        };

        this.db!.transaction(() => {
            if (office.agentIds.length > 0) {
                this.removeAgentsFromOtherOffices(office.agentIds);
            }

            this.db!.run(
                'INSERT INTO offices (id, name, status, leader_id, current_task, agent_configs, agent_roles, bot_channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [office.id, office.name, office.status, office.leaderId ?? null, office.currentTask ?? null, office.agentConfigs ? JSON.stringify(office.agentConfigs) : null, office.agentRoles ? JSON.stringify(office.agentRoles) : null, office.botChannels ? JSON.stringify(office.botChannels) : null, office.createdAt, office.updatedAt]
            );

            for (const agentId of office.agentIds) {
                this.db!.run(
                    'INSERT INTO office_agents (office_id, agent_id) VALUES (?, ?)',
                    [office.id, agentId]
                );
            }
        });

        return office;
    }

    async _updateOffice(id: string, data: Partial<Office>): Promise<Office | undefined> {
        await this.ensureInitialized();
        const office = await this._getOffice(id);
        if (!office) return undefined;

        const updatedStatus = data.status || office.status;
        const updatedName = data.name || office.name;
        const updatedAgentIds = data.agentIds !== undefined ? data.agentIds : office.agentIds;
        // Allow explicit null to clear leader/task, or keep existing value
        const updatedLeaderId = data.leaderId !== undefined ? (data.leaderId || null) : (office.leaderId ?? null);
        const updatedCurrentTask = data.currentTask !== undefined ? (data.currentTask || null) : (office.currentTask ?? null);
        const updatedAgentConfigs = data.agentConfigs !== undefined ? data.agentConfigs : office.agentConfigs;
        const updatedAgentRoles = data.agentRoles !== undefined ? data.agentRoles : office.agentRoles;
        const updatedBotChannels = data.botChannels !== undefined ? data.botChannels : office.botChannels;
        const now = Date.now();

        this.db!.transaction(() => {
            if (data.agentIds !== undefined) {
                this.removeAgentsFromOtherOffices(data.agentIds, id);
                this.db!.run('DELETE FROM office_agents WHERE office_id = ?', [id]);
                for (const agentId of data.agentIds) {
                    this.db!.run('INSERT INTO office_agents (office_id, agent_id) VALUES (?, ?)', [id, agentId]);
                }
            }

            this.db!.run(
                'UPDATE offices SET name = ?, status = ?, leader_id = ?, current_task = ?, agent_configs = ?, agent_roles = ?, bot_channels = ?, updated_at = ? WHERE id = ?',
                [updatedName, updatedStatus, updatedLeaderId, updatedCurrentTask, updatedAgentConfigs ? JSON.stringify(updatedAgentConfigs) : null, updatedAgentRoles ? JSON.stringify(updatedAgentRoles) : null, updatedBotChannels ? JSON.stringify(updatedBotChannels) : null, now, id]
            );
        });

        return this._getOffice(id);
    }

    async _deleteOffice(id: string): Promise<boolean> {
        await this.ensureInitialized();
        const office = await this._getOffice(id);
        if (!office) return false;

        this.db!.transaction(() => {
            this.db!.run('DELETE FROM office_agents WHERE office_id = ?', [id]);
            this.db!.run('DELETE FROM offices WHERE id = ?', [id]);
        });

        return true;
    }

    /**
     * Dispatch a task to the office.
     * Sets current_task, changes status to 'busy', records the task ID.
     * The actual LLM orchestration (leader → members → review) is driven by the route
     * via streaming SSE so the caller can monitor progress.
     */
    async _dispatchTask(officeId: string, task: string): Promise<{ office: Office; taskId: string }> {
        await this.ensureInitialized();
        const office = await this._getOffice(officeId);
        if (!office) throw new Error('Office not found');
        if (!office.leaderId) throw new Error('该办公室未指定组长，无法下发任务');
        if (!office.agentIds.includes(office.leaderId)) throw new Error('组长不在此办公室成员列表中');

        const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const updated = await this._updateOffice(officeId, {
            status: 'busy',
            currentTask: task,
        });

        return { office: updated!, taskId };
    }

    /**
     * Mark the office task as pending acceptance (called after leader approves member work).
     */
    async _markPending(officeId: string): Promise<Office | undefined> {
        return this._updateOffice(officeId, { status: 'pending' });
    }

    /**
     * Accept/close a task: set status back to loafing and clear current_task.
     */
    async _closeTask(officeId: string): Promise<Office | undefined> {
        return this._updateOffice(officeId, { status: 'loafing', currentTask: '' });
    }

    // ── Office Messaging & Shared Memory ──────────────────────────────────────

    async _saveOfficeMessage(officeId: string, message: {
        agentId: string | null;
        role: 'user' | 'assistant' | 'system';
        content: string;
        attachments?: any[];
    }): Promise<OfficeMessage> {
        await this.ensureInitialized();
        const id = `omsg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const timestamp = Date.now();
        const msg: OfficeMessage = { id, officeId, ...message, timestamp };

        this.db!.run(
            'INSERT INTO office_messages (id, office_id, agent_id, role, content, attachments, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [msg.id, msg.officeId, msg.agentId, msg.role, msg.content, msg.attachments ? JSON.stringify(msg.attachments) : null, msg.timestamp]
        );

        try {
            const embedding = await embeddingService.generateEmbedding(msg.content);
            const tokenCount = Math.ceil(msg.content.length / 4);

            await vectorStore.addEntry(msg.content, embedding.embedding, {
                role: msg.role,
                timestamp,
                conversationId: `office-${officeId}`,
                tokenCount,
            });
            console.log(`[OfficeService] Office message saved with embedding`);
        } catch (error) {
            console.error('[OfficeService] Failed to generate embedding for office message:', error);
        }

        return msg;
    }

    async _getOfficeMessages(officeId: string, limit: number = 100): Promise<OfficeMessage[]> {
        await this.ensureInitialized();
        const rows = this.db!.all(
            'SELECT * FROM office_messages WHERE office_id = ? ORDER BY timestamp DESC LIMIT ?',
            [officeId, limit]
        );
        return (rows as any[]).map(row => ({
            id: row.id,
            officeId: row.office_id,
            agentId: row.agent_id,
            role: row.role as any,
            content: row.content,
            attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
            timestamp: row.timestamp
        })).reverse();
    }

    async _getOfficeMemory(officeId: string): Promise<Record<string, any>> {
        const fs = await import('fs');
        const path = await import('path');
        const memoryPath = path.resolve(process.cwd(), '.qilin-claw', 'office-memories', `${officeId}.json`);

        if (fs.existsSync(memoryPath)) {
            try {
                return JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
            } catch (err) {
                console.error(`Failed to parse memory for office ${officeId}:`, err);
                return {};
            }
        }
        return {};
    }

    async _updateOfficeMemory(officeId: string, updates: Record<string, any>): Promise<Record<string, any>> {
        const fs = await import('fs');
        const path = await import('path');
        const memoryDir = path.resolve(process.cwd(), '.qilin-claw', 'office-memories');
        if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

        const memoryPath = path.join(memoryDir, `${officeId}.json`);
        const current = await this._getOfficeMemory(officeId);
        const updated = { ...current, ...updates, updatedAt: Date.now() };

        fs.writeFileSync(memoryPath, JSON.stringify(updated, null, 2));
        return updated;
    }

    async _searchOfficeMessages(officeId: string, query: string, limit: number = 10, threshold: number = 0.65): Promise<SearchResult[]> {
        await this.ensureInitialized();

        try {
            const queryEmbedding = await embeddingService.generateEmbedding(query);
            const results = await vectorStore.searchSimilar(queryEmbedding.embedding, {
                conversationId: `office-${officeId}`,
                limit,
                threshold,
                queryText: query
            });
            return results;
        } catch (error) {
            console.error('[OfficeService] Failed to search office messages:', error);
            return [];
        }
    }

    async _searchAllOfficeMessages(query: string, limit: number = 10, threshold: number = 0.65): Promise<Array<{
        result: SearchResult;
        officeId: string;
        officeName?: string;
    }>> {
        await this.ensureInitialized();

        try {
            const queryEmbedding = await embeddingService.generateEmbedding(query);
            const allOffices = await this._getAllOffices();
            const officeIdToName = new Map(allOffices.map(o => [`office-${o.id}`, o.name]));

            const results = await vectorStore.searchSimilar(queryEmbedding.embedding, {
                limit,
                threshold,
                queryText: query
            });

            const officeResults = results
                .filter(r => r.entry.metadata.conversationId?.startsWith('office-'))
                .map(result => ({
                    result,
                    officeId: result.entry.metadata.conversationId.replace('office-', ''),
                    officeName: officeIdToName.get(result.entry.metadata.conversationId)
                }));

            return officeResults;
        } catch (error) {
            console.error('[OfficeService] Failed to search all office messages:', error);
            return [];
        }
    }
}

export const officeService = new OfficeService();
