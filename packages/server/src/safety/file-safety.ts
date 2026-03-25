import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { FileBackup, SafetyConfig } from '../types/index.js';

export class FileSafetyService {
  private config: SafetyConfig;
  private backups: Map<string, FileBackup[]> = new Map();
  private backupDir: string;

  constructor(config: Partial<SafetyConfig> = {}) {
    this.config = {
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024,
      enableAutoBackup: config.enableAutoBackup ?? true,
      maxBackupsPerFile: config.maxBackupsPerFile || 10,
      maxRequestsPerMinute: config.maxRequestsPerMinute || 60,
      maxRequestsPerHour: config.maxRequestsPerHour || 1000,
      maxConcurrentOperations: config.maxConcurrentOperations || 5,
      autoRecoveryEnabled: config.autoRecoveryEnabled ?? true,
      healthCheckInterval: config.healthCheckInterval || 30000,
      recoveryDelay: config.recoveryDelay || 600000,
      enableProxy: config.enableProxy ?? false,
      proxyUrl: config.proxyUrl || 'http://127.0.0.1:7890',
    };
    this.backupDir = path.join(process.cwd(), '.qilin-claw', 'backups');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
    await this.loadBackups();
  }

  private async loadBackups(): Promise<void> {
    try {
      const files = await fs.readdir(this.backupDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.backupDir, file), 'utf-8');
          const backup = JSON.parse(content) as FileBackup;
          const filePath = backup.path;
          if (!this.backups.has(filePath)) {
            this.backups.set(filePath, []);
          }
          this.backups.get(filePath)!.push(backup);
        }
      }
      for (const [filePath, fileBackups] of this.backups) {
        this.backups.set(filePath, fileBackups.sort((a, b) => b.timestamp - a.timestamp));
      }
    } catch (error) {
      // No backups exist yet
    }
  }

  async createBackup(filePath: string, operation: string, conversationId?: string): Promise<FileBackup | null> {
    if (!this.config.enableAutoBackup) return null;

    try {
      const stats = await fs.stat(filePath);
      if (stats.size > this.config.maxFileSize) {
        console.warn(`File too large for backup: ${filePath}`);
        return null;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const backup: FileBackup = {
        id: uuidv4(),
        path: filePath,
        originalContent: content,
        timestamp: Date.now(),
        operation,
        ...(conversationId ? { conversationId } : {}),
      };

      if (!this.backups.has(filePath)) {
        this.backups.set(filePath, []);
      }

      const fileBackups = this.backups.get(filePath)!;
      fileBackups.unshift(backup);

      while (fileBackups.length > this.config.maxBackupsPerFile) {
        const removed = fileBackups.pop();
        if (removed) {
          await fs.unlink(path.join(this.backupDir, `${removed.id}.json`)).catch(() => { });
        }
      }

      await fs.writeFile(
        path.join(this.backupDir, `${backup.id}.json`),
        JSON.stringify(backup, null, 2)
      );

      return backup;
    } catch (error) {
      console.error(`Failed to create backup for ${filePath}:`, error);
      return null;
    }
  }

  async restoreBackup(backupId: string): Promise<boolean> {
    for (const [filePath, fileBackups] of this.backups) {
      const backup = fileBackups.find(b => b.id === backupId);
      if (backup) {
        try {
          await fs.writeFile(filePath, backup.originalContent, 'utf-8');
          return true;
        } catch (error) {
          console.error(`Failed to restore backup ${backupId}:`, error);
          return false;
        }
      }
    }
    return false;
  }

  async restoreLatestBackup(filePath: string): Promise<boolean> {
    const fileBackups = this.backups.get(filePath);
    if (!fileBackups || fileBackups.length === 0) {
      return false;
    }

    const latestBackup = fileBackups[0];
    try {
      await fs.writeFile(filePath, latestBackup.originalContent, 'utf-8');
      return true;
    } catch (error) {
      console.error(`Failed to restore latest backup for ${filePath}:`, error);
      return false;
    }
  }

  getBackups(filePath: string): FileBackup[] {
    return this.backups.get(filePath) || [];
  }

  getAllBackups(): Map<string, FileBackup[]> {
    return this.backups;
  }

  async deleteBackup(backupId: string): Promise<boolean> {
    for (const [filePath, fileBackups] of this.backups) {
      const index = fileBackups.findIndex(b => b.id === backupId);
      if (index !== -1) {
        fileBackups.splice(index, 1);
        await fs.unlink(path.join(this.backupDir, `${backupId}.json`)).catch(() => { });
        return true;
      }
    }
    return false;
  }

  getBackupsByConversation(conversationId: string, afterTimestamp?: number): FileBackup[] {
    const results: FileBackup[] = [];
    for (const fileBackups of this.backups.values()) {
      for (const backup of fileBackups) {
        if (backup.conversationId === conversationId) {
          if (!afterTimestamp || backup.timestamp >= afterTimestamp) {
            results.push(backup);
          }
        }
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  async restoreBackupsByConversation(conversationId: string, afterTimestamp: number): Promise<{ restored: string[], failed: string[] }> {
    const backupsToRestore = this.getBackupsByConversation(conversationId, afterTimestamp);
    const restored: string[] = [];
    const failed: string[] = [];
    const restoredPaths = new Set<string>();

    // Restore from newest to oldest — only restore the first (most recent pre-change) backup per file path
    for (const backup of backupsToRestore) {
      if (restoredPaths.has(backup.path)) continue;
      try {
        await fs.writeFile(backup.path, backup.originalContent, 'utf-8');
        restored.push(backup.path);
        restoredPaths.add(backup.path);
        console.log(`[FileSafety] Restored file: ${backup.path} (backup from ${new Date(backup.timestamp).toLocaleString()})`);
      } catch (error) {
        failed.push(backup.path);
        console.error(`[FileSafety] Failed to restore file: ${backup.path}`, error);
      }
    }

    return { restored, failed };
  }

  validateFileSize(filePath: string): Promise<boolean> {
    return fs.stat(filePath).then(stats => stats.size <= this.config.maxFileSize);
  }

  getConfig(): SafetyConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

export const fileSafetyService = new FileSafetyService();
