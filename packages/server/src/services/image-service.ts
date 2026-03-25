import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

export interface ImageGenerationConfig {
  id: string;
  name: string;
  provider: 'openai' | 'stability' | 'midjourney' | 'nvidia' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultSize: string;
  defaultSteps: number;
  createdAt: number;
  updatedAt: number;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  size?: string;
  steps?: number;
  seed?: number;
  cfgScale?: number;
  style?: string;
}

export interface ImageGenerationResult {
  id: string;
  prompt: string;
  imageUrl?: string;
  base64Data?: string;
  seed?: number;
  createdAt: number;
}

export interface GeneratedImage {
  id: string;
  configId: string;
  prompt: string;
  negativePrompt?: string;
  imageUrl: string;
  localPath?: string;
  size: string;
  seed?: number;
  createdAt: number;
}

export class ImageService {
  private configs: Map<string, ImageGenerationConfig> = new Map();
  private images: GeneratedImage[] = [];
  private dataPath: string;
  private imagesPath: string;

  constructor(dataPath: string = '.qilin-claw/images') {
    this.dataPath = path.resolve(process.cwd(), dataPath);
    this.imagesPath = path.join(this.dataPath, 'generated');
    this.loadData();
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
    if (!fs.existsSync(this.imagesPath)) {
      fs.mkdirSync(this.imagesPath, { recursive: true });
    }
  }

  private loadData(): void {
    const configPath = path.join(this.dataPath, 'configs.json');
    if (fs.existsSync(configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        for (const config of data.configs || []) {
          this.configs.set(config.id, config);
        }
        this.images = data.images || [];
      } catch (error) {
        console.error('Failed to load image configs:', error);
      }
    }
  }

  private saveData(): void {
    this.ensureDirectories();
    const configPath = path.join(this.dataPath, 'configs.json');
    fs.writeFileSync(configPath, JSON.stringify({
      configs: Array.from(this.configs.values()),
      images: this.images,
    }, null, 2));
  }

  // Config Management
  getAllConfigs(): ImageGenerationConfig[] {
    return Array.from(this.configs.values());
  }

  getConfig(id: string): ImageGenerationConfig | undefined {
    return this.configs.get(id);
  }

