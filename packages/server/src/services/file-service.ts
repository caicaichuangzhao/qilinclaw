import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import matter from 'gray-matter';
import YAML from 'yaml';
import { marked } from 'marked';
import type { FileInfo, FileEdit } from '../types/index.js';
import { fileSafetyService } from '../safety/file-safety.js';

export class FileService extends EventEmitter {
  private workspaceRoot: string;
  private watcher: chokidar.FSWatcher | null = null;
  private supportedExtensions = new Set([
    '.txt', '.md', '.markdown', '.json', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs',
    '.html', '.css', '.scss', '.less', '.xml', '.svg',
    '.sh', '.bash', '.zsh', '.ps1', '.bat',
    '.sql', '.graphql', '.proto',
    '.toml', '.ini', '.env', '.conf', '.config',
    '.csv', '.tsv',
    '.vue', '.svelte', '.astro',
  ]);

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;
  }

  async initialize(): Promise<void> {
    await fileSafetyService.initialize();
    await this.startWatcher();
  }

  private async startWatcher(): Promise<void> {
    this.watcher = chokidar.watch(this.workspaceRoot, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (filePath) => this.emit('fileAdded', filePath))
      .on('change', (filePath) => this.emit('fileChanged', filePath))
      .on('unlink', (filePath) => this.emit('fileDeleted', filePath));
  }

  async stopWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, relativePath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error('Access denied: path outside workspace');
    }

    // 检查路径是否指向用户可配置的文件或目录
    const relative = path.relative(this.workspaceRoot, resolved);
    const parts = relative.split(path.sep);

    // 如果是根目录下的文件或目录，检查是否在用户可配置列表中
    if (parts.length === 1) {
      const item = parts[0];
      // 跳过隐藏文件检查，因为已经在 listFiles 中处理
      const userConfigurableItems = new Set([
        '.qilin-claw',      // 用户缓存和配置
        'models',           // 本地模型文件夹
        'embedding-models', // Embedding模型文件夹
        'adapters',         // 对话频道接入适配器
        'data',             // 用户数据文件
        'config',           // 配置文件
        'custom',           // 用户自定义文件
        'HEARTBEAT.md',     // 心跳配置文件
      ]);

      if (!userConfigurableItems.has(item)) {
        throw new Error('Access denied: restricted file or directory');
      }
    }

    return resolved;
  }

  async listFiles(dirPath: string = ''): Promise<FileInfo[]> {
    // 对于根目录，直接使用 workspaceRoot，避免 resolvePath 的检查
    const fullPath = dirPath === '' ? this.workspaceRoot : this.resolvePath(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const files: FileInfo[] = [];

    // 用户可配置的目录和文件
    const userConfigurableItems = new Set([
      '.qilin-claw',      // 用户缓存和配置
      'models',           // 本地模型文件夹
      'embedding-models', // Embedding模型文件夹
      'adapters',         // 对话频道接入适配器
      'data',             // 用户数据文件
      'config',           // 配置文件
      'custom',           // 用户自定义文件
      'HEARTBEAT.md',     // 心跳配置文件
    ]);

    // 检查是否在根目录
    const isRoot = dirPath === '';

    for (const entry of entries) {
      // 跳过隐藏文件，但不跳过用户可配置的隐藏目录
      if (entry.name.startsWith('.') && !userConfigurableItems.has(entry.name)) continue;

      // 在根目录时，只显示用户可配置的项目
      if (isRoot && !userConfigurableItems.has(entry.name)) {
        continue;
      }

      const filePath = path.join(fullPath, entry.name);
      const stats = await fs.stat(filePath);

      files.push({
        path: path.relative(this.workspaceRoot, filePath),
        name: entry.name,
        extension: path.extname(entry.name),
        size: stats.size,
        lastModified: stats.mtimeMs,
        isDirectory: entry.isDirectory(),
      });
    }

    return files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(filePath: string): Promise<{ content: string; metadata?: Record<string, unknown> }> {
    const fullPath = this.resolvePath(filePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.md' || ext === '.markdown') {
      const { data, content: body } = matter(content);
      return { content: body, metadata: data };
    }

    if (ext === '.yaml' || ext === '.yml') {
      try {
        const data = YAML.parse(content);
        return { content, metadata: { parsed: data } };
      } catch {
        return { content };
      }
    }

    if (ext === '.json') {
      try {
        const data = JSON.parse(content);
        return { content, metadata: { parsed: data } };
      } catch {
        return { content };
      }
    }

    return { content };
  }

  async writeFile(edit: FileEdit, operation: string = 'edit', conversationId?: string): Promise<void> {
    const fullPath = this.resolvePath(edit.path);

    await fileSafetyService.createBackup(fullPath, operation, conversationId);

    const ext = path.extname(edit.path).toLowerCase();
    let content = edit.content;

    if (ext === '.json') {
      try {
        const parsed = JSON.parse(content);
        content = JSON.stringify(parsed, null, 2);
      } catch {
        // Keep original content if not valid JSON
      }
    }

    await fs.writeFile(fullPath, content, { encoding: (edit.encoding as BufferEncoding) || 'utf-8' });
  }

  async createFile(filePath: string, content: string = ''): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async deleteFile(filePath: string, conversationId?: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    await fileSafetyService.createBackup(fullPath, 'delete', conversationId);
    await fs.unlink(fullPath);
  }

  async moveFile(source: string, destination: string, conversationId?: string): Promise<void> {
    const sourcePath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);

    await fileSafetyService.createBackup(sourcePath, 'move', conversationId);
    await fs.rename(sourcePath, destPath);
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const sourcePath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);

    await fs.copyFile(sourcePath, destPath);
  }

  async createDirectory(dirPath: string): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    await fs.mkdir(fullPath, { recursive: true });
  }

  async deleteDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    if (recursive) {
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.rmdir(fullPath);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async searchFiles(query: string, dirPath: string = ''): Promise<FileInfo[]> {
    const files = await this.listFiles(dirPath);
    const results: FileInfo[] = [];

    for (const file of files) {
      if (file.isDirectory) {
        const subResults = await this.searchFiles(query, file.path);
        results.push(...subResults);
      } else if (file.name.toLowerCase().includes(query.toLowerCase())) {
        results.push(file);
      }
    }

    return results;
  }

  async searchInFiles(query: string, dirPath: string = ''): Promise<Array<{ file: FileInfo; matches: string[] }>> {
    const files = await this.listFiles(dirPath);
    const results: Array<{ file: FileInfo; matches: string[] }> = [];

    for (const file of files) {
      if (file.isDirectory) {
        const subResults = await this.searchInFiles(query, file.path);
        results.push(...subResults);
        continue;
      }

      if (!this.supportedExtensions.has(file.extension)) continue;

      try {
        const { content } = await this.readFile(file.path);
        const lines = content.split('\n');
        const matches: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query.toLowerCase())) {
            matches.push(`L${i + 1}: ${lines[i].trim().substring(0, 100)}`);
          }
        }

        if (matches.length > 0) {
          results.push({ file, matches });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  isSupported(extension: string): boolean {
    return this.supportedExtensions.has(extension.toLowerCase());
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.supportedExtensions);
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    if (this.watcher) {
      this.watcher.close();
      this.startWatcher();
    }
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}

export function createFileService(workspaceRoot: string): FileService {
  return new FileService(workspaceRoot);
}

export const fileService = new FileService(process.env.WORKSPACE_ROOT || process.cwd());
