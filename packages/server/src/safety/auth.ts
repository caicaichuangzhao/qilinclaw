import { Request, Response, NextFunction } from 'express';
import { encryptionService } from './encryption.js';
import { DatabaseManager, getDatabaseManager } from '../config/database.js';

export interface AuthUser {
    id: string;
    username: string;
    role: 'admin' | 'user' | 'readonly';
    permissions: string[];
    createdAt: number;
    lastLogin?: number;
}

export interface ApiKey {
    id: string;
    name: string;
    key: string;
    keyHash: string;
    userId: string;
    permissions: string[];
    rateLimit: number;
    expiresAt?: number;
    createdAt: number;
    lastUsed?: number;
    enabled: boolean;
}

export interface Session {
    id: string;
    userId: string;
    token: string;
    createdAt: number;
    expiresAt: number;
    ipAddress: string;
    userAgent: string;
}

export class AuthService {
    private db: DatabaseManager | null = null;
    private initialized: boolean = false;
    private sessions: Map<string, Session> = new Map();
    private apiKeys: Map<string, ApiKey> = new Map();

    async initialize(): Promise<void> {
        if (this.initialized) return;
        this.db = await getDatabaseManager();
        await this.createTables();
        await this.loadApiKeys();
        this.startCleanupInterval();
        this.initialized = true;
        console.log('[AuthService] Initialized');
    }

    private async createTables(): Promise<void> {
        this.db!.run(`
            CREATE TABLE IF NOT EXISTS auth_users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                permissions TEXT DEFAULT '[]',
                created_at INTEGER NOT NULL,
                last_login INTEGER,
                enabled INTEGER DEFAULT 1
            )
        `);

        this.db!.run(`
            CREATE TABLE IF NOT EXISTS auth_api_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                key TEXT UNIQUE NOT NULL,
                key_hash TEXT NOT NULL,
                user_id TEXT NOT NULL,
                permissions TEXT DEFAULT '[]',
                rate_limit INTEGER DEFAULT 60,
                expires_at INTEGER,
                created_at INTEGER NOT NULL,
                last_used INTEGER,
                enabled INTEGER DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES auth_users(id)
            )
        `);

        this.db!.run(`
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                FOREIGN KEY (user_id) REFERENCES auth_users(id)
            )
        `);

        const adminExists = this.db!.get('SELECT id FROM auth_users WHERE role = ?', ['admin']);
        if (!adminExists) {
            await this.createDefaultAdmin();
        }
    }

