import { DatabaseManager, getDatabaseManager } from '../config/database.js';
import { Request } from 'express';

export interface AuditLogEntry {
    id: string;
    timestamp: number;
    eventType: AuditEventType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    userId?: string;
    apiKeyId?: string;
    ipAddress: string;
    userAgent: string;
    resource: string;
    action: string;
    details: Record<string, any>;
    success: boolean;
    errorMessage?: string;
}

export type AuditEventType =
    | 'auth.login'
    | 'auth.logout'
    | 'auth.failed_login'
    | 'auth.api_key_created'
    | 'auth.api_key_revoked'
    | 'auth.password_changed'
    | 'auth.session_expired'
    | 'file.read'
    | 'file.write'
    | 'file.delete'
    | 'file.upload'
    | 'file.download'
    | 'model.call'
    | 'model.config_created'
    | 'model.config_updated'
    | 'model.config_deleted'
    | 'agent.created'
    | 'agent.updated'
    | 'agent.deleted'
    | 'knowledge.document_uploaded'
    | 'knowledge.document_deleted'
    | 'knowledge.search'
    | 'security.validation_failed'
    | 'security.injection_attempt'
    | 'security.rate_limit_exceeded'
    | 'security.unauthorized_access'
    | 'security.suspicious_activity'
    | 'system.backup_created'
    | 'system.backup_restored'
    | 'system.config_changed';

export class AuditLogger {
    private db: DatabaseManager | null = null;
    private initialized: boolean = false;
    private logBuffer: AuditLogEntry[] = [];
    private flushInterval: NodeJS.Timeout | null = null;
    private readonly BUFFER_SIZE = 100;
    private readonly FLUSH_INTERVAL = 5000;

    async initialize(): Promise<void> {
        if (this.initialized) return;
        this.db = await getDatabaseManager();
        await this.createTable();
        this.startFlushInterval();
        this.initialized = true;
        console.log('[AuditLogger] Initialized');
    }

