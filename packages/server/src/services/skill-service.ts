import fs from 'fs';
import path from 'path';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  trigger: {
    type: 'keyword' | 'regex' | 'intent';
    patterns: string[];
  };
  actions: SkillAction[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillAction {
  type: 'llm' | 'function' | 'api' | 'file';
  config: Record<string, any>;
}

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: any;
}

export class SkillService {
  private skills: Map<string, Skill> = new Map();
  private skillsPath: string;
  private builtInSkills: Skill[] = [
    {
      id: 'skill-code-review',
      name: '代码审查',
      description: '自动审查代码质量、安全性和最佳实践',
      category: '开发',
      enabled: true,
      trigger: {
        type: 'keyword',
        patterns: ['审查代码', 'code review', '检查代码'],
      },
      actions: [
        {
          type: 'llm',
          config: {
            systemPrompt: `你是一位专业的代码审查专家。请从以下方面审查代码：
1. 代码质量和可读性
2. 潜在的bug和错误
3. 安全漏洞
4. 性能问题
5. 最佳实践建议

请提供详细的审查报告和改进建议。`,
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'skill-file-analyze',
      name: '文件分析',
      description: '分析文件内容和结构',
      category: '文件',
      enabled: true,
      trigger: {
        type: 'keyword',
        patterns: ['分析文件', '解析文件', 'analyze file'],
      },
      actions: [
        {
          type: 'llm',
          config: {
            systemPrompt: `你是一位文件分析专家。请分析用户上传的文件：
1. 文件类型和格式
2. 主要内容和结构
3. 关键信息提取
4. 潜在问题和建议

请提供详细的分析报告。`,
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'skill-translate',
      name: '翻译助手',
      description: '多语言翻译服务',
      category: '工具',
      enabled: true,
      trigger: {
        type: 'keyword',
        patterns: ['翻译', 'translate', '译成'],
      },
      actions: [
        {
          type: 'llm',
          config: {
            systemPrompt: `你是一位专业的翻译专家。请准确翻译用户提供的文本，保持原文的语气和风格。如果用户没有指定目标语言，请翻译为中文或英文。`,
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'skill-summarize',
      name: '内容摘要',
      description: '生成内容摘要和要点',
      category: '工具',
      enabled: true,
      trigger: {
        type: 'keyword',
        patterns: ['总结', '摘要', 'summarize', 'summary'],
      },
      actions: [
        {
          type: 'llm',
          config: {
            systemPrompt: `你是一位内容摘要专家。请为用户提供的内容生成：
1. 简洁的摘要
2. 关键要点列表
3. 主要结论

请保持摘要的准确性和完整性。`,
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'skill-explain',
      name: '概念解释',
      description: '解释复杂概念和术语',
      category: '学习',
      enabled: true,
      trigger: {
        type: 'keyword',
        patterns: ['解释', '什么是', 'explain', '什么是'],
      },
      actions: [
        {
          type: 'llm',
          config: {
            systemPrompt: `你是一位知识渊博的教育专家。请用清晰易懂的语言解释用户询问的概念：
1. 基本定义
2. 核心原理
3. 实际应用
4. 相关概念
5. 学习资源建议

请根据用户背景调整解释的深度和方式。`,
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  constructor(skillsPath: string = '.qilin-claw/skills.json') {
    this.skillsPath = path.resolve(process.cwd(), skillsPath);
    this.loadSkills();
  }

  private loadSkills(): void {
    // 加载内置技能
    for (const skill of this.builtInSkills) {
      this.skills.set(skill.id, skill);
    }

    // 加载自定义技能
    if (fs.existsSync(this.skillsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.skillsPath, 'utf-8'));
        for (const skill of data.skills || []) {
          this.skills.set(skill.id, skill);
        }
      } catch (error) {
        console.error('Failed to load skills:', error);
      }
    }
  }

  private saveSkills(): void {
    const customSkills = Array.from(this.skills.values()).filter(
      s => !this.builtInSkills.find(b => b.id === s.id)
    );
    
    const dir = path.dirname(this.skillsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.skillsPath, JSON.stringify({ skills: customSkills }, null, 2));
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  getEnabledSkills(): Skill[] {
    return Array.from(this.skills.values()).filter(s => s.enabled);
  }

  addSkill(skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>): Skill {
    const newSkill: Skill = {
      ...skill,
      id: `skill-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.skills.set(newSkill.id, newSkill);
    this.saveSkills();
    return newSkill;
  }

  updateSkill(id: string, updates: Partial<Skill>): Skill | undefined {
    const skill = this.skills.get(id);
    if (!skill) return undefined;

    const updated = {
      ...skill,
      ...updates,
      id: skill.id,
      createdAt: skill.createdAt,
      updatedAt: Date.now(),
    };
    this.skills.set(id, updated);
    this.saveSkills();
    return updated;
  }

  deleteSkill(id: string): boolean {
    if (this.builtInSkills.find(s => s.id === id)) {
      // 内置技能只能禁用，不能删除
      const skill = this.skills.get(id);
      if (skill) {
        this.updateSkill(id, { enabled: false });
        return true;
      }
      return false;
    }

    const result = this.skills.delete(id);
    if (result) {
      this.saveSkills();
    }
    return result;
  }

  matchSkill(message: string): Skill | null {
    const enabledSkills = this.getEnabledSkills();
    
    for (const skill of enabledSkills) {
      const { type, patterns } = skill.trigger;
      
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
    
    return null;
  }

  getSkillSystemPrompt(skill: Skill): string | undefined {
    const llmAction = skill.actions.find(a => a.type === 'llm');
    return llmAction?.config?.systemPrompt;
  }
}

export const skillService = new SkillService();
