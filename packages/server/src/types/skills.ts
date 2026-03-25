export type SkillType = 'tool' | 'integration' | 'automation' | 'custom';
export type SkillActionType = 'llm' | 'function' | 'api' | 'file' | 'shell' | 'browser' | 'mcp';
export type TriggerType = 'keyword' | 'regex' | 'intent' | 'always' | 'scheduled';
export type SkillStatus = 'installed' | 'available' | 'disabled' | 'update_available';

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: any;
  description?: string;
  enum?: string[];
}

export interface SkillAction {
  id: string;
  type: SkillActionType;
  name: string;
  description: string;
  parameters?: SkillParameter[];
  config: Record<string, any>;
  handler?: string;
}

export interface SkillTrigger {
  type: TriggerType;
  patterns?: string[];
  schedule?: string;
  condition?: string;
}

export interface SkillPermission {
  name: string;
  description: string;
  granted: boolean;
  scope?: string[];
}

export interface SkillMetadata {
  author?: string;
  version?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  tags?: string[];
  category?: string;
  icon?: string;
  screenshots?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  type: SkillType;
  status: SkillStatus;
  enabled: boolean;

  trigger: SkillTrigger;
  actions: SkillAction[];
  permissions?: SkillPermission[];
  metadata?: SkillMetadata;

  configSchema?: Record<string, any>;
  userConfig?: Record<string, any>;

  dependencies?: string[];
  conflictsWith?: string[];

  createdAt: number;
  updatedAt: number;
  installedAt?: number;
}

export interface SkillExecutionContext {
  skill: Skill;
  action: SkillAction;
  message?: string;
  parameters?: Record<string, any>;
  conversationId?: string;
  userId?: string;
}

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  data?: any;
  error?: string;
  nextActions?: SkillAction[];
}

export interface SkillRegistry {
  [id: string]: Skill;
}

export interface SkillMarketplaceItem {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  category: string;
  tags: string[];
  icon?: string;
  installed: boolean;
  hasUpdate: boolean;
}

export interface SkillCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}
