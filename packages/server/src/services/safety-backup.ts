import fs from 'fs';
import path from 'path';

export interface ConfigSnapshot {
  id: string;
  timestamp: number;
  type: 'auto' | 'manual' | 'pre-change';
  description: string;
  data: {
    agents: unknown[];
    bots: unknown[];
    llmConfigs: unknown[];
    knowledge: unknown[];
    safety: unknown;
    memory: unknown;
  };
  checksum: string;
}

export class SafetyBackupService {
  private backupDir: string;
  private maxBackups: number = 20;
  private autoBackupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.backupDir = path.join(process.cwd(), '.qilin-claw', 'backups');
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private generateChecksum(data: unknown): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  async createSnapshot(
    type: 'auto' | 'manual' | 'pre-change' = 'auto',
    description: string = '',
    data: ConfigSnapshot['data']
  ): Promise<ConfigSnapshot> {
    const snapshot: ConfigSnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      type,
      description: description || this.getDefaultDescription(type),
      data,
      checksum: this.generateChecksum(data),
    };

    const filePath = path.join(this.backupDir, `${snapshot.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    console.log(`[SafetyBackup] Created snapshot: ${snapshot.id} (${type})`);

    await this.cleanupOldBackups();

    return snapshot;
  }

  private getDefaultDescription(type: string): string {
    switch (type) {
      case 'auto':
        return '自动备份';
      case 'manual':
        return '手动备份';
      case 'pre-change':
        return '变更前备份';
      default:
        return '系统备份';
    }
  }

  async loadSnapshot(id: string): Promise<ConfigSnapshot | null> {
    try {
      const filePath = path.join(this.backupDir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data;
      }
    } catch (error) {
      console.error('[SafetyBackup] Failed to load snapshot:', error);
    }
    return null;
  }

  async restoreSnapshot(id: string): Promise<ConfigSnapshot['data'] | null> {
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) {
      throw new Error('Snapshot not found');
    }

    const currentChecksum = this.generateChecksum(snapshot.data);
    if (currentChecksum !== snapshot.checksum) {
      throw new Error('Snapshot checksum mismatch - file may be corrupted');
    }

    console.log(`[SafetyBackup] Restoring snapshot: ${id}`);
    return snapshot.data;
  }

  async deleteSnapshot(id: string): Promise<void> {
    const filePath = path.join(this.backupDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[SafetyBackup] Deleted snapshot: ${id}`);
    }
  }

  async listSnapshots(): Promise<ConfigSnapshot[]> {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));

      const snapshots: ConfigSnapshot[] = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.backupDir, file), 'utf-8'));
          snapshots.push(data);
        } catch {
          // Skip corrupted files
        }
      }

      return snapshots.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('[SafetyBackup] Failed to list snapshots:', error);
      return [];
    }
  }

  private async cleanupOldBackups(): Promise<void> {
    const snapshots = await this.listSnapshots();

    const autoBackups = snapshots.filter(s => s.type === 'auto');
    const manualBackups = snapshots.filter(s => s.type === 'manual');
    const preChangeBackups = snapshots.filter(s => s.type === 'pre-change');

    const maxAuto = 10;
    const maxManual = 5;
    const maxPreChange = 5;

    const toDelete: string[] = [];

    if (autoBackups.length > maxAuto) {
      autoBackups.slice(maxAuto).forEach(s => toDelete.push(s.id));
    }
    if (manualBackups.length > maxManual) {
      manualBackups.slice(maxManual).forEach(s => toDelete.push(s.id));
    }
    if (preChangeBackups.length > maxPreChange) {
      preChangeBackups.slice(maxPreChange).forEach(s => toDelete.push(s.id));
    }

    for (const id of toDelete) {
      await this.deleteSnapshot(id);
    }

    if (toDelete.length > 0) {
      console.log(`[SafetyBackup] Cleaned up ${toDelete.length} old backups`);
    }
  }

  startAutoBackup(getData: () => Promise<ConfigSnapshot['data']>): void {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
    }

    const intervalMs = 30 * 60 * 1000; // 30 minutes

    this.autoBackupInterval = setInterval(async () => {
      try {
        const data = await getData();
        await this.createSnapshot('auto', '定时自动备份', data);
      } catch (error) {
        console.error('[SafetyBackup] Auto backup failed:', error);
      }
    }, intervalMs);

    console.log('[SafetyBackup] Auto backup started (every 30 minutes)');
  }

  stopAutoBackup(): void {
    if (this.autoBackupInterval) {
      clearInterval(this.autoBackupInterval);
      this.autoBackupInterval = null;
      console.log('[SafetyBackup] Auto backup stopped');
    }
  }

  async getLatestValidSnapshot(): Promise<ConfigSnapshot | null> {
    const snapshots = await this.listSnapshots();

    for (const snapshot of snapshots) {
      try {
        const currentChecksum = this.generateChecksum(snapshot.data);
        if (currentChecksum === snapshot.checksum) {
          return snapshot;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async validateCurrentConfig(data: ConfigSnapshot['data']): Promise<boolean> {
    try {
      if (!data.agents || !Array.isArray(data.agents)) return false;
      if (!data.bots || !Array.isArray(data.bots)) return false;
      if (!data.llmConfigs || !Array.isArray(data.llmConfigs)) return false;
      return true;
    } catch {
      return false;
    }
  }
}

export const safetyBackupService = new SafetyBackupService();
