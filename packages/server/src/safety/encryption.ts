import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const ITERATIONS = 100000;

export interface EncryptedData {
    encrypted: string;
    iv: string;
    authTag: string;
    salt: string;
}

export class EncryptionService {
    private masterKey: Buffer | null = null;
    private keyPath: string;

    constructor() {
        this.keyPath = path.join(process.cwd(), '.qilin-claw', '.master-key');
    }

    async initialize(password?: string): Promise<void> {
        if (password) {
            this.masterKey = await this.deriveKey(password);
        } else if (fs.existsSync(this.keyPath)) {
            this.masterKey = fs.readFileSync(this.keyPath);
        } else {
            this.masterKey = crypto.randomBytes(KEY_LENGTH);
            await this.saveMasterKey();
        }
    }

    private async deriveKey(password: string): Promise<Buffer> {
        const salt = crypto.randomBytes(SALT_LENGTH);
        return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
    }

    private async saveMasterKey(): Promise<void> {
        const dir = path.dirname(this.keyPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.keyPath, this.masterKey!);
        fs.chmodSync(this.keyPath, 0o600);
    }

    encrypt(plaintext: string): EncryptedData {
        if (!this.masterKey) {
            throw new Error('Encryption service not initialized');
        }

        const iv = crypto.randomBytes(IV_LENGTH);
        const salt = crypto.randomBytes(SALT_LENGTH);
        const key = crypto.pbkdf2Sync(this.masterKey.toString('hex'), salt, ITERATIONS, KEY_LENGTH, 'sha512');

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            salt: salt.toString('hex'),
        };
    }

    decrypt(data: EncryptedData): string {
        if (!this.masterKey) {
            throw new Error('Encryption service not initialized');
        }

        const iv = Buffer.from(data.iv, 'hex');
        const salt = Buffer.from(data.salt, 'hex');
        const authTag = Buffer.from(data.authTag, 'hex');
        const key = crypto.pbkdf2Sync(this.masterKey.toString('hex'), salt, ITERATIONS, KEY_LENGTH, 'sha512');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    hashPassword(password: string): string {
        const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512').toString('hex');
        return `${salt}:${hash}`;
    }

    verifyPassword(password: string, storedHash: string): boolean {
        const [salt, hash] = storedHash.split(':');
        const verifyHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512').toString('hex');
        return hash === verifyHash;
    }

    generateApiKey(): string {
        return `qilin-${crypto.randomBytes(32).toString('hex')}`;
    }

    generateToken(length: number = 32): string {
        return crypto.randomBytes(length).toString('hex');
    }

    createSignature(data: string, secret: string): string {
        return crypto.createHmac('sha256', secret).update(data).digest('hex');
    }

    verifySignature(data: string, signature: string, secret: string): boolean {
        const expectedSignature = this.createSignature(data, secret);
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
}

export const encryptionService = new EncryptionService();
