import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { BACKUP_CONFIG, PATHS } from '../config/constants.js';

export interface ProjectBackup {
  id: string;
  timestamp: number;
  type: 'auto' | 'manual' | 'pre-change';
  description: string;
  size: number;
  filesCount: number;
  checksum: string;
}

export interface SystemHealthStatus {
  isResponsive: boolean;
  lastHeartbeat: number;
  consecutiveFailures: number;
  lastError: string | null;
  uptime: number;
  serverRunning: boolean;
}

export class SystemSafetyService {
  private backupDir: string;
  private dataDir: string;
  private currentBackup: ProjectBackup | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private backupInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: number = Date.now();
  private consecutiveFailures: number = 0;

  constructor() {
    this.dataDir = path.join(process.cwd(), PATHS.DATA_DIR);
    this.backupDir = path.join(process.cwd(), PATHS.SYSTEM_BACKUPS);
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    await this.loadCurrentBackup();
    this.startHeartbeat();
    await this.createBackup('auto', '系统启动自动备份');
    this.startAutoBackup();

    logger.info('[SystemSafety]', 'Service initialized (config-only backup mode)');
  }

  private async loadCurrentBackup(): Promise<void> {
    const metaPath = path.join(this.backupDir, 'current-backup.json');
    if (fs.existsSync(metaPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        this.currentBackup = data;
      } catch (error) {
        logger.error('[SystemSafety]', 'Failed to load backup metadata:', error);
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.lastHeartbeat = Date.now();
      this.consecutiveFailures = 0;
    }, BACKUP_CONFIG.HEARTBEAT_INTERVAL);
  }

  private startAutoBackup(): void {
    this.backupInterval = setInterval(async () => {
      logger.info('[SystemSafety]', 'Auto backup triggered (30 min interval)');
      await this.createBackup('auto');
    }, 30 * 60 * 1000);
  }

