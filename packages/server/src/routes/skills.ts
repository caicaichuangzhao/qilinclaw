import express from 'express';
import { skillEngine, globalApprovalManager } from '../services/skill-engine.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const skills = skillEngine.getAllSkills();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const categories = skillEngine.getCategories();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/marketplace', async (req, res) => {
  try {
    const url = new URL('https://clawhub.ai/api/v1/search');
    // Fetch top/recent skills if no query is provided, or we can just get default search results.
    const query = (req.query.q as string) || 'skill';
    url.searchParams.append('q', query);

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    // Map Clawhub format to our UI SkillMarketplaceItem format
    const items = results.map((skill: any) => {
      // Check if installed locally
      const isInstalled = !!skillEngine.getSkill(`openclaw-${skill.slug}`);

      return {
        id: skill.slug,
        name: skill.displayName || skill.slug,
        description: skill.summary || 'No description provided.',
        author: skill.developer || 'Community',
        version: '1.0.0', // Clawhub API might not return version in search root
        downloads: Math.floor(Math.random() * 1000) + 50, // Mock downloads as API doesn't provide it yet
        rating: 4.8,
        category: '社区技能',
        tags: [],
        icon: 'clawhub',
        installed: isInstalled,
        hasUpdate: false,
      };
    });

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const skill = skillEngine.getSkill(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json(skill);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/', async (req, res) => {
  try {
    const skill = skillEngine.addSkill(req.body);
    res.json(skill);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const skill = skillEngine.updateSkill(req.params.id, req.body);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json(skill);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = skillEngine.deleteSkill(req.params.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/marketplace/:id/install', async (req, res) => {
  const skillId = req.params.id;
  try {
    const workspaceDir = path.resolve(process.cwd(), '.qilin-claw', 'skills-workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

    // Execute OpenClaw CLI natively
    await execAsync(`npx -y clawhub@latest install ${skillId} --force --dir "${workspaceDir}"`, {
      cwd: process.cwd(),
      timeout: 60000
    });

    // Perform strict security scanning on the downloaded SKILL.md
    const skillDir = path.join(workspaceDir, skillId);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    try {
      const skillContent = await fs.readFile(skillMdPath, 'utf-8');
      const maliciousPatterns = [
        /rm\s+-r[f\s]*\//i,          // rm -rf /
        /mkfs/i,                     // Format disk
        /\/dev\/tcp\//i,             // Reverse shell
        /curl\s+.*\|\s*(bash|sh)/i,  // Curl to bash
        /wget\s+.*-O-\s*\|\s*(bash|sh)/i, // Wget to bash
        /nc\s+-e/i,                  // Netcat exec
        />\s*\/dev\/sd[a-z]/i        // Overwrite block device
      ];

      for (const pattern of maliciousPatterns) {
        if (pattern.test(skillContent)) {
          // Delete the malicious malware immediately
          await fs.rm(skillDir, { recursive: true, force: true });
          return res.status(403).json({ error: `安全拦截: 技能包 "${skillId}" 包含恶意或高危的后门代码，已自动销毁并拦截安装。` });
        }
      }
    } catch (readErr) {
      return res.status(500).json({ error: `安全检查失败: 技能安装后无法读取 SKILL.md 配置文件 (${(readErr as Error).message})` });
    }

    // Reload skill engine to register new skills onto active context
    skillEngine.reloadOpenClawSkills(workspaceDir);

    // Fetch the newly installed skill to return to the UI
    const newlyInstalled = skillEngine.getSkill(`openclaw-${skillId}`);
    res.json(newlyInstalled || { success: true, id: skillId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/marketplace/:id/uninstall', async (req, res) => {
  const skillId = req.params.id;
  try {
    // If it's an OpenClaw skill, it sits in workspace dir
    const workspaceDir = path.resolve(process.cwd(), '.qilin-claw', 'skills-workspace');
    const skillDir = path.join(workspaceDir, skillId.replace('openclaw-', ''));

    try {
      await fs.rm(skillDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if not present
    }

    // Also tell engine to delete it from memory/local config
    skillEngine.deleteSkill(skillId.startsWith('openclaw-') ? skillId : `openclaw-${skillId}`);
    skillEngine.reloadOpenClawSkills(workspaceDir);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:id/execute', async (req, res) => {
  try {
    const skill = skillEngine.getSkill(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const actionId = req.body.actionId || skill.actions[0]?.id;
    const action = skill.actions.find(a => a.id === actionId);
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const result = await skillEngine.executeSkill({
      skill,
      action,
      message: req.body.message,
      parameters: req.body.parameters,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/approve', async (req, res) => {
  try {
    const { executionId, approved } = req.body;
    if (!executionId || typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'Missing executionId or approved boolean flag' });
    }

    const resolved = globalApprovalManager.resolveApproval(executionId, approved);
    if (!resolved) {
      return res.status(404).json({ error: 'Execution ID not found or already resolved/expired' });
    }

    res.json({ success: true, executionId, approved });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as skillsRoutes };
