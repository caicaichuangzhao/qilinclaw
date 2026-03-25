import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { AgentMemoryConfig } from './agent-memory.js';
import { getBuiltInSkills } from '../data/builtin-skills.js';

import {
  Skill,
  SkillAction,
  SkillExecutionContext, // This line is part of the original import, but the user's snippet had a partial line. Reverting to original.
  SkillExecutionResult,
  SkillRegistry,
  SkillMarketplaceItem,
  SkillCategory,
  SkillPermission,
} from '../types/skills';

// Assuming SkillExecutionContext might need these new properties for the approval flow.
// If these are not defined in '../types/skills', this will cause a type error.
// For the purpose of this edit, we assume they are or will be defined.
declare module '../types/skills' {
  interface SkillExecutionContext {
    agentId?: string;
    agentName?: string;
    onApprovalRequested?: (request: SkillApprovalRequest) => void;
    sandboxEnabled?: boolean;
    hardSandboxEnabled?: boolean;
  }
}

// New interfaces and classes for ApprovalManager
export interface SkillApprovalRequest {
  executionId: string;
  skillName: string;
  actionName: string;
  parameters: Record<string, any>;
  agentName: string;
}

export class ApprovalManager {
  private pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; reject: (reason: any) => void }>();

  createApproval(executionId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.pendingApprovals.set(executionId, { resolve, reject });

      // Auto-reject after 5 minutes if no response
      setTimeout(() => {
        if (this.pendingApprovals.has(executionId)) {
          this.rejectApproval(executionId, new Error('Approval request timed out after 5 minutes'));
        }
      }, 5 * 60 * 1000);
    });
  }

  resolveApproval(executionId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(executionId);
    if (pending) {
      pending.resolve(approved);
      this.pendingApprovals.delete(executionId);
      return true;
    }
    return false;
  }

  rejectApproval(executionId: string, error: Error): boolean {
    const pending = this.pendingApprovals.get(executionId);
    if (pending) {
      pending.reject(error);
      this.pendingApprovals.delete(executionId);
      return true;
    }
    return false;
  }
}

export const globalApprovalManager = new ApprovalManager();

const execAsync = promisify(exec);

async function fetchUrl(url: string, options?: any): Promise<any> {
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    throw new Error(`Fetch failed: ${error}`);
  }
}

export class SkillEngine {
  private skills: SkillRegistry = {};
  private skillsPath: string;
  private marketplacePath: string;
  private builtInSkills: Skill[] = [];
  private marketplaceSkills: Map<string, Skill> = new Map();

  constructor(skillsPath: string = '.qilin-claw/skills.json', marketplacePath: string = '.qilin-claw/marketplace.json') {
    this.skillsPath = path.resolve(process.cwd(), skillsPath);
    this.marketplacePath = path.resolve(process.cwd(), marketplacePath);
    this.initializeMarketplaceSkills();
    this.builtInSkills = getBuiltInSkills();
    this.loadSkills();
  }

