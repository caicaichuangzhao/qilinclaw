import { Request, Response, NextFunction } from 'express';
import { URL } from 'url';

const MAX_STRING_LENGTH = 10000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_DEPTH = 10;
const MAX_FILE_PATH_LENGTH = 4096;

const DANGEROUS_PATTERNS = [
    /\.\./g,
    /\.\.\\/g,
    /\.\.\//g,
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:\s*text\/html/gi,
    /vbscript:/gi,
    /expression\s*\(/gi,
];

const SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|UNION|EXEC)\b)/gi,
    /(--)|(\/\*)|(\*\/)/g,
    /('|")\s*(OR|AND)\s*('|")/gi,
    /\b(OR|AND)\b\s+\d+\s*=\s*\d+/gi,
];

const COMMAND_INJECTION_PATTERNS = [
    /[;&|`$]/g,
    /\$\([^)]*\)/g,
    /\$\{[^}]*\}/g,
    /\|[^|]/g,
    /`[^`]*`/g,
];

export interface ValidationOptions {
    maxStringLength?: number;
    maxArrayLength?: number;
    maxObjectDepth?: number;
    allowHtml?: boolean;
    allowScripts?: boolean;
    strictMode?: boolean;
}

export class InputValidator {
    private options: ValidationOptions;

    constructor(options: ValidationOptions = {}) {
        this.options = {
            maxStringLength: options.maxStringLength || MAX_STRING_LENGTH,
            maxArrayLength: options.maxArrayLength || MAX_ARRAY_LENGTH,
            maxObjectDepth: options.maxObjectDepth || MAX_OBJECT_DEPTH,
            allowHtml: options.allowHtml || false,
            allowScripts: options.allowScripts || false,
            strictMode: options.strictMode || true,
        };
    }

    validateString(value: string, fieldName: string): { valid: boolean; sanitized: string; errors: string[] } {
        const errors: string[] = [];
        let sanitized = value;

        if (value.length > this.options.maxStringLength!) {
            errors.push(`${fieldName} exceeds maximum length of ${this.options.maxStringLength}`);
            if (this.options.strictMode) {
                return { valid: false, sanitized: '', errors };
            }
            sanitized = sanitized.substring(0, this.options.maxStringLength);
        }

        if (!this.options.allowHtml) {
            for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(sanitized)) {
                    errors.push(`${fieldName} contains potentially dangerous content`);
                    sanitized = sanitized.replace(pattern, '');
                }
            }
        }

        return { valid: errors.length === 0, sanitized, errors };
    }

    validateObject(obj: any, depth: number = 0, prefix: string = ''): { valid: boolean; sanitized: any; errors: string[] } {
        const errors: string[] = [];
        let sanitized: any = Array.isArray(obj) ? [] : {};

        if (depth > this.options.maxObjectDepth!) {
            errors.push(`${prefix} exceeds maximum object depth of ${this.options.maxObjectDepth}`);
            return { valid: false, sanitized: null, errors };
        }

        if (Array.isArray(obj)) {
            if (obj.length > this.options.maxArrayLength!) {
                errors.push(`${prefix} exceeds maximum array length of ${this.options.maxArrayLength}`);
                if (this.options.strictMode) {
                    return { valid: false, sanitized: null, errors };
                }
                obj = obj.slice(0, this.options.maxArrayLength);
            }

            for (let i = 0; i < obj.length; i++) {
                const result = this.validateValue(obj[i], depth + 1, `${prefix}[${i}]`);
                if (!result.valid) {
                    errors.push(...result.errors);
                }
                sanitized.push(result.sanitized);
            }
        } else if (typeof obj === 'object' && obj !== null) {
            for (const [key, value] of Object.entries(obj)) {
                const keyResult = this.validateString(key, `${prefix}.${key}`);
                if (!keyResult.valid) {
                    errors.push(...keyResult.errors);
                }

                const valueResult = this.validateValue(value, depth + 1, `${prefix}.${key}`);
                if (!valueResult.valid) {
                    errors.push(...valueResult.errors);
                }
                sanitized[keyResult.sanitized] = valueResult.sanitized;
            }
        } else {
            sanitized = obj;
        }

        return { valid: errors.length === 0, sanitized, errors };
    }

    private validateValue(value: any, depth: number, prefix: string): { valid: boolean; sanitized: any; errors: string[] } {
        if (value === null || value === undefined) {
            return { valid: true, sanitized: value, errors: [] };
        }

        if (typeof value === 'string') {
            return this.validateString(value, prefix);
        }

        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return { valid: false, sanitized: 0, errors: [`${prefix} is not a finite number`] };
            }
            return { valid: true, sanitized: value, errors: [] };
        }

        if (typeof value === 'boolean') {
            return { valid: true, sanitized: value, errors: [] };
        }

        if (typeof value === 'object') {
            return this.validateObject(value, depth, prefix);
        }

        return { valid: false, sanitized: null, errors: [`${prefix} has unsupported type: ${typeof value}`] };
    }

    validateFilePath(filePath: string): { valid: boolean; sanitized: string; errors: string[] } {
        const errors: string[] = [];
        let sanitized = filePath;

        if (filePath.length > MAX_FILE_PATH_LENGTH) {
            errors.push('File path exceeds maximum length');
            return { valid: false, sanitized: '', errors };
        }

        if (filePath.includes('..') || filePath.includes('~')) {
            errors.push('File path contains forbidden sequences');
            sanitized = sanitized.replace(/\.\./g, '').replace(/~/g, '');
        }

        if (/[<>:"|?*]/.test(filePath)) {
            errors.push('File path contains invalid characters');
            sanitized = sanitized.replace(/[<>:"|?*]/g, '');
        }

        return { valid: errors.length === 0, sanitized, errors };
    }

    validateUrl(url: string): { valid: boolean; sanitized: string; errors: string[] } {
        const errors: string[] = [];

        try {
            const parsed = new URL(url);
            const allowedProtocols = ['http:', 'https:'];

            if (!allowedProtocols.includes(parsed.protocol)) {
                errors.push('URL uses forbidden protocol');
                return { valid: false, sanitized: '', errors };
            }

            return { valid: true, sanitized: url, errors: [] };
        } catch (error) {
            errors.push('Invalid URL format');
            return { valid: false, sanitized: '', errors };
        }
    }

    detectSqlInjection(value: string): boolean {
        for (const pattern of SQL_INJECTION_PATTERNS) {
            if (pattern.test(value)) {
                return true;
            }
        }
        return false;
    }

    detectCommandInjection(value: string): boolean {
        for (const pattern of COMMAND_INJECTION_PATTERNS) {
            if (pattern.test(value)) {
                return true;
            }
        }
        return false;
    }

    sanitizeHtml(value: string): string {
        return value
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    sanitizeForShell(value: string): string {
        return value.replace(/[`$\\;&|<>(){}[\]!#*?]/g, '\\$&');
    }
}

export const inputValidator = new InputValidator();

export const validateInputMiddleware = (options: ValidationOptions = {}) => {
    const validator = new InputValidator(options);

    return (req: Request, res: Response, next: NextFunction) => {
        try {
            if (req.body && typeof req.body === 'object') {
                const result = validator.validateObject(req.body);
                if (!result.valid && options.strictMode) {
                    return res.status(400).json({
                        error: 'Invalid input',
                        details: result.errors,
                    });
                }
                req.body = result.sanitized;
            }

            if (req.query) {
                for (const [key, value] of Object.entries(req.query)) {
                    if (typeof value === 'string') {
                        const result = validator.validateString(value, key);
                        if (!result.valid && options.strictMode) {
                            return res.status(400).json({
                                error: 'Invalid query parameter',
                                details: result.errors,
                            });
                        }
                        req.query[key] = result.sanitized as any;
                    }
                }
            }

            if (req.params) {
                for (const [key, value] of Object.entries(req.params)) {
                    if (typeof value === 'string') {
                        const result = validator.validateString(value, key);
                        if (!result.valid && options.strictMode) {
                            return res.status(400).json({
                                error: 'Invalid path parameter',
                                details: result.errors,
                            });
                        }
                        req.params[key] = result.sanitized;
                    }
                }
            }

            next();
        } catch (error) {
            console.error('[InputValidation] Error:', error);
            return res.status(500).json({ error: 'Input validation error' });
        }
    };
};

export const validateFileUpload = (req: Request, res: Response, next: NextFunction) => {
    if (!req.file && !req.files) {
        return next();
    }

    const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [req.file];

    for (const file of files) {
        if (!file) continue;

        const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar', '.msi'];
        const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

        if (dangerousExtensions.includes(ext)) {
            return res.status(400).json({
                error: 'File type not allowed',
                message: `Files with extension ${ext} are not permitted`,
            });
        }

        const dangerousMimeTypes = [
            'application/x-executable',
            'application/x-msdos-program',
            'application/x-msdownload',
            'application/x-sh',
            'application/x-shar',
            'application/x-bat',
        ];

        if (dangerousMimeTypes.includes(file.mimetype)) {
            return res.status(400).json({
                error: 'File type not allowed',
                message: `MIME type ${file.mimetype} is not permitted`,
            });
        }
    }

    next();
};

export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
};

export const corsMiddleware = (allowedOrigins: string[] = ['http://localhost:3000', 'http://127.0.0.1:3000']) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const origin = req.headers.origin;
        
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400');

        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }

        next();
    };
};
