import fs from 'fs/promises';
import path from 'path';
import { MODEL_DATABASE, findModel, type ModelInfo } from '../data/models.js';

export interface ModelPrice {
    inputPer1k: number;
    outputPer1k: number;
    currency: 'CNY' | 'USD';
}

export interface ModelDefinition {
    id: string;
    name: string;
    contextWindow: number;
    price: ModelPrice;
}

export interface ModelTier {
    id: string;
    name: string;
    baseUrl: string;
    models: ModelDefinition[];
}

export interface ProviderDefinition {
    id: string;
    name: string;
    tiers: ModelTier[];
}

export interface ModelRegistry {
    version: number;
    lastUpdated: number;
    providers: ProviderDefinition[];
}

/**
 * 模型注册表服务
 * 从 data/models.ts 的 MODEL_DATABASE 派生 provider/tier/model 结构，
 * 供前端 Models.vue 的 Provider 下拉和 Model 建议列表使用。
 */
export class ModelDatabaseService {
    private registry: ModelRegistry | null = null;
    private registryPath: string = path.join(process.cwd(), '.qilin-claw', 'model-registry.json');

    async initialize() {
        this.registry = this.buildRegistryFromModels();
        await this.saveRegistry();
    }

    getRegistry(): ModelRegistry {
        if (!this.registry) {
            this.registry = this.buildRegistryFromModels();
        }
        return this.registry;
    }

    /**
     * 刷新注册表（从 MODEL_DATABASE 重新构建并保存）
     */
    async updateFromNetwork(): Promise<{ success: boolean; message: string; version?: number }> {
        try {
            this.registry = this.buildRegistryFromModels();
            await this.saveRegistry();

            const totalModels = this.registry.providers.reduce(
                (sum, p) => sum + p.tiers.reduce((s, t) => s + t.models.length, 0), 0
            );

            return {
                success: true,
                message: `模型库已刷新，共 ${this.registry.providers.length} 个提供商，${totalModels} 个模型`,
                version: this.registry.version
            };
        } catch (error) {
            return {
                success: false,
                message: `刷新失败：${(error as Error).message}`
            };
        }
    }

    /**
     * 查找模型定价信息（供 usage-tracker 使用）
     */
    findModelInfo(providerId: string, modelId: string): { tier: ModelTier, model: ModelDefinition } | null {
        const info = findModel(modelId);
        if (!info || !info.pricing) return null;

        return {
            tier: {
                id: 'default',
                name: info.providerLabel || info.provider,
                baseUrl: info.baseUrl || '',
                models: []
            },
            model: {
                id: info.id,
                name: info.name,
                contextWindow: info.contextLength,
                price: {
                    inputPer1k: info.pricing.input || 0,
                    outputPer1k: info.pricing.output || 0,
                    currency: (info.pricing.currency as 'CNY' | 'USD') || 'CNY'
                }
            }
        };
    }

    /**
     * 从 MODEL_DATABASE 构建 provider → tier → model 注册表结构
     */
    private buildRegistryFromModels(): ModelRegistry {
        const providerMap = new Map<string, { name: string; tiers: Map<string, ModelTier> }>();

        for (const model of MODEL_DATABASE) {
            const providerId = model.provider;
            if (!providerMap.has(providerId)) {
                providerMap.set(providerId, {
                    name: model.providerLabel || model.provider,
                    tiers: new Map()
                });
            }

            const provider = providerMap.get(providerId)!;
            const baseUrl = model.baseUrl || '';
            const tierId = baseUrl || 'default';

            if (!provider.tiers.has(tierId)) {
                provider.tiers.set(tierId, {
                    id: tierId === baseUrl ? 'default' : tierId,
                    name: provider.name,
                    baseUrl,
                    models: []
                });
            }

            provider.tiers.get(tierId)!.models.push({
                id: model.id,
                name: model.name,
                contextWindow: model.contextLength,
                price: {
                    inputPer1k: model.pricing?.input || 0,
                    outputPer1k: model.pricing?.output || 0,
                    currency: (model.pricing?.currency as 'CNY' | 'USD') || 'CNY'
                }
            });
        }

        const providers: ProviderDefinition[] = [];
        for (const [id, data] of providerMap) {
            providers.push({
                id,
                name: data.name,
                tiers: Array.from(data.tiers.values())
            });
        }

        return {
            version: 1,
            lastUpdated: Date.now(),
            providers
        };
    }

    private async saveRegistry() {
        try {
            await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
            await fs.writeFile(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
        } catch (error) {
            console.error('[ModelDatabase] Failed to save registry to disk:', error);
        }
    }
}

export const modelDatabase = new ModelDatabaseService();