    private async createDefaultAdmin(): Promise<void> {
        const adminId = `user-${Date.now()}`;
        const defaultPassword = 'admin123';
        const passwordHash = encryptionService.hashPassword(defaultPassword);

        this.db!.run(`
            INSERT INTO auth_users (id, username, password_hash, role, permissions, created_at, enabled)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [adminId, 'admin', passwordHash, 'admin', JSON.stringify(['*']), Date.now()]);

        console.log('[AuthService] Default admin created: admin / admin123');
        console.log('[AuthService] ⚠️  Please change the default password immediately!');
    }

    private async loadApiKeys(): Promise<void> {
        const keys = this.db!.all('SELECT * FROM auth_api_keys WHERE enabled = 1');
        for (const key of keys) {
            this.apiKeys.set(key.key, {
                id: key.id,
                name: key.name,
                key: key.key,
                keyHash: key.key_hash,
                userId: key.user_id,
                permissions: JSON.parse(key.permissions || '[]'),
                rateLimit: key.rate_limit,
                expiresAt: key.expires_at,
                createdAt: key.created_at,
                lastUsed: key.last_used,
                enabled: key.enabled === 1,
            });
        }
    }

    async login(username: string, password: string, ipAddress: string, userAgent: string): Promise<{ success: boolean; token?: string; user?: AuthUser; error?: string }> {
        const userRow = this.db!.get('SELECT * FROM auth_users WHERE username = ? AND enabled = 1', [username]);

        if (!userRow) {
            return { success: false, error: 'Invalid credentials' };
        }

        if (!encryptionService.verifyPassword(password, userRow.password_hash)) {
            return { success: false, error: 'Invalid credentials' };
        }

        const token = encryptionService.generateToken();
        const sessionId = `session-${Date.now()}`;
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

        this.db!.run(`
            INSERT INTO auth_sessions (id, user_id, token, created_at, expires_at, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [sessionId, userRow.id, token, Date.now(), expiresAt, ipAddress, userAgent]);

        this.db!.run('UPDATE auth_users SET last_login = ? WHERE id = ?', [Date.now(), userRow.id]);

        const user: AuthUser = {
            id: userRow.id,
            username: userRow.username,
            role: userRow.role,
            permissions: JSON.parse(userRow.permissions || '[]'),
            createdAt: userRow.created_at,
            lastLogin: Date.now(),
        };

        this.sessions.set(token, {
            id: sessionId,
            userId: userRow.id,
            token,
            createdAt: Date.now(),
            expiresAt,
            ipAddress,
            userAgent,
        });

        return { success: true, token, user };
    }

    async logout(token: string): Promise<void> {
        const session = this.sessions.get(token);
        if (session) {
            this.db!.run('DELETE FROM auth_sessions WHERE id = ?', [session.id]);
            this.sessions.delete(token);
        }
    }

    async validateToken(token: string): Promise<AuthUser | null> {
        const session = this.sessions.get(token);
        
        if (!session) {
            const sessionRow = this.db!.get('SELECT * FROM auth_sessions WHERE token = ? AND expires_at > ?', [token, Date.now()]);
            if (!sessionRow) return null;

            const userRow = this.db!.get('SELECT * FROM auth_users WHERE id = ? AND enabled = 1', [sessionRow.user_id]);
            if (!userRow) return null;

            this.sessions.set(token, {
                id: sessionRow.id,
                userId: sessionRow.user_id,
                token: sessionRow.token,
                createdAt: sessionRow.created_at,
                expiresAt: sessionRow.expires_at,
                ipAddress: sessionRow.ip_address,
                userAgent: sessionRow.user_agent,
            });

            return {
                id: userRow.id,
                username: userRow.username,
                role: userRow.role,
                permissions: JSON.parse(userRow.permissions || '[]'),
                createdAt: userRow.created_at,
                lastLogin: userRow.last_login,
            };
        }

        if (session.expiresAt < Date.now()) {
            await this.logout(token);
            return null;
        }

        const userRow = this.db!.get('SELECT * FROM auth_users WHERE id = ? AND enabled = 1', [session.userId]);
        if (!userRow) return null;

        return {
            id: userRow.id,
            username: userRow.username,
            role: userRow.role,
            permissions: JSON.parse(userRow.permissions || '[]'),
            createdAt: userRow.created_at,
            lastLogin: userRow.last_login,
        };
    }

    async createApiKey(userId: string, name: string, permissions: string[] = ['*'], rateLimit: number = 60, expiresIn?: number): Promise<ApiKey> {
        const key = encryptionService.generateApiKey();
        const keyHash = encryptionService.hashPassword(key);
        const id = `apikey-${Date.now()}`;
        const expiresAt = expiresIn ? Date.now() + expiresIn : undefined;

        this.db!.run(`
            INSERT INTO auth_api_keys (id, name, key, key_hash, user_id, permissions, rate_limit, expires_at, created_at, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [id, name, key, keyHash, userId, JSON.stringify(permissions), rateLimit, expiresAt, Date.now()]);

        const apiKey: ApiKey = {
            id,
            name,
            key,
            keyHash,
            userId,
            permissions,
            rateLimit,
            expiresAt,
            createdAt: Date.now(),
            enabled: true,
        };

        this.apiKeys.set(key, apiKey);
        return apiKey;
    }

    async validateApiKey(key: string): Promise<ApiKey | null> {
        const apiKey = this.apiKeys.get(key);

        if (!apiKey) return null;

        if (!apiKey.enabled) return null;

        if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
            this.apiKeys.delete(key);
            return null;
        }

        this.db!.run('UPDATE auth_api_keys SET last_used = ? WHERE id = ?', [Date.now(), apiKey.id]);

        return apiKey;
    }

    async revokeApiKey(keyId: string): Promise<boolean> {
        const result = this.db!.run('UPDATE auth_api_keys SET enabled = 0 WHERE id = ?', [keyId]);
        
        for (const [key, apiKey] of this.apiKeys) {
            if (apiKey.id === keyId) {
                this.apiKeys.delete(key);
                break;
            }
        }

        return result.changes > 0;
    }

    hasPermission(user: AuthUser | ApiKey, permission: string): boolean {
        if (user.permissions.includes('*')) return true;
        if (user.permissions.includes(permission)) return true;

        const permissionParts = permission.split(':');
        for (const p of user.permissions) {
            const parts = p.split(':');
            if (parts.length === 2 && parts[1] === '*' && parts[0] === permissionParts[0]) {
                return true;
            }
        }

        return false;
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [token, session] of this.sessions) {
                if (session.expiresAt < now) {
                    this.sessions.delete(token);
                }
            }

            this.db!.run('DELETE FROM auth_sessions WHERE expires_at < ?', [now]);
        }, 60 * 60 * 1000);
    }

    getApiKeys(): ApiKey[] {
        return Array.from(this.apiKeys.values());
    }

    getSessions(): Session[] {
        return Array.from(this.sessions.values());
    }
}

export const authService = new AuthService();

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];

    try {
        if (apiKeyHeader && typeof apiKeyHeader === 'string') {
            const apiKey = await authService.validateApiKey(apiKeyHeader);
            if (apiKey) {
                (req as any).auth = { type: 'apikey', ...apiKey };
                return next();
            }
        }

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const user = await authService.validateToken(token);
            if (user) {
                (req as any).auth = { type: 'user', ...user };
                return next();
            }
        }

        return res.status(401).json({ error: 'Unauthorized' });
    } catch (error) {
        console.error('[AuthMiddleware] Error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

export const optionalAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];

    try {
        if (apiKeyHeader && typeof apiKeyHeader === 'string') {
            const apiKey = await authService.validateApiKey(apiKeyHeader);
            if (apiKey) {
                (req as any).auth = { type: 'apikey', ...apiKey };
            }
        } else if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const user = await authService.validateToken(token);
            if (user) {
                (req as any).auth = { type: 'user', ...user };
            }
        }
    } catch (error) {
        console.error('[OptionalAuthMiddleware] Error:', error);
    }

    next();
};

export const requirePermission = (permission: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const auth = (req as any).auth;

        if (!auth) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!authService.hasPermission(auth, permission)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }

        next();
    };
};

export const requireRole = (...roles: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const auth = (req as any).auth;

        if (!auth) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (auth.type === 'apikey') {
            return next();
        }

        if (!roles.includes(auth.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient role' });
        }

        next();
    };
};