    private async createTable(): Promise<void> {
        this.db!.run(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                user_id TEXT,
                api_key_id TEXT,
                ip_address TEXT NOT NULL,
                user_agent TEXT,
                resource TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT,
                success INTEGER NOT NULL,
                error_message TEXT
            )
        `);

        this.db!.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)`);
        this.db!.run(`CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_logs(event_type)`);
        this.db!.run(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id)`);
        this.db!.run(`CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_logs(severity)`);
    }

    async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
        const fullEntry: AuditLogEntry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            ...entry,
        };

        this.logBuffer.push(fullEntry);

        if (this.logBuffer.length >= this.BUFFER_SIZE) {
            await this.flush();
        }

        if (entry.severity === 'high' || entry.severity === 'critical') {
            console.warn(`[AuditLog][${entry.severity.toUpperCase()}] ${entry.eventType}: ${entry.action} by ${entry.userId || entry.apiKeyId || 'anonymous'} from ${entry.ipAddress}`);
        }
    }

    async logRequest(req: Request, eventType: AuditEventType, details: Record<string, any> = {}, success: boolean = true, errorMessage?: string): Promise<void> {
        const auth = (req as any).auth;
        
        await this.log({
            eventType,
            severity: this.getSeverityForEventType(eventType, success),
            userId: auth?.id,
            apiKeyId: auth?.type === 'apikey' ? auth.id : undefined,
            ipAddress: this.getClientIp(req),
            userAgent: req.headers['user-agent'] || 'unknown',
            resource: req.path,
            action: req.method,
            details,
            success,
            errorMessage,
        });
    }

    private getSeverityForEventType(eventType: AuditEventType, success: boolean): 'low' | 'medium' | 'high' | 'critical' {
        if (!success) {
            if (eventType.startsWith('security.') || eventType.includes('failed')) {
                return 'high';
            }
            return 'medium';
        }

        const severityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
            'auth.login': 'low',
            'auth.logout': 'low',
            'auth.failed_login': 'high',
            'auth.api_key_created': 'medium',
            'auth.api_key_revoked': 'medium',
            'auth.password_changed': 'medium',
            'auth.session_expired': 'low',
            'file.read': 'low',
            'file.write': 'medium',
            'file.delete': 'high',
            'file.upload': 'medium',
            'file.download': 'low',
            'model.call': 'low',
            'model.config_created': 'medium',
            'model.config_updated': 'medium',
            'model.config_deleted': 'high',
            'agent.created': 'medium',
            'agent.updated': 'medium',
            'agent.deleted': 'high',
            'knowledge.document_uploaded': 'medium',
            'knowledge.document_deleted': 'high',
            'knowledge.search': 'low',
            'security.validation_failed': 'high',
            'security.injection_attempt': 'critical',
            'security.rate_limit_exceeded': 'medium',
            'security.unauthorized_access': 'high',
            'security.suspicious_activity': 'critical',
            'system.backup_created': 'medium',
            'system.backup_restored': 'high',
            'system.config_changed': 'high',
        };

        return severityMap[eventType] || 'low';
    }

    private getClientIp(req: Request): string {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        if (Array.isArray(forwarded)) {
            return forwarded[0].trim();
        }
        return req.socket?.remoteAddress || 'unknown';
    }

    private async flush(): Promise<void> {
        if (this.logBuffer.length === 0 || !this.db) return;

        const entries = [...this.logBuffer];
        this.logBuffer = [];

        try {
            this.db!.transaction(() => {
                for (const entry of entries) {
                    this.db!.run(`
                        INSERT INTO audit_logs (
                            id, timestamp, event_type, severity, user_id, api_key_id,
                            ip_address, user_agent, resource, action, details, success, error_message
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        entry.id,
                        entry.timestamp,
                        entry.eventType,
                        entry.severity,
                        entry.userId || null,
                        entry.apiKeyId || null,
                        entry.ipAddress,
                        entry.userAgent,
                        entry.resource,
                        entry.action,
                        JSON.stringify(entry.details),
                        entry.success ? 1 : 0,
                        entry.errorMessage || null,
                    ]);
                }
            });
        } catch (error) {
            console.error('[AuditLogger] Failed to flush logs:', error);
            this.logBuffer.unshift(...entries);
        }
    }

    private startFlushInterval(): void {
        this.flushInterval = setInterval(() => {
            this.flush().catch(err => console.error('[AuditLogger] Flush error:', err));
        }, this.FLUSH_INTERVAL);
    }

    async query(options: {
        startTime?: number;
        endTime?: number;
        eventTypes?: AuditEventType[];
        userId?: string;
        severity?: ('low' | 'medium' | 'high' | 'critical')[];
        success?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<AuditLogEntry[]> {
        await this.flush();

        let query = 'SELECT * FROM audit_logs WHERE 1=1';
        const params: any[] = [];

        if (options.startTime) {
            query += ' AND timestamp >= ?';
            params.push(options.startTime);
        }

        if (options.endTime) {
            query += ' AND timestamp <= ?';
            params.push(options.endTime);
        }

        if (options.eventTypes && options.eventTypes.length > 0) {
            query += ` AND event_type IN (${options.eventTypes.map(() => '?').join(',')})`;
            params.push(...options.eventTypes);
        }

        if (options.userId) {
            query += ' AND user_id = ?';
            params.push(options.userId);
        }

        if (options.severity && options.severity.length > 0) {
            query += ` AND severity IN (${options.severity.map(() => '?').join(',')})`;
            params.push(...options.severity);
        }

        if (options.success !== undefined) {
            query += ' AND success = ?';
            params.push(options.success ? 1 : 0);
        }

        query += ' ORDER BY timestamp DESC';

        if (options.limit) {
            query += ' LIMIT ?';
            params.push(options.limit);
        }

        if (options.offset) {
            query += ' OFFSET ?';
            params.push(options.offset);
        }

        const rows = this.db!.all(query, params);

        return rows.map(row => ({
            id: row.id,
            timestamp: row.timestamp,
            eventType: row.event_type as AuditEventType,
            severity: row.severity as 'low' | 'medium' | 'high' | 'critical',
            userId: row.user_id || undefined,
            apiKeyId: row.api_key_id || undefined,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            resource: row.resource,
            action: row.action,
            details: JSON.parse(row.details || '{}'),
            success: row.success === 1,
            errorMessage: row.error_message || undefined,
        }));
    }

    async getStats(startTime?: number, endTime?: number): Promise<{
        totalEvents: number;
        failedEvents: number;
        eventsByType: Record<string, number>;
        eventsBySeverity: Record<string, number>;
        topUsers: Array<{ userId: string; count: number }>;
        topIpAddresses: Array<{ ipAddress: string; count: number }>;
    }> {
        await this.flush();

        const start = startTime || Date.now() - 24 * 60 * 60 * 1000;
        const end = endTime || Date.now();

        const totalResult = this.db!.get(
            'SELECT COUNT(*) as count FROM audit_logs WHERE timestamp BETWEEN ? AND ?',
            [start, end]
        );

        const failedResult = this.db!.get(
            'SELECT COUNT(*) as count FROM audit_logs WHERE timestamp BETWEEN ? AND ? AND success = 0',
            [start, end]
        );

        const typeResults = this.db!.all(
            'SELECT event_type, COUNT(*) as count FROM audit_logs WHERE timestamp BETWEEN ? AND ? GROUP BY event_type ORDER BY count DESC LIMIT 20',
            [start, end]
        );

        const severityResults = this.db!.all(
            'SELECT severity, COUNT(*) as count FROM audit_logs WHERE timestamp BETWEEN ? AND ? GROUP BY severity',
            [start, end]
        );

        const userResults = this.db!.all(
            'SELECT user_id, COUNT(*) as count FROM audit_logs WHERE timestamp BETWEEN ? AND ? AND user_id IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT 10',
            [start, end]
        );

        const ipResults = this.db!.all(
            'SELECT ip_address, COUNT(*) as count FROM audit_logs WHERE timestamp BETWEEN ? AND ? GROUP BY ip_address ORDER BY count DESC LIMIT 10',
            [start, end]
        );

        return {
            totalEvents: totalResult?.count || 0,
            failedEvents: failedResult?.count || 0,
            eventsByType: Object.fromEntries(typeResults.map(r => [r.event_type, r.count])),
            eventsBySeverity: Object.fromEntries(severityResults.map(r => [r.severity, r.count])),
            topUsers: userResults.map(r => ({ userId: r.user_id, count: r.count })),
            topIpAddresses: ipResults.map(r => ({ ipAddress: r.ip_address, count: r.count })),
        };
    }

    async cleanup(olderThanDays: number = 30): Promise<number> {
        const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
        const result = this.db!.run('DELETE FROM audit_logs WHERE timestamp < ?', [cutoff]);
        console.log(`[AuditLogger] Cleaned up ${result.changes} old audit logs`);
        return result.changes;
    }

    stop(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.flush().catch(err => console.error('[AuditLogger] Final flush error:', err));
    }
}

export const auditLogger = new AuditLogger();