  addConfig(config: Omit<ImageGenerationConfig, 'id' | 'createdAt' | 'updatedAt'>): ImageGenerationConfig {
    const newConfig: ImageGenerationConfig = {
      ...config,
      id: `img-config-${uuidv4()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.configs.set(newConfig.id, newConfig);
    this.saveData();
    return newConfig;
  }

  updateConfig(id: string, updates: Partial<ImageGenerationConfig>): ImageGenerationConfig | undefined {
    const config = this.configs.get(id);
    if (!config) return undefined;

    const updated = {
      ...config,
      ...updates,
      id: config.id,
      createdAt: config.createdAt,
      updatedAt: Date.now(),
    };
    this.configs.set(id, updated);
    this.saveData();
    return updated;
  }

  deleteConfig(id: string): boolean {
    const result = this.configs.delete(id);
    if (result) {
      this.saveData();
    }
    return result;
  }

  // Image Generation
  async generateImage(configId: string, request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Image generation config not found');
    }

    const result: ImageGenerationResult = {
      id: `img-${uuidv4()}`,
      prompt: request.prompt,
      createdAt: Date.now(),
    };

    try {
      switch (config.provider) {
        case 'openai':
          return await this.generateWithOpenAI(config, request, result);
        case 'stability':
          return await this.generateWithStability(config, request, result);
        case 'nvidia':
          return await this.generateWithNVIDIA(config, request, result);
        case 'custom':
          return await this.generateWithCustom(config, request, result);
        default:
          throw new Error(`Unsupported provider: ${config.provider}`);
      }
    } catch (error) {
      console.error('Image generation failed:', error);
      throw error;
    }
  }

  private async generateWithOpenAI(
    config: ImageGenerationConfig,
    request: ImageGenerationRequest,
    result: ImageGenerationResult
  ): Promise<ImageGenerationResult> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'dall-e-3',
        prompt: request.prompt,
        n: 1,
        size: request.size || config.defaultSize || '1024x1024',
        quality: 'standard',
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    result.base64Data = data.data[0].b64_json;
    result.imageUrl = `data:image/png;base64,${result.base64Data}`;

    await this.saveGeneratedImage(config.id, request, result);
    return result;
  }

  private async generateWithStability(
    config: ImageGenerationConfig,
    request: ImageGenerationRequest,
    result: ImageGenerationResult
  ): Promise<ImageGenerationResult> {
    const baseUrl = config.baseUrl || 'https://api.stability.ai';
    
    const response = await fetch(`${baseUrl}/v1/generation/${config.model || 'stable-diffusion-xl-1024-v1-0'}/text-to-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        text_prompts: [
          { text: request.prompt, weight: 1 },
          ...(request.negativePrompt ? [{ text: request.negativePrompt, weight: -1 }] : []),
        ],
        cfg_scale: request.cfgScale || 7,
        height: 1024,
        width: 1024,
        steps: request.steps || config.defaultSteps || 30,
        samples: 1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Stability API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    result.base64Data = data.artifacts[0].base64;
    result.seed = data.artifacts[0].seed;
    result.imageUrl = `data:image/png;base64,${result.base64Data}`;

    await this.saveGeneratedImage(config.id, request, result);
    return result;
  }

  private async generateWithNVIDIA(
    config: ImageGenerationConfig,
    request: ImageGenerationRequest,
    result: ImageGenerationResult
  ): Promise<ImageGenerationResult> {
    const response = await fetch(`${config.baseUrl || 'https://integrate.api.nvidia.com/v1'}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'stabilityai/stable-diffusion-xl-base-1.0',
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        image_size: request.size || '1024x1024',
        num_inference_steps: request.steps || 50,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`NVIDIA API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    if (data.data && data.data[0]) {
      result.imageUrl = data.data[0].url;
      result.base64Data = data.data[0].b64_json;
    }

    await this.saveGeneratedImage(config.id, request, result);
    return result;
  }

  private async generateWithCustom(
    config: ImageGenerationConfig,
    request: ImageGenerationRequest,
    result: ImageGenerationResult
  ): Promise<ImageGenerationResult> {
    if (!config.baseUrl) {
      throw new Error('Custom provider requires baseUrl');
    }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        size: request.size || config.defaultSize,
        steps: request.steps || config.defaultSteps,
        seed: request.seed,
        cfg_scale: request.cfgScale,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    result.imageUrl = data.url || data.image_url || data.data?.[0]?.url;
    result.base64Data = data.base64 || data.data?.[0]?.b64_json;

    await this.saveGeneratedImage(config.id, request, result);
    return result;
  }

  private async saveGeneratedImage(
    configId: string,
    request: ImageGenerationRequest,
    result: ImageGenerationResult
  ): Promise<void> {
    if (result.base64Data) {
      const filename = `${result.id}.png`;
      const localPath = path.join(this.imagesPath, filename);
      
      fs.writeFileSync(localPath, Buffer.from(result.base64Data, 'base64'));
      
      const image: GeneratedImage = {
        id: result.id,
        configId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        imageUrl: result.imageUrl || '',
        localPath,
        size: request.size || '1024x1024',
        seed: result.seed,
        createdAt: result.createdAt,
      };
      
      this.images.push(image);
      this.saveData();
    }
  }

  // Image Management
  getAllImages(): GeneratedImage[] {
    return this.images.sort((a, b) => b.createdAt - a.createdAt);
  }

  getImagesByConfig(configId: string): GeneratedImage[] {
    return this.images.filter(img => img.configId === configId);
  }

  deleteImage(id: string): boolean {
    const index = this.images.findIndex(img => img.id === id);
    if (index === -1) return false;

    const image = this.images[index];
    if (image.localPath && fs.existsSync(image.localPath)) {
      fs.unlinkSync(image.localPath);
    }

    this.images.splice(index, 1);
    this.saveData();
    return true;
  }

  getImageData(id: string): Buffer | null {
    const image = this.images.find(img => img.id === id);
    if (!image || !image.localPath || !fs.existsSync(image.localPath)) {
      return null;
    }
    return fs.readFileSync(image.localPath);
  }
}

export const imageService = new ImageService();
