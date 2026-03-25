import os from 'os';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
  suggestions?: string[];
}

export interface SystemDiagnostics {
  timestamp: number;
  platform: string;
  nodeVersion: string;
  checks: HealthCheckResult[];
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
  };
}

class DiagnosticService {
  private workspaceRoot: string;
  private serverRoot: string;

  constructor() {
    this.workspaceRoot = process.cwd();
    // Find the server package directory (where package.json is)
    this.serverRoot = this.findServerRoot();
  }

  private findServerRoot(): string {
    let dir = this.workspaceRoot;
    // Check if we're in the server directory
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    // Check if we're in the root and packages/server exists
    const serverDir = path.join(dir, 'packages', 'server');
    if (fs.existsSync(path.join(serverDir, 'package.json'))) {
      return serverDir;
    }
    return dir;
  }

  private findMonorepoRoot(): string {
    let dir = this.workspaceRoot;
    // Check for monorepo root (has packages/ directory and node_modules)
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'packages')) && fs.existsSync(path.join(dir, 'node_modules'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
    return this.workspaceRoot;
  }

  async runAllChecks(): Promise<SystemDiagnostics> {
    const checks = await Promise.all([
      this.checkNodeVersion(),
      this.checkNpmPackages(),
      this.checkDataDirectory(),
      this.checkConfigFiles(),
      this.checkLLMConfig(),
      this.checkEmbeddingConfig(),
      this.checkAgentData(),
      this.checkBotData(),
      this.checkKnowledgeBases(),
      this.checkMemoryData(),
      this.checkDiskSpace(),
      this.checkNetworkConnectivity(),
    ]);

    const summary = {
      total: checks.length,
      ok: checks.filter(c => c.status === 'ok').length,
      warnings: checks.filter(c => c.status === 'warning').length,
      errors: checks.filter(c => c.status === 'error').length,
    };

    return {
      timestamp: Date.now(),
      platform: `${os.platform()} ${os.release()}`,
      nodeVersion: process.version,
      checks,
      summary,
    };
  }

  private checkNodeVersion(): Promise<HealthCheckResult> {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    
    if (major >= 18) {
      return Promise.resolve({
        name: 'Node.js 版本',
        status: 'ok',
        message: `Node.js ${version}`,
        details: { version },
      });
    } else {
      return Promise.resolve({
        name: 'Node.js 版本',
        status: 'error',
        message: `Node.js 版本过低: ${version}，需要 >= 18`,
        suggestions: ['请升级 Node.js 到 18.x 或更高版本'],
      });
    }
  }

  private async checkNpmPackages(): Promise<HealthCheckResult> {
    try {
      const monorepoRoot = this.findMonorepoRoot();
      const serverPackageJson = path.join(this.serverRoot, 'package.json');
      
      if (!fs.existsSync(serverPackageJson)) {
        return {
          name: 'NPM 依赖',
          status: 'error',
          message: 'package.json 不存在',
          suggestions: ['请确保在正确的项目目录下运行'],
        };
      }

      // Check node_modules in monorepo root (for monorepo) or server directory
      const nodeModulesPath = fs.existsSync(path.join(monorepoRoot, 'node_modules'))
        ? path.join(monorepoRoot, 'node_modules')
        : path.join(this.serverRoot, 'node_modules');

      if (!fs.existsSync(nodeModulesPath)) {
        return {
          name: 'NPM 依赖',
          status: 'error',
          message: 'node_modules 不存在',
          suggestions: ['请在项目根目录运行 npm install 安装依赖'],
        };
      }

      const packageJson = JSON.parse(fs.readFileSync(serverPackageJson, 'utf-8'));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const missing: string[] = [];

      for (const dep of Object.keys(deps)) {
        if (!fs.existsSync(path.join(nodeModulesPath, dep))) {
          missing.push(dep);
        }
      }

      if (missing.length === 0) {
        return {
          name: 'NPM 依赖',
          status: 'ok',
          message: '所有依赖已安装',
          details: { totalPackages: Object.keys(deps).length, nodeModulesPath },
        };
      } else {
        return {
          name: 'NPM 依赖',
          status: 'error',
          message: `缺少 ${missing.length} 个依赖包: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
          details: { missing },
          suggestions: ['请在项目根目录运行 npm install 安装依赖'],
        };
      }
    } catch (error) {
      return {
        name: 'NPM 依赖',
        status: 'error',
        message: `检查失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkDataDirectory(): Promise<HealthCheckResult> {
    const dataDir = path.join(this.workspaceRoot, '.qilin-claw');
    
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        return {
          name: '数据目录',
          status: 'ok',
          message: '数据目录已创建',
          details: { path: dataDir },
        };
      }

      const stats = fs.statSync(dataDir);
      if (!stats.isDirectory()) {
        return {
          name: '数据目录',
          status: 'error',
          message: '.qilin-claw 不是目录',
          suggestions: ['请删除 .qilin-claw 文件并重新启动'],
        };
      }

      const files = fs.readdirSync(dataDir);
      return {
        name: '数据目录',
        status: 'ok',
        message: `数据目录正常，包含 ${files.length} 个文件`,
        details: { path: dataDir, files },
      };
    } catch (error) {
      return {
        name: '数据目录',
        status: 'error',
        message: `无法访问数据目录: ${(error as Error).message}`,
        suggestions: ['请检查文件权限'],
      };
    }
  }

  private async checkConfigFiles(): Promise<HealthCheckResult> {
    const configFiles = [
      { name: 'LLM配置', path: '.qilin-claw/claw.db', type: 'sqlite', description: 'SQLite数据库，存储LLM配置、安全配置等' },
      { name: 'Embedding配置', path: '.qilin-claw/embedding-config.json', type: 'json', description: '用于存储向量嵌入模型配置' },
      { name: 'Agent配置', path: '.qilin-claw/agents.json', type: 'json', description: '用于存储AI助手配置' },
      { name: 'Bot配置', path: '.qilin-claw/bots.json', type: 'json', description: '用于存储机器人配置' },
    ];

    const results: Array<{ name: string; exists: boolean; error?: string; description?: string }> = [];

    for (const config of configFiles) {
      const fullPath = path.join(this.workspaceRoot, config.path);
      try {
        if (fs.existsSync(fullPath)) {
          if (config.type === 'json') {
            const content = fs.readFileSync(fullPath, 'utf-8');
            JSON.parse(content);
          }
          results.push({ name: config.name, exists: true });
        } else {
          results.push({ name: config.name, exists: false, description: config.description });
        }
      } catch (error) {
        results.push({ name: config.name, exists: true, error: (error as Error).message });
      }
    }

    const corrupted = results.filter(r => r.error);
    const missing = results.filter(r => !r.exists);

    if (corrupted.length > 0) {
      return {
        name: '配置文件',
        status: 'error',
        message: `${corrupted.map(r => r.name).join('、')} 文件格式错误`,
        details: { corrupted: corrupted.map(r => ({ name: r.name, error: r.error })) },
        suggestions: ['请检查对应配置文件的 JSON 格式是否正确', '或删除损坏的配置文件让系统重新创建'],
      };
    }

    if (missing.length > 0) {
      const missingInfo = missing.map(r => `• ${r.name}: ${r.description}`).join('\n');
      return {
        name: '配置文件',
        status: 'warning',
        message: `${missing.map(r => r.name).join('、')} 尚未创建`,
        details: { missing: missing.map(r => ({ name: r.name, description: r.description })) },
        suggestions: ['这是正常现象，配置文件将在首次使用时自动创建', '您可以前往对应页面进行配置'],
      };
    }

    return {
      name: '配置文件',
      status: 'ok',
      message: '所有配置文件正常',
      details: { files: results.map(r => r.name) },
    };
  }

  private async checkLLMConfig(): Promise<HealthCheckResult> {
    try {
      // LLM配置存储在SQLite数据库中，检查数据库文件
      const dbPath = path.join(this.workspaceRoot, '.qilin-claw/claw.db');
      if (!fs.existsSync(dbPath)) {
        return {
          name: 'LLM 配置',
          status: 'warning',
          message: '数据库不存在',
          suggestions: ['请重启服务器以创建数据库'],
        };
      }

      // 通过API或服务检查LLM配置
      // 这里简化处理，只检查数据库文件是否存在
      return {
        name: 'LLM 配置',
        status: 'ok',
        message: 'LLM配置存储在数据库中',
        details: { storage: 'SQLite数据库' },
      };
    } catch (error) {
      return {
        name: 'LLM 配置',
        status: 'error',
        message: `配置检查失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkEmbeddingConfig(): Promise<HealthCheckResult> {
    try {
      const configPath = path.join(this.workspaceRoot, '.qilin-claw/embedding-config.json');
      if (!fs.existsSync(configPath)) {
        return {
          name: 'Embedding 配置',
          status: 'warning',
          message: '未配置 Embedding 模型',
          suggestions: ['请在知识库页面配置 Embedding 模型'],
        };
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!config.provider || !config.model) {
        return {
          name: 'Embedding 配置',
          status: 'warning',
          message: 'Embedding 配置不完整',
          suggestions: ['请完善 Embedding 配置'],
        };
      }

      return {
        name: 'Embedding 配置',
        status: 'ok',
        message: `Embedding 已配置: ${config.provider}/${config.model}`,
        details: config,
      };
    } catch (error) {
      return {
        name: 'Embedding 配置',
        status: 'error',
        message: `配置解析失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkAgentData(): Promise<HealthCheckResult> {
    try {
      const configPath = path.join(this.workspaceRoot, '.qilin-claw/agents.json');
      if (!fs.existsSync(configPath)) {
        return {
          name: 'AI 助手',
          status: 'ok',
          message: '暂无助手数据',
          details: { count: 0 },
        };
      }

      const agents = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        name: 'AI 助手',
        status: 'ok',
        message: `${agents.length} 个 AI 助手`,
        details: { 
          count: agents.length,
          agents: agents.map((a: any) => ({ id: a.id, name: a.name })),
        },
      };
    } catch (error) {
      return {
        name: 'AI 助手',
        status: 'error',
        message: `数据解析失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkBotData(): Promise<HealthCheckResult> {
    try {
      const configPath = path.join(this.workspaceRoot, '.qilin-claw/bots.json');
      if (!fs.existsSync(configPath)) {
        return {
          name: '机器人',
          status: 'ok',
          message: '暂无机器人数据',
          details: { count: 0 },
        };
      }

      const bots = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const enabled = bots.filter((b: any) => b.enabled);

      return {
        name: '机器人',
        status: 'ok',
        message: `${bots.length} 个机器人，${enabled.length} 个已启用`,
        details: { 
          total: bots.length,
          enabled: enabled.length,
          platforms: [...new Set(bots.map((b: any) => b.platform))],
        },
      };
    } catch (error) {
      return {
        name: '机器人',
        status: 'error',
        message: `数据解析失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkKnowledgeBases(): Promise<HealthCheckResult> {
    try {
      const knowledgeDir = path.join(this.workspaceRoot, '.qilin-claw/knowledge');
      
      if (!fs.existsSync(knowledgeDir)) {
        return {
          name: '知识库',
          status: 'ok',
          message: '暂无知识库数据',
          details: { path: knowledgeDir },
        };
      }

      const entries = fs.readdirSync(knowledgeDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory());
      
      return {
        name: '知识库',
        status: 'ok',
        message: `${dirs.length} 个知识库`,
        details: { 
          count: dirs.length,
          path: knowledgeDir,
        },
      };
    } catch (error) {
      return {
        name: '知识库',
        status: 'error',
        message: `检查失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkMemoryData(): Promise<HealthCheckResult> {
    try {
      const memoryDir = path.join(this.workspaceRoot, '.qilin-claw/memory');
      if (!fs.existsSync(memoryDir)) {
        return {
          name: '记忆存储',
          status: 'ok',
          message: '记忆存储目录不存在（将在使用时创建）',
        };
      }

      const files = fs.readdirSync(memoryDir);
      const entries = files.filter(f => f.endsWith('.json'));

      return {
        name: '记忆存储',
        status: 'ok',
        message: `${entries.length} 条记忆记录`,
        details: { files: entries.length },
      };
    } catch (error) {
      return {
        name: '记忆存储',
        status: 'error',
        message: `检查失败: ${(error as Error).message}`,
      };
    }
  }

  private async checkDiskSpace(): Promise<HealthCheckResult> {
    try {
      const stats = fs.statSync(this.workspaceRoot);
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const memPercentage = ((totalMem - freeMem) / totalMem) * 100;

      if (memPercentage > 90) {
        return {
          name: '系统内存',
          status: 'error',
          message: `内存使用率过高: ${memPercentage.toFixed(1)}%`,
          suggestions: ['请释放内存或增加系统内存'],
        };
      }

      if (memPercentage > 80) {
        return {
          name: '系统内存',
          status: 'warning',
          message: `内存使用率较高: ${memPercentage.toFixed(1)}%`,
          details: { 
            free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
            total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          },
        };
      }

      return {
        name: '系统内存',
        status: 'ok',
        message: `内存使用正常: ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB 可用`,
        details: { 
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          usedPercentage: memPercentage.toFixed(1),
        },
      };
    } catch (error) {
      return {
        name: '系统内存',
        status: 'warning',
        message: `无法检查内存: ${(error as Error).message}`,
      };
    }
  }

  private async checkNetworkConnectivity(): Promise<HealthCheckResult> {
    const testUrls = [
      { name: 'OpenAI', url: 'https://api.openai.com' },
      { name: 'Anthropic', url: 'https://api.anthropic.com' },
    ];

    const results: Array<{ name: string; reachable: boolean }> = [];

    for (const test of testUrls) {
      try {
        execSync(`curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 ${test.url}`, { encoding: 'utf-8' });
        results.push({ name: test.name, reachable: true });
      } catch {
        results.push({ name: test.name, reachable: false });
      }
    }

    const unreachable = results.filter(r => !r.reachable);

    if (unreachable.length === 0) {
      return {
        name: '网络连接',
        status: 'ok',
        message: '网络连接正常',
        details: { tested: results },
      };
    }

    return {
      name: '网络连接',
      status: 'warning',
      message: `部分 API 可能无法访问: ${unreachable.map(r => r.name).join(', ')}`,
      details: { tested: results },
      suggestions: ['请检查网络连接或配置代理'],
    };
  }
}

export const diagnosticService = new DiagnosticService();
