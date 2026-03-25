import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { modelsManager } from '../models/manager.js';
import { createLLMAdapter } from '../models/adapter.js';
import { rateLimiter } from '../safety/rate-limiter.js';
import { agentService } from '../services/agent-service.js';
import { skillEngine, globalApprovalManager } from '../services/skill-engine.js';
import { knowledgeService } from '../services/knowledge-service.js';
import { contextMemory } from '../services/context-memory.js';
import { agentMemoryManager } from '../services/agent-memory.js';
import { usageTracker } from '../services/usage-tracker.js';
import { databaseService } from '../services/database.js';
import { AgentTools, executeAgentTool } from '../services/tools.js';
import { officeService } from '../services/office-service.js';
import { mcpService } from '../services/mcp-service.js';
import { gatewayService } from '../services/gateway.js';
import { chatOrchestrator } from '../services/chat-orchestrator.js';
import { MODEL_DATABASE, findModel, searchModels, getModelsByProvider, getAllModelsWithCustom, addCustomModel, removeCustomModel, type ModelInfo } from '../data/models.js';
import { LLM_CONFIG as GLOBAL_LLM_CONFIG } from '../config/constants.js';
import type { LLMConfig, ChatMessage, ToolCall } from '../types/index.js';

const router = express.Router();



router.get('/configs', async (req, res) => {
  try {
    const configs = modelsManager.getAllConfigs();
    res.json(configs.map(c => ({ ...c, apiKey: '***' })));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/models', (_req, res) => {
  const models = getAllModelsWithCustom();
  res.json(models);
});

router.get('/models/:provider', (req, res) => {
  const { provider } = req.params;
  const models = getModelsByProvider(provider);
  res.json(models);
});

router.get('/model-info/:modelId', (req, res) => {
  const { modelId } = req.params;
  const model = findModel(decodeURIComponent(modelId));
  if (model) {
    res.json(model);
  } else {
    res.status(404).json({ error: 'Model not found' });
  }
});

router.get('/models/search/:query', (req, res) => {
  const { query } = req.params;
  const models = searchModels(decodeURIComponent(query));
  res.json(models);
});

router.post('/models/custom', (req, res) => {
  try {
    const model: ModelInfo = req.body;
    if (!model.id || !model.name || !model.provider) {
      return res.status(400).json({ error: '缺少必要瀛楁' });
    }
    addCustomModel(model);
    res.json({ success: true, model });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/models/custom/:modelId', (req, res) => {
  try {
    const { modelId } = req.params;
    removeCustomModel(decodeURIComponent(modelId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/configs/:id/model-info', (req, res) => {
  try {
    const { id } = req.params;
    const config = modelsManager.getConfig(id);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    const modelInfo = findModel(config.model);
    if (!modelInfo) {
      return res.status(404).json({ error: 'Model info not found' });
    }

    res.json({
      modelId: modelInfo.id,
      modelName: modelInfo.name,
      contextLength: modelInfo.contextLength,
      maxOutputTokens: modelInfo.maxOutputTokens,
      recommendedMaxTokens: Math.min(modelInfo.maxOutputTokens, Math.floor(modelInfo.contextLength * 0.3)),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/configs/:id/auto-config', async (req, res) => {
  try {
    const { id } = req.params;
    const config = modelsManager.getConfig(id);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    const modelInfo = findModel(config.model);
    if (!modelInfo) {
      return res.status(404).json({ error: 'Model info not found' });
    }

    const updates = {
      maxTokens: Math.min(modelInfo.maxOutputTokens, Math.floor(modelInfo.contextLength * 0.3)),
      maxContextTokens: modelInfo.contextLength,
    };

    modelsManager.updateConfig(id, updates);

    const updatedConfig = modelsManager.getConfig(id);
    databaseService.saveLLMConfig(updatedConfig!);

    res.json({
      success: true,
      modelInfo: {
        modelName: modelInfo.name,
        contextLength: modelInfo.contextLength,
        maxOutputTokens: modelInfo.maxOutputTokens,
      },
      appliedConfig: updates,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/configs', async (req, res) => {
  try {
    const config: LLMConfig = {
      id: uuidv4(),
      ...req.body,
    };
    modelsManager.addConfig(config);
    databaseService.saveLLMConfig(config);
    res.json({ ...config, apiKey: '***' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    modelsManager.updateConfig(id, req.body);
    const config = modelsManager.getConfig(id);
    if (config) {
      databaseService.saveLLMConfig(config);
    }
    res.json({ ...config, apiKey: '***' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    modelsManager.removeConfig(id);
    databaseService.deleteLLMConfig(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/test', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, provider, modelType = 'chat', modelPath } = req.body;

    if (provider === 'local-native') {
      if (!model || !modelPath) {
        return res.status(400).json({ success: false, error: '缺少必要参数' });
      }
      const fs = await import('fs');
      if (!fs.existsSync(modelPath)) {
        return res.json({ success: false, error: '模型路径不存在' });
      }
      return res.json({
        success: true, message: '本地模型配置已就绪', reply: '准备就绪', model
      });
    }

    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    if (modelType === 'chat' || modelType === 'vision') {
      const testMessages = [{ role: 'user', content: '你好，这是一个API连接测试，请简短回复。' }];
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model, messages: testMessages, max_tokens: 50 }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.json({ success: false, error: errorData.error?.message || `HTTP ${response.status}: ${response.statusText}` });
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || '连接成功';
      return res.json({
        success: true, message: 'API连接成功', reply: reply.substring(0, 100), model: data.model, usage: data.usage
      });
    } else {
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.json({ success: false, error: errorData.error?.message || `HTTP ${response.status}: 连接验证失败` });
      }

      return res.json({
        success: true, message: `API连接成功 (授权已验证)`, reply: `验证通过`, model: model
      });
    }
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : '连接失败' });
  }
});

router.post('/test/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const config = modelsManager.getConfig(id);

    if (!config) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }

    if (config.provider === 'local-native') {
      const modelPath = (config as any).modelPath;
      if (!config.model || !modelPath) {
        return res.json({ success: false, error: '配置不完整' });
      }
      const fs = await import('fs');
      if (!fs.existsSync(modelPath)) {
        return res.json({ success: false, error: '模型路径不存在' });
      }
      return res.json({
        success: true, message: '本地模型配置已就绪', reply: '准备就绪', model: config.model
      });
    }

    const modelType = (config as any).modelType || 'chat';

    if (modelType === 'chat' || modelType === 'vision') {
      const testMessages = [{ role: 'user', content: '你好，这是一个API连接测试，请简短回复。' }];
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages: testMessages, max_tokens: 50 }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.json({ success: false, error: errorData.error?.message || `HTTP ${response.status}: ${response.statusText}` });
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || '连接成功';
      return res.json({
        success: true, message: 'API连接成功', reply: reply.substring(0, 100), model: data.model, usage: data.usage
      });
    } else {
      const response = await fetch(`${config.baseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.json({ success: false, error: errorData.error?.message || `HTTP ${response.status}: 连接验证失败` });
      }

      return res.json({
        success: true, message: 'API连接成功 (授权已验证)', reply: '验证通过', model: config.model
      });
    }
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : '连接失败' });
  }
});



router.get('/health/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const config = modelsManager.getConfig(id);

    if (!config) {
      return res.json({
        healthy: false,
        error: '配置不存在',
        latency: 0
      });
    }

    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok) {
        res.json({
          healthy: true,
          latency,
          model: config.model,
          provider: config.provider,
        });
      } else {
        const errorText = await response.text().catch(() => '');
        let errorMsg = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error?.message || errorJson.message || errorMsg;
        } catch { }

        res.json({
          healthy: false,
          error: errorMsg,
          latency,
          statusCode: response.status,
        });
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      let errorMsg = '连接失败';
      if (fetchError.name === 'AbortError') {
        errorMsg = '连接超时（5秒）';
      } else if (fetchError.cause?.code === 'ENOTFOUND') {
        errorMsg = `DNS解析失败: ${fetchError.cause.hostname}`;
      } else if (fetchError.cause?.code === 'ECONNREFUSED') {
        errorMsg = '连接被拒绝';
      } else if (fetchError.message) {
        errorMsg = fetchError.message;
      }

      res.json({
        healthy: false,
        error: errorMsg,
        latency,
      });
    }
  } catch (error) {
    res.json({
      healthy: false,
      error: error instanceof Error ? error.message : '检查失败',
      latency: 0,
    });
  }
});

// Image generation endpoint
router.post('/image-generate', async (req, res) => {
  try {
    const { configId, prompt, imageSize, negativePrompt, seed } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '提示词不能为空' });
    }

    const config = configId ? modelsManager.getConfig(configId) : null;
    if (!config) {
      return res.status(400).json({ error: '未找到模型配置' });
    }

    const baseUrl = config.baseUrl || 'https://api.siliconflow.cn/v1';

    console.log(`[ImageGen] Generating image: model=${config.model}, prompt="${prompt.substring(0, 50)}..."`);

    let finalImageSize = imageSize || config.imageSize || '1024x1024';

    // Dynamic resolution parsing from prompt
    if (finalImageSize === 'dynamic') {
      const p = prompt.toLowerCase();
      if (p.includes('16:9') || p.includes('16姣?') || p.includes('鐢佃剳澹佺焊') || p.includes('瀹藉睆')) {
        finalImageSize = '1664x928';
      } else if (p.includes('9:16') || p.includes('9姣?6') || p.includes('鎵嬫満澹佺焊') || p.includes('绔栧睆')) {
        finalImageSize = '928x1664';
      } else if (p.includes('4:3') || p.includes('4姣?')) {
        finalImageSize = '1472x1140';
      } else if (p.includes('3:4') || p.includes('3姣?')) {
        finalImageSize = '1140x1472';
      } else if (p.includes('3:2') || p.includes('3姣?')) {
        finalImageSize = '1584x1056';
      } else if (p.includes('2:3') || p.includes('2姣?')) {
        finalImageSize = '1056x1584';
      } else if (p.includes('1:1') || p.includes('1比1') || p.includes('正方形') || p.includes('头像')) {
        finalImageSize = '1024x1024';
      } else {
        // Default fallback if no cues found
        finalImageSize = '1024x1024';
      }
    }

    const requestBody: Record<string, any> = {
      model: config.model,
      prompt: prompt,
      image_size: finalImageSize,
    };

    if (negativePrompt) requestBody.negative_prompt = negativePrompt;
    if (seed !== undefined) requestBody.seed = seed;

    let response: Response | undefined;
    let fetchError: any;

    try {
      response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000), // Native timeout that doesn't conflict with stream reading
      });
    } catch (err: any) {
      console.log('[ImageGen] First attempt failed, retrying in 2s...', err.message);
      fetchError = err;
    }

    if (!response) {
      // Retry once on network errors
      await new Promise(r => setTimeout(r, 2000));
      try {
        response = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60000),
        });
      } catch (err: any) {
        console.error('[ImageGen] Retry failed:', err.message);
        throw new Error(`网络连接失败: ${err.message}`);
      }
    }

    const responseText = await response.text();
    console.log('[ImageGen] Raw Response:', responseText.substring(0, 500));

    if (!response.ok) {
      let errorMsg = `图像生成失败 [${response.status}]`;
      try {
        const errorJson = JSON.parse(responseText);
        errorMsg = errorJson.message || errorJson.error?.message || errorMsg;
      } catch {
        errorMsg = `${errorMsg}: ${responseText.substring(0, 100)}`;
      }
      console.error('[ImageGen] Error:', errorMsg);
      return res.status(response.status).json({ error: errorMsg });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('[ImageGen] Failed to parse API response as JSON:', responseText.substring(0, 200));
      return res.status(500).json({ error: 'API返回的数据格式无法解析' });
    }

    const images = data.images || data.data || [];
    console.log(`[ImageGen] Success: ${images.length} image(s) generated`);

    res.json({ images });
  } catch (error) {
    console.error('[ImageGen] Exception:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '图像生成失败',
    });
  }
});

// Audio TTS (Text-to-Speech) endpoint
router.post('/audio-speech', async (req, res) => {
  try {
    const { configId, input, voice, speed, responseFormat } = req.body;

    if (!input) {
      return res.status(400).json({ error: '文本内容不能为空' });
    }

    const config = configId ? modelsManager.getConfig(configId) : null;
    if (!config) {
      return res.status(400).json({ error: '未找到模型配置' });
    }

    const baseUrl = config.baseUrl || 'https://api.siliconflow.cn/v1';
    console.log(`[AudioTTS] Generating speech: model=${config.model}, text length=${input.length}`);

    const requestBody: Record<string, any> = {
      model: config.model,
      input: input,
      voice: voice || config.voice || 'alloy',
    };
    if (speed) requestBody.speed = speed;
    if (responseFormat || config.responseFormat) {
      requestBody.response_format = responseFormat || config.responseFormat || 'mp3';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      console.log('[AudioTTS] First attempt failed, retrying...', fetchErr.message);
      await new Promise(r => setTimeout(r, 2000));
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 60000);
      try {
        response = await fetch(`${baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: c2.signal,
        });
      } finally { clearTimeout(t2); }
    } finally { clearTimeout(timeoutId); }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `语音合成失败 [${response.status}]`;
      try { const j = JSON.parse(errorText); errorMsg = j.message || j.error?.message || errorMsg; } catch { }
      return res.status(response.status).json({ error: errorMsg });
    }

    // Return audio as base64 data URL
    const audioBuffer = await response.arrayBuffer();
    const format = requestBody.response_format || 'mp3';
    const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/opus', pcm: 'audio/pcm', flac: 'audio/flac' };
    const mime = mimeMap[format] || 'audio/mpeg';
    const base64 = Buffer.from(audioBuffer).toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    console.log(`[AudioTTS] Success: ${audioBuffer.byteLength} bytes`);
    res.json({ audio: dataUrl, format, size: audioBuffer.byteLength });
  } catch (error) {
    console.error('[AudioTTS] Exception:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '语音合成失败' });
  }
});

// Audio STT (Speech-to-Text) endpoint
router.post('/audio-transcribe', async (req, res) => {
  try {
    const { configId, audio, filename } = req.body; // audio is base64 data URL

    if (!audio) {
      return res.status(400).json({ error: '音频数据不能为空' });
    }

    const config = configId ? modelsManager.getConfig(configId) : null;
    if (!config) {
      return res.status(400).json({ error: '未找到模型配置' });
    }

    const baseUrl = config.baseUrl || 'https://api.siliconflow.cn/v1';
    console.log(`[AudioSTT] Transcribing audio: model=${config.model}`);

    // Convert base64 data URL to Buffer
    const base64Data = audio.replace(/^data:audio\/\w+;base64,/, '');
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Build multipart form data using Node.js 18+ globals
    const formData = new globalThis.FormData();
    formData.append('model', config.model);
    formData.append('file', new globalThis.Blob([audioBuffer]), filename || 'audio.wav');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        body: formData as any,
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      console.log('[AudioSTT] First attempt failed, retrying...', fetchErr.message);
      await new Promise(r => setTimeout(r, 2000));
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 60000);
      try {
        response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
          body: formData as any,
          signal: c2.signal,
        });
      } finally { clearTimeout(t2); }
    } finally { clearTimeout(timeoutId); }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `语音识别失败 [${response.status}]`;
      try { const j = JSON.parse(errorText); errorMsg = j.message || j.error?.message || errorMsg; } catch { }
      return res.status(response.status).json({ error: errorMsg });
    }

    const data = await response.json() as { text?: string };
    console.log(`[AudioSTT] Success: "${(data.text || '').substring(0, 50)}..."`);
    res.json({ text: data.text || '' });
  } catch (error) {
    console.error('[AudioSTT] Exception:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '语音识别失败' });
  }
});

// Video generation endpoint (async submit + poll)
router.post('/video-generate', async (req, res) => {
  try {
    const { configId, prompt, imageUrl } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '提示词不能为空' });
    }

    const config = configId ? modelsManager.getConfig(configId) : null;
    if (!config) {
      return res.status(400).json({ error: '未找到模型配置' });
    }

    const baseUrl = config.baseUrl || 'https://api.siliconflow.cn/v1';
    console.log(`[VideoGen] Generating video: model=${config.model}, prompt="${prompt.substring(0, 50)}..."`);

    const requestBody: Record<string, any> = {
      model: config.model,
      prompt: prompt,
    };
    if (imageUrl) requestBody.image_url = imageUrl;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let submitResponse: Response;
    try {
      submitResponse = await fetch(`${baseUrl}/video/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      console.log('[VideoGen] First attempt failed, retrying...', fetchErr.message);
      await new Promise(r => setTimeout(r, 2000));
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 30000);
      try {
        submitResponse = await fetch(`${baseUrl}/video/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: c2.signal,
        });
      } finally { clearTimeout(t2); }
    } finally { clearTimeout(timeoutId); }

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      let errorMsg = `视频生成提交失败 [${submitResponse.status}]`;
      try { const j = JSON.parse(errorText); errorMsg = j.message || j.error?.message || errorMsg; } catch { }
      return res.status(submitResponse.status).json({ error: errorMsg });
    }

    const submitData = await submitResponse.json() as { requestId?: string; id?: string };
    const requestId = submitData.requestId || submitData.id;

    if (!requestId) {
      return res.status(500).json({ error: '视频生成提交成功但未返回任务ID' });
    }

    console.log(`[VideoGen] Task submitted: ${requestId}, polling status...`);

    // Poll for status (max 2 minutes)
    const maxPolls = 24;
    const pollInterval = 5000;

    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const statusResponse = await fetch(`${baseUrl}/video/status/${requestId}`, {
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json() as {
            status?: string;
            results?: { videos?: Array<{ url: string }> };
            video_url?: string;
            url?: string;
          };

          if (statusData.status === 'completed' || statusData.status === 'succeeded' || statusData.video_url || statusData.url) {
            const videoUrl = statusData.video_url || statusData.url || statusData.results?.videos?.[0]?.url;
            console.log(`[VideoGen] Success: ${videoUrl?.substring(0, 80)}...`);
            return res.json({ video: videoUrl, requestId });
          }

          if (statusData.status === 'failed') {
            return res.status(500).json({ error: '视频生成失败' });
          }

          console.log(`[VideoGen] Poll ${i + 1}/${maxPolls}: status=${statusData.status}`);
        }
      } catch (pollErr) {
        console.warn(`[VideoGen] Poll error:`, pollErr);
      }
    }

    // Return requestId for continued polling from frontend
    res.json({ requestId, status: 'processing', message: '视频生成中，请稍后查询' });
  } catch (error) {
    console.error('[VideoGen] Exception:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '视频生成失败' });
  }
});

router.post('/chat', (req, res) => chatOrchestrator.handleChatRoute(req, res));

router.get('/configs/:id/models', async (req, res) => {
  try {
    const models = await modelsManager.getAvailableModels(req.params.id);
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as modelsRoutes };
