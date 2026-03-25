import { Router } from 'express';
import { authService } from '../safety/auth.js';
import { auditLogger } from '../safety/audit-logger.js';
import { encryptionService } from '../safety/encryption.js';
import { authMiddleware, requirePermission, requireRole } from '../safety/auth.js';

export const securityRoutes = Router();

securityRoutes.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const ipAddress = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        const result = await authService.login(username, password, ipAddress, userAgent);

        await auditLogger.log({
            eventType: result.success ? 'auth.login' : 'auth.failed_login',
            severity: result.success ? 'low' : 'high',
            ipAddress,
            userAgent,
            resource: '/api/security/login',
            action: 'POST',
            details: { username },
            success: result.success,
            errorMessage: result.error,
        });

        if (result.success) {
            res.json({ token: result.token, user: result.user });
        } else {
            res.status(401).json({ error: result.error });
        }
    } catch (error) {
        console.error('[Security] Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

securityRoutes.post('/logout', authMiddleware, async (req, res) => {
    try {
        const auth = (req as any).auth;
        const token = req.headers.authorization?.substring(7);
        
        if (token) {
            await authService.logout(token);
        }

        await auditLogger.logRequest(req, 'auth.logout', {}, true);

        res.json({ success: true });
    } catch (error) {
        console.error('[Security] Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

securityRoutes.get('/me', authMiddleware, async (req, res) => {
    try {
        const auth = (req as any).auth;
        res.json(auth);
    } catch (error) {
        console.error('[Security] Get user error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

securityRoutes.get('/api-keys', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const keys = authService.getApiKeys().map(k => ({
            id: k.id,
            name: k.name,
            permissions: k.permissions,
            rateLimit: k.rateLimit,
            createdAt: k.createdAt,
            lastUsed: k.lastUsed,
            expiresAt: k.expiresAt,
            enabled: k.enabled,
        }));
        res.json(keys);
    } catch (error) {
        console.error('[Security] Get API keys error:', error);
        res.status(500).json({ error: 'Failed to get API keys' });
    }
});

securityRoutes.post('/api-keys', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const auth = (req as any).auth;
        const { name, permissions, rateLimit, expiresIn } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const apiKey = await authService.createApiKey(
            auth.id,
            name,
            permissions || ['*'],
            rateLimit || 60,
            expiresIn
        );

        await auditLogger.logRequest(req, 'auth.api_key_created', { name, permissions }, true);

        res.status(201).json({
            id: apiKey.id,
            name: apiKey.name,
            key: apiKey.key,
            permissions: apiKey.permissions,
            rateLimit: apiKey.rateLimit,
            createdAt: apiKey.createdAt,
            expiresAt: apiKey.expiresAt,
        });
    } catch (error) {
        console.error('[Security] Create API key error:', error);
        res.status(500).json({ error: 'Failed to create API key' });
    }
});

securityRoutes.delete('/api-keys/:id', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const success = await authService.revokeApiKey(req.params.id);

        await auditLogger.logRequest(req, 'auth.api_key_revoked', { keyId: req.params.id }, success);

        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'API key not found' });
        }
    } catch (error) {
        console.error('[Security] Revoke API key error:', error);
        res.status(500).json({ error: 'Failed to revoke API key' });
    }
});

securityRoutes.get('/sessions', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const sessions = authService.getSessions();
        res.json(sessions.map(s => ({
            id: s.id,
            userId: s.userId,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
        })));
    } catch (error) {
        console.error('[Security] Get sessions error:', error);
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

securityRoutes.get('/audit-logs', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { startTime, endTime, eventTypes, userId, severity, success, limit, offset } = req.query;

        const logs = await auditLogger.query({
            startTime: startTime ? parseInt(startTime as string) : undefined,
            endTime: endTime ? parseInt(endTime as string) : undefined,
            eventTypes: eventTypes ? (eventTypes as string).split(',') as any : undefined,
            userId: userId as string,
            severity: severity ? (severity as string).split(',') as any : undefined,
            success: success === 'true' ? true : success === 'false' ? false : undefined,
            limit: limit ? parseInt(limit as string) : 100,
            offset: offset ? parseInt(offset as string) : undefined,
        });

        res.json(logs);
    } catch (error) {
        console.error('[Security] Get audit logs error:', error);
        res.status(500).json({ error: 'Failed to get audit logs' });
    }
});

securityRoutes.get('/audit-stats', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { startTime, endTime } = req.query;

        const stats = await auditLogger.getStats(
            startTime ? parseInt(startTime as string) : undefined,
            endTime ? parseInt(endTime as string) : undefined
        );

        res.json(stats);
    } catch (error) {
        console.error('[Security] Get audit stats error:', error);
        res.status(500).json({ error: 'Failed to get audit stats' });
    }
});

securityRoutes.post('/audit-cleanup', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { days = 30 } = req.body;
        const deleted = await auditLogger.cleanup(days);

        await auditLogger.logRequest(req, 'system.config_changed', { action: 'audit_cleanup', days, deleted }, true);

        res.json({ deleted });
    } catch (error) {
        console.error('[Security] Audit cleanup error:', error);
        res.status(500).json({ error: 'Failed to cleanup audit logs' });
    }
});

securityRoutes.post('/init-encryption', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        await encryptionService.initialize(password);

        await auditLogger.logRequest(req, 'system.config_changed', { action: 'encryption_initialized' }, true);

        res.json({ success: true, message: 'Encryption initialized' });
    } catch (error) {
        console.error('[Security] Init encryption error:', error);
        res.status(500).json({ error: 'Failed to initialize encryption' });
    }
});

securityRoutes.post('/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const auth = (req as any).auth;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        await auditLogger.logRequest(req, 'auth.password_changed', {}, true);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('[Security] Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});