  async createBackup(type: 'auto' | 'manual' | 'pre-change' = 'manual', description: string = ''): Promise<ProjectBackup> {
    const timestamp = Date.now();
    const id = `backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, id);

    logger.info('[SystemSafety]', `Creating ${type} backup...`);

    // 删除旧备份
    await this.cleanOldBackups();

    // 创建备份目录
    if (!fs.existsSync(backupPath)) {
      fs.mkdirSync(backupPath, { recursive: true });
    }

    // 只备份关键配置文件（不备份源码、数据库、向量存储等大文件）
    // 注意：LLM配置存储在SQLite数据库中，不需要单独备份JSON文件
    const configFilesToBackup = [
      { src: 'package.json', dest: 'package.json' },
      { src: '.qilin-claw/agents.json', dest: '.qilin-claw/agents.json' },
      { src: '.qilin-claw/bots.json', dest: '.qilin-claw/bots.json' },
      { src: '.qilin-claw/claw.db', dest: '.qilin-claw/claw.db' },
      { src: '.qilin-claw/embedding-config.json', dest: '.qilin-claw/embedding-config.json' },
      { src: '.qilin-claw/threads.json', dest: '.qilin-claw/threads.json' },
      { src: '.qilin-claw/skills.json', dest: '.qilin-claw/skills.json' },
      { src: '.qilin-claw/custom-models.json', dest: '.qilin-claw/custom-models.json' },
      { src: '.qilin-claw/usage-records.json', dest: '.qilin-claw/usage-records.json' },
      { src: '.qilin-claw/conversation-metas.json', dest: '.qilin-claw/conversation-metas.json' },
    ];

    let filesCount = 0;
    let totalSize = 0;

    for (const item of configFilesToBackup) {
      const sourcePath = path.join(process.cwd(), item.src);
      const targetPath = path.join(backupPath, item.dest);

      try {
        if (fs.existsSync(sourcePath)) {
          // 确保目标目录存在
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          fs.copyFileSync(sourcePath, targetPath);
          filesCount++;
          totalSize += fs.statSync(targetPath).size;
        }
      } catch (error) {
        logger.warn('[SystemSafety]', `Failed to backup ${item.src}:`, error);
      }
    }

    // 备份agent-memories目录中的配置文件（不包括记忆文件内容）
    const agentMemoriesDir = path.join(process.cwd(), '.qilin-claw/agent-memories');
    if (fs.existsSync(agentMemoriesDir)) {
      const configPath = path.join(agentMemoriesDir, 'configs.json');
      const memoryFilesPath = path.join(agentMemoriesDir, 'memory-files.json');

      const targetDir = path.join(backupPath, '.qilin-claw/agent-memories');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, path.join(targetDir, 'configs.json'));
        filesCount++;
        totalSize += fs.statSync(path.join(targetDir, 'configs.json')).size;
      }
      if (fs.existsSync(memoryFilesPath)) {
        fs.copyFileSync(memoryFilesPath, path.join(targetDir, 'memory-files.json'));
        filesCount++;
        totalSize += fs.statSync(path.join(targetDir, 'memory-files.json')).size;
      }
    }

    // 创建备份元数据
    const backup: ProjectBackup = {
      id,
      timestamp,
      type,
      description: description || `${type === 'auto' ? '自动' : type === 'manual' ? '手动' : '变更前'}备份`,
      size: totalSize,
      filesCount,
      checksum: await this.calculateChecksum(backupPath),
    };

    // 保存元数据
    const metaPath = path.join(this.backupDir, 'current-backup.json');
    fs.writeFileSync(metaPath, JSON.stringify(backup, null, 2));

    this.currentBackup = backup;
    logger.info('[SystemSafety]', `Backup created: ${id} (${this.formatSize(totalSize)}, ${filesCount} files)`);

    return backup;
  }

  private async cleanOldBackups(): Promise<void> {
    const files = fs.readdirSync(this.backupDir);
    const backupDirs = files.filter(f => f.startsWith('backup-'));

    // Sort directories by timestamp embedded in name, newest first
    const sortedDirs = backupDirs.sort((a, b) => {
      const timeA = parseInt(a.replace('backup-', '')) || 0;
      const timeB = parseInt(b.replace('backup-', '')) || 0;
      return timeB - timeA;
    });

    // Keep only the most recent 1 (delete all others)
    const dirsToDelete = sortedDirs.slice(1);

    for (const dir of dirsToDelete) {
      const dirPath = path.join(this.backupDir, dir);
      try {
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true });
          logger.info('[SystemSafety]', `Removed old backup: ${dir}`);
        }
      } catch (error) {
        console.warn(`[SystemSafety] Failed to remove old backup ${dir}:`, error);
      }
    }
  }

  private async copyDirectory(source: string, target: string): Promise<number> {
    let count = 0;

    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      // 跳过 node_modules 和其他大目录
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
        continue;
      }

      if (entry.isDirectory()) {
        count += await this.copyDirectory(sourcePath, targetPath);
      } else {
        await this.copyFile(sourcePath, targetPath);
        count++;
      }
    }

    return count;
  }

  private async copyFile(source: string, target: string): Promise<void> {
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.copyFileSync(source, target);
  }

  private getDirectorySize(dirPath: string): number {
    let size = 0;

    if (!fs.existsSync(dirPath)) return 0;

    const stat = fs.statSync(dirPath);
    if (stat.isFile()) return stat.size;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += this.getDirectorySize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }

    return size;
  }

  private async calculateChecksum(dirPath: string): Promise<string> {
    // 简化的校验和：使用文件数量和总大小
    const size = this.getDirectorySize(dirPath);
    const files = this.countFiles(dirPath);
    return `${files}-${size}`;
  }

  private countFiles(dirPath: string): number {
    let count = 0;

    if (!fs.existsSync(dirPath)) return 0;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += this.countFiles(fullPath);
      } else {
        count++;
      }
    }

    return count;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async restoreBackup(backupId?: string): Promise<{ success: boolean; message: string }> {
    const id = backupId || this.currentBackup?.id;

    if (!id) {
      return { success: false, message: '没有可用的备份' };
    }

    const backupPath = path.join(this.backupDir, id);

    if (!fs.existsSync(backupPath)) {
      return { success: false, message: `备份不存在: ${id}` };
    }

    logger.info('[SystemSafety]', `Restoring backup: ${id}`);

    try {
      // 只恢复配置文件（包括数据库）
      const configFilesToRestore = [
        { src: '.qilin-claw/agents.json', dest: '.qilin-claw/agents.json' },
        { src: '.qilin-claw/bots.json', dest: '.qilin-claw/bots.json' },
        { src: '.qilin-claw/claw.db', dest: '.qilin-claw/claw.db' },
        { src: '.qilin-claw/embedding-config.json', dest: '.qilin-claw/embedding-config.json' },
        { src: '.qilin-claw/threads.json', dest: '.qilin-claw/threads.json' },
        { src: '.qilin-claw/skills.json', dest: '.qilin-claw/skills.json' },
        { src: '.qilin-claw/custom-models.json', dest: '.qilin-claw/custom-models.json' },
        { src: '.qilin-claw/usage-records.json', dest: '.qilin-claw/usage-records.json' },
        { src: '.qilin-claw/conversation-metas.json', dest: '.qilin-claw/conversation-metas.json' },
        { src: '.qilin-claw/agent-memories/configs.json', dest: '.qilin-claw/agent-memories/configs.json' },
        { src: '.qilin-claw/agent-memories/memory-files.json', dest: '.qilin-claw/agent-memories/memory-files.json' },
      ];

      for (const item of configFilesToRestore) {
        const sourcePath = path.join(backupPath, item.src);
        const targetPath = path.join(process.cwd(), item.dest);

        if (fs.existsSync(sourcePath)) {
          // 数据灾难防护：防止小体积的空数据库覆盖大体积的现有数据库
          if (item.dest.endsWith('.db') && fs.existsSync(targetPath)) {
            const targetSize = fs.statSync(targetPath).size;
            const sourceSize = fs.statSync(sourcePath).size;
            // 如果现有数据库大大超过备份文件 (超过 1MB)，则跳过该文件的覆盖
            if (targetSize > sourceSize + 1048576) {
              logger.warn('[SystemSafety]', `Skipping restore for ${item.dest} to prevent data loss. Current size: ${targetSize}, Backup size: ${sourceSize}`);
              continue;
            }
          }

          // 确保目标目录存在
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          fs.copyFileSync(sourcePath, targetPath);
          console.log(`[SystemSafety] Restored: ${item.dest}`);
        }
      }

      console.log('[SystemSafety] Backup restored successfully');
      return { success: true, message: '备份已恢复，请重启服务器' };

    } catch (error) {
      logger.error('[SystemSafety]', 'Restore failed:', error);
      return { success: false, message: `恢复失败: ${(error as Error).message}` };
    }
  }

  checkSystemHealth(): SystemHealthStatus {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeat;

    // 检查服务器是否响应
    const isResponsive = timeSinceLastHeartbeat < BACKUP_CONFIG.MAX_FAILURE_TIME;

    // 如果超过心跳间隔没有更新，增加失败计数
    if (timeSinceLastHeartbeat > BACKUP_CONFIG.HEARTBEAT_INTERVAL * 2) {
      this.consecutiveFailures++;
    }

    return {
      isResponsive,
      lastHeartbeat: this.lastHeartbeat,
      consecutiveFailures: this.consecutiveFailures,
      lastError: null,
      uptime: process.uptime(),
      serverRunning: true,
    };
  }

  // 检查是否需要自动恢复
  async checkAndAutoRecover(): Promise<boolean> {
    const health = this.checkSystemHealth();

    // 如果系统无响应超过10分钟
    if (!health.isResponsive) {
      console.log('[SystemSafety] System unresponsive, triggering auto recovery...');
      const result = await this.restoreBackup();
      return result.success;
    }

    return false;
  }

  getCurrentBackup(): ProjectBackup | null {
    return this.currentBackup;
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }
    logger.info('[SystemSafety]', 'Service stopped');
  }
}

export const systemSafetyService = new SystemSafetyService();
