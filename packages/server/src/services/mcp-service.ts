import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  status: 'stopped' | 'running' | 'error';
  capabilities: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export class MCPService extends EventEmitter {
  private servers: Map<string, MCPServer> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private tools: Map<string, MCPTool[]> = new Map();
  private resources: Map<string, MCPResource[]> = new Map();
  private messageId = 0;
  private serversPath: string;

  constructor() {
    super();
    this.serversPath = path.resolve(process.cwd(), '.qilin-claw/mcp-servers.json');
    this.loadData();
  }

  private loadData(): void {
    if (fs.existsSync(this.serversPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.serversPath, 'utf-8'));
        for (const server of data) {
          this.servers.set(server.id, server);
        }
        console.log(`[MCPService] Loaded ${this.servers.size} MCP servers from disk`);
      } catch (error) {
        console.error('[MCPService] Failed to load MCP servers:', error);
      }
    }
  }

  private saveServers(): void {
    try {
      const dir = path.dirname(this.serversPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.serversPath, JSON.stringify(Array.from(this.servers.values()), null, 2));
    } catch (error) {
      console.error('[MCPService] Failed to save MCP servers:', error);
    }
  }

  private initializeDefaultServers(): void {
    // 添加一些常用的MCP服务器配置
    const defaultServers: Partial<MCPServer>[] = [
      {
        id: 'mcp-filesystem',
        name: '文件系统',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        env: {},
        enabled: false,
        capabilities: ['read_file', 'write_file', 'list_directory', 'search_files'],
      },
      {
        id: 'mcp-memory',
        name: '记忆存储',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: {},
        enabled: false,
        capabilities: ['store', 'retrieve', 'search'],
      },
      {
        id: 'mcp-sqlite',
        name: 'SQLite数据库',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite'],
        env: {},
        enabled: false,
        capabilities: ['query', 'execute', 'list_tables'],
      },
    ];

    for (const server of defaultServers) {
      this.servers.set(server.id!, {
        id: server.id!,
        name: server.name!,
        command: server.command!,
        args: server.args!,
        env: server.env || {},
        enabled: server.enabled || false,
        status: 'stopped',
        capabilities: server.capabilities || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.saveServers();
  }

  getAllServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  getServer(id: string): MCPServer | undefined {
    return this.servers.get(id);
  }

  getEnabledServers(): MCPServer[] {
    return Array.from(this.servers.values()).filter(s => s.enabled);
  }

  addServer(config: Omit<MCPServer, 'id' | 'status' | 'createdAt' | 'updatedAt'>): MCPServer {
    const server: MCPServer = {
      ...config,
      id: `mcp-${Date.now()}`,
      status: 'stopped',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.servers.set(server.id, server);
    this.saveServers();
    return server;
  }

  updateServer(id: string, updates: Partial<MCPServer>): MCPServer | undefined {
    const server = this.servers.get(id);
    if (!server) return undefined;

    const updated = {
      ...server,
      ...updates,
      id: server.id,
      createdAt: server.createdAt,
      updatedAt: Date.now(),
    };
    this.servers.set(id, updated);
    this.saveServers();
    return updated;
  }

  deleteServer(id: string): boolean {
    this.stopServer(id);
    const deleted = this.servers.delete(id);
    if (deleted) {
      this.saveServers();
    }
    return deleted;
  }

  async startServer(id: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server || !server.enabled) return false;

    if (this.processes.has(id)) {
      return true; // Already running
    }

    try {
      const childProcess = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.processes.set(id, childProcess);

      childProcess.stdout?.on('data', (data) => {
        try {
          const message = JSON.parse(data.toString()) as MCPMessage;
          this.handleMessage(id, message);
        } catch (e) {
          // Ignore parse errors
        }
      });

      childProcess.stderr?.on('data', (data) => {
        console.error(`[MCP ${server.name}] Error:`, data.toString());
      });

      childProcess.on('close', () => {
        this.processes.delete(id);
        this.updateServer(id, { status: 'stopped' });
        this.emit('server:stopped', id);
      });

      this.updateServer(id, { status: 'running' });
      this.emit('server:started', id);

      // 初始化连接
      await this.sendRequest(id, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'Qilin Claw',
          version: '1.0.0',
        },
      });

      return true;
    } catch (error) {
      console.error(`Failed to start MCP server ${server.name}:`, error);
      this.updateServer(id, { status: 'error' });
      return false;
    }
  }

  stopServer(id: string): boolean {
    const process = this.processes.get(id);
    if (!process) return true;

    try {
      process.kill();
      this.processes.delete(id);
      this.updateServer(id, { status: 'stopped' });
      this.emit('server:stopped', id);
      return true;
    } catch (error) {
      console.error(`Failed to stop MCP server ${id}:`, error);
      return false;
    }
  }

  private async sendRequest(serverId: string, method: string, params?: any): Promise<any> {
    const process = this.processes.get(serverId);
    if (!process?.stdin) {
      throw new Error('Server not running');
    }

    const message: MCPMessage = {
      jsonrpc: '2.0',
      id: ++this.messageId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 30000);

      const handler = (msg: MCPMessage) => {
        if (msg.id === message.id) {
          clearTimeout(timeout);
          this.off('response', handler);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      };

      this.on('response', handler);
      process.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  private handleMessage(serverId: string, message: MCPMessage): void {
    if (message.id !== undefined) {
      this.emit('response', message);
    } else if (message.method) {
      this.emit('notification', { serverId, method: message.method, params: message.params });
    }
  }

  async listTools(serverId: string): Promise<MCPTool[]> {
    const server = this.servers.get(serverId);
    if (!server || server.status !== 'running') {
      return [];
    }

    try {
      const result = await this.sendRequest(serverId, 'tools/list');
      const tools = result?.tools || [];
      this.tools.set(serverId, tools);
      return tools;
    } catch (error) {
      console.error(`Failed to list tools for ${serverId}:`, error);
      return [];
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server || server.status !== 'running') {
      throw new Error('Server not running');
    }

    return this.sendRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: args,
    });
  }

  async listResources(serverId: string): Promise<MCPResource[]> {
    const server = this.servers.get(serverId);
    if (!server || server.status !== 'running') {
      return [];
    }

    try {
      const result = await this.sendRequest(serverId, 'resources/list');
      const resources = result?.resources || [];
      this.resources.set(serverId, resources);
      return resources;
    } catch (error) {
      console.error(`Failed to list resources for ${serverId}:`, error);
      return [];
    }
  }

  async readResource(serverId: string, uri: string): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server || server.status !== 'running') {
      throw new Error('Server not running');
    }

    return this.sendRequest(serverId, 'resources/read', { uri });
  }

  getAllTools(): Map<string, MCPTool[]> {
    return this.tools;
  }

  getAllResources(): Map<string, MCPResource[]> {
    return this.resources;
  }
}

export const mcpService = new MCPService();