  private loadSkills(): void {
    for (const skill of this.builtInSkills) {
      this.skills[skill.id] = skill;
    }

    if (fs.existsSync(this.skillsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.skillsPath, 'utf-8'));
        for (const skill of data.skills || []) {
          this.skills[skill.id] = skill;
        }
      } catch (error) {
        console.error('Failed to load skills:', error);
      }
    }

    // Load OpenClaw skills dynamically
    try {
      const openClawWorkspaceDir = path.resolve(process.cwd(), '.qilin-claw', 'skills-workspace');
      this.reloadOpenClawSkills(openClawWorkspaceDir);
    } catch (error) {
      console.error('Failed to load OpenClaw skills at startup:', error);
    }
  }

  public reloadOpenClawSkills(workspaceDir: string): void {
    if (!fs.existsSync(workspaceDir)) return;

    try {
      const folders = fs.readdirSync(workspaceDir);
      for (const folder of folders) {
        const skillPath = path.join(workspaceDir, folder);
        const stat = fs.statSync(skillPath);
        if (!stat.isDirectory()) continue;

        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) continue;

        const content = fs.readFileSync(skillMdPath, 'utf-8');

        // Very basic simple frontmatter extraction (can be improved with gray-matter later if needed)
        let name = folder;
        let description = 'OpenClaw Skill';
        let icon = 'clawhub';

        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const fm = frontmatterMatch[1];
          const nameMatch = fm.match(/^name:\s*(.*)$/m);
          if (nameMatch) name = nameMatch[1].trim();

          const descMatch = fm.match(/^description:\s*(.*)$/m);
          if (descMatch) description = descMatch[1].trim();
        }

        const engineSkill: Skill = {
          id: `openclaw-${folder}`,
          name: name,
          description: description,
          longDescription: content, // Save the SKILL.md fully into longDescription
          type: 'tool',
          status: 'installed',
          enabled: true,
          trigger: {
            type: 'keyword',
            patterns: [name, folder]
          },
          actions: [
            {
              id: `action-openclaw-${folder}`,
              type: 'llm', // Using LLM pseudo action so the LLM reads the instructions and uses arbitrary tools
              name: '执行此 OpenClaw 技能',
              description: '阅读并执行来自于 OpenClaw 社区的技能步骤',
              parameters: [],
              config: {
                systemPrompt: `由于此时你正在调用名为 ${name} 的 OpenClaw 技能。请务必优先遵循以下 SKILL.md 中的指令和最佳实践来满足用户的意图，使用你拥有的终端执行等工具：\n\n${content}`
              }
            }
          ],
          metadata: {
            author: 'OpenClaw Community',
            version: '1.0.0', // Read from meta later if needed
            license: 'MIT',
            category: '社区技能',
            icon: icon
          },
          createdAt: stat.birthtimeMs,
          updatedAt: stat.mtimeMs
        };

        this.skills[engineSkill.id] = engineSkill;
      }
    } catch (error) {
      console.error(`Error reloading OpenClaw skills:`, error);
    }
  }

  private saveSkills(): void {
    const customSkills = Object.values(this.skills).filter(
      s => !this.builtInSkills.find(b => b.id === s.id)
    );

    const dir = path.dirname(this.skillsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.skillsPath, JSON.stringify({ skills: customSkills }, null, 2));
  }

  getAllSkills(): Skill[] {
    return Object.values(this.skills);
  }

  getSkill(id: string): Skill | undefined {
    return this.skills[id];
  }

  getEnabledSkills(): Skill[] {
    return Object.values(this.skills).filter(s => s.enabled);
  }

  async executeSkill(context: SkillExecutionContext): Promise<SkillExecutionResult> {
    const { skill, action, message, parameters } = context;

    try {
      const isHighRisk = this.isHighRiskSkill(skill, action);

      if (isHighRisk && context.agentId) {
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        console.log(`[SkillEngine] High risk skill intercepted: ${skill.id}.${action.id}. Requesting approval for executionId: ${executionId}`);

        if (context.onApprovalRequested) {
          context.onApprovalRequested({
            executionId,
            skillName: skill.name,
            actionName: action.name,
            parameters: parameters || {},
            agentName: context.agentName || context.agentId
          });

          console.log(`[SkillEngine] Waiting for user approval on ${executionId}...`);
          const approved = await globalApprovalManager.createApproval(executionId);
          if (!approved) {
            return {
              success: false,
              error: 'User denied permission to execute this skill.',
            };
          }
          console.log(`[SkillEngine] User approved execution ${executionId}. Proceeding.`);
        }
      }

      switch (action.type) {
        case 'shell':
          return await this.executeShellAction(action, parameters, {
            sandboxEnabled: context.sandboxEnabled,
            hardSandboxEnabled: context.hardSandboxEnabled,
            agentId: context.agentId,
          });
        case 'file':
          return await this.executeFileAction(action, parameters);
        case 'llm':
          return this.executeLLMAction(action, message);
        case 'api':
          return await this.executeAPIAction(action, parameters);
        default:
          return {
            success: false,
            error: `Unsupported action type: ${action.type}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private isHighRiskSkill(skill: Skill, action: SkillAction): boolean {
    const highRiskSkillIds = ['run_command']; // Assuming 'run_command' is a skill ID
    const highRiskActionIds = ['writeFile', 'deleteFile', 'deleteDirectory']; // Assuming these are action IDs

    // Check if the skill itself is high risk
    if (highRiskSkillIds.includes(skill.id)) return true;

    // Check if the skill is 'filesystem' and the action is high risk
    if (skill.id === 'filesystem' && highRiskActionIds.includes(action.id)) return true;

    return false;
  }

  private async executeShellAction(
    action: SkillAction,
    parameters?: Record<string, any>,
    sandboxOpts?: { sandboxEnabled?: boolean; hardSandboxEnabled?: boolean; agentId?: string }
  ): Promise<SkillExecutionResult> {
    const command = parameters?.command;
    const cwd = parameters?.cwd || process.cwd();
    const timeout = parameters?.timeout || action.config.maxTimeout || 30000;

    if (!command) {
      return { success: false, error: 'Command is required' };
    }

    // ── Runtime command safety check (applies to ALL execution modes) ──
    const { checkCommandSafety, formatBlockedMessage, sanitizeCommandOutput } = await import('../safety/command-safety.js');
    const safetyCheck = checkCommandSafety(command);
    if (safetyCheck.blocked) {
      console.warn(`[SkillEngine/Security] BLOCKED dangerous command: [${safetyCheck.category}] ${safetyCheck.description} — "${command.substring(0, 80)}"`);
      return {
        success: false,
        error: formatBlockedMessage(safetyCheck.category!, safetyCheck.description!, command),
      };
    }

    // Docker hard sandbox: route command into isolated container
    if (sandboxOpts?.hardSandboxEnabled && sandboxOpts?.agentId) {
      try {
        const { dockerSandboxService } = await import('./docker-sandbox.js');
        console.log(`[SkillEngine] Routing shell command to Docker sandbox (agent: ${sandboxOpts.agentId}): ${command}`);
        const { stdout, stderr } = await dockerSandboxService.runInSandbox(command, sandboxOpts.agentId);
        let result = '';
        if (stdout) result += `STDOUT:\n${sanitizeCommandOutput(stdout)}\n`;
        if (stderr) result += `STDERR:\n${sanitizeCommandOutput(stderr)}\n`;
        return {
          success: true,
          output: result || 'Command executed successfully in Docker sandbox with no output.',
          data: { stderr },
        };
      } catch (error) {
        return {
          success: false,
          error: `[Docker Sandbox Error] ${error instanceof Error ? error.message : 'Shell execution failed in sandbox'}`,
        };
      }
    }

    // Soft sandbox: deny execution, tell agent to ask the user
    if (sandboxOpts?.sandboxEnabled) {
      return {
        success: false,
        error: '[Sandbox Security] 软沙箱模式下禁止自动执行终端命令。请将命令展示给用户，让用户手动执行。',
      };
    }

    // No sandbox: execute directly on host
    try {
      const isWindows = process.platform === 'win32';
      const finalCommand = isWindows ? `chcp 65001 >nul & ${command}` : command;
      const { stdout, stderr } = await execAsync(finalCommand, {
        cwd,
        timeout,
      });

      return {
        success: true,
        output: stdout,
        data: { stderr },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Shell execution failed',
      };
    }
  }

  private async executeFileAction(action: SkillAction, parameters?: Record<string, any>): Promise<SkillExecutionResult> {
    const filePath = parameters?.path;
    const operation = action.config.operation;

    if (!filePath) {
      return { success: false, error: 'File path is required' };
    }

    try {
      const resolvedPath = path.resolve(filePath);

      switch (operation) {
        case 'read':
          const content = fs.readFileSync(resolvedPath, 'utf-8');
          return { success: true, output: content };

        case 'write':
          const writeContent = parameters?.content;
          if (!writeContent) {
            return { success: false, error: 'Content is required' };
          }
          fs.writeFileSync(resolvedPath, writeContent, 'utf-8');
          return { success: true, output: 'File written successfully' };

        default:
          return { success: false, error: `Unknown file operation: ${operation}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'File operation failed',
      };
    }
  }

  private executeLLMAction(action: SkillAction, message?: string): SkillExecutionResult {
    return {
      success: true,
      data: {
        systemPrompt: action.config.systemPrompt,
        userMessage: message,
      },
    };
  }

  private async executeAPIAction(action: SkillAction, parameters?: Record<string, any>): Promise<SkillExecutionResult> {
    const config = action.config;

    if (!config.endpoint) {
      return {
        success: false,
        error: 'API endpoint not configured',
      };
    }

    try {
      let url = config.endpoint;
      const method = config.method || 'GET';
      const headers = config.headers || {};
      const body: any = {};

      if (parameters) {
        for (const [key, value] of Object.entries(parameters)) {
          if (url.includes(`{${key}}`)) {
            url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
          } else {
            body[key] = value;
          }
        }
      }

      const options: any = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      if (method !== 'GET' && Object.keys(body).length > 0) {
        options.body = JSON.stringify(body);
      }

      const result = await fetchUrl(url, options);

      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'API call failed',
      };
    }
  }

  matchSkill(message: string): Skill | null {
    const enabledSkills = this.getEnabledSkills();

    for (const skill of enabledSkills) {
      const { type, patterns, schedule } = skill.trigger;

      if (type === 'always') {
        return skill;
      }

      if (patterns) {
        for (const pattern of patterns) {
          if (type === 'keyword') {
            if (message.toLowerCase().includes(pattern.toLowerCase())) {
              return skill;
            }
          } else if (type === 'regex') {
            try {
              const regex = new RegExp(pattern, 'i');
              if (regex.test(message)) {
                return skill;
              }
            } catch (e) {
              console.error('Invalid regex pattern:', pattern);
            }
          }
        }
      }
    }

    return null;
  }

  getSkillSystemPrompt(skill: Skill): string | undefined {
    const llmAction = skill.actions.find(a => a.type === 'llm');
    return llmAction?.config?.systemPrompt;
  }

  addSkill(skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Skill {
    const newSkill: Skill = {
      ...skill,
      id: `skill-${Date.now()}`,
      status: 'installed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      installedAt: Date.now(),
    };
    this.skills[newSkill.id] = newSkill;
    this.saveSkills();
    return newSkill;
  }

  updateSkill(id: string, updates: Partial<Skill>): Skill | undefined {
    const skill = this.skills[id];
    if (!skill) return undefined;

    const updated = {
      ...skill,
      ...updates,
      id: skill.id,
      createdAt: skill.createdAt,
      updatedAt: Date.now(),
    };
    this.skills[id] = updated;
    this.saveSkills();
    return updated;
  }

  deleteSkill(id: string): boolean {
    if (this.builtInSkills.find(s => s.id === id)) {
      const skill = this.skills[id];
      if (skill) {
        this.updateSkill(id, { enabled: false });
        return true;
      }
      return false;
    }

    const result = delete this.skills[id];
    if (result) {
      this.saveSkills();
    }
    return result;
  }

  getCategories(): SkillCategory[] {
    return [
      { id: 'all', name: '全部', description: '所有技能', icon: 'grid' },
      { id: '工具', name: '工具', description: '实用工具类技能', icon: 'wrench' },
      { id: '开发工具', name: '开发工具', description: '开发者专用技能', icon: 'code' },
      { id: '开发', name: '开发', description: '开发相关技能', icon: 'terminal' },
      { id: '学习', name: '学习', description: '教育学习类技能', icon: 'book' },
      { id: '集成', name: '集成', description: '第三方服务集成', icon: 'puzzle' },
      { id: '自动化', name: '自动化', description: '工作流自动化', icon: 'refresh' },
    ];
  }

  private initializeMarketplaceSkills(): void {
    // Marketplace is now fetched directly via Clawhub.ai API in the router.
    // Kept empty to avoid breaking legacy code structure if still called.
  }

  getMarketplaceItems(): SkillMarketplaceItem[] {
    // This is no longer actively used to fetch local items. 
    // Handled by express router hitting live endpoint.
    return [];
  }

  installMarketplaceSkill(skillId: string): Skill | null {
    const marketplaceSkill = this.marketplaceSkills.get(skillId);
    if (!marketplaceSkill) {
      return null;
    }

    const installedSkill: Skill = {
      ...marketplaceSkill,
      status: 'installed',
      installedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.skills[skillId] = installedSkill;
    this.saveSkills();

    return installedSkill;
  }

  uninstallSkill(skillId: string): boolean {
    if (this.builtInSkills.find(s => s.id === skillId)) {
      return false;
    }

    const result = delete this.skills[skillId];
    if (result) {
      this.saveSkills();
    }
    return result;
  }
}

export const skillEngine = new SkillEngine();
