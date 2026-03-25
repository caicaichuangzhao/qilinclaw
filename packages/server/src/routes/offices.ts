import { Router } from 'express';
import { officeService } from '../services/office-service.js';
import { agentService } from '../services/agent-service.js';
import { modelsManager } from '../models/manager.js';

export const officesRoutes = Router();

// Get all offices
officesRoutes.get('/', async (req, res) => {
    try {
        const offices = await officeService._getAllOffices();
        res.json(offices);
    } catch (error) {
        console.error('Failed to get offices:', error);
        res.status(500).json({ error: 'Failed to get offices' });
    }
});

// Get a specific office
officesRoutes.get('/:id', async (req, res) => {
    try {
        const office = await officeService._getOffice(req.params.id);
        if (!office) {
            return res.status(404).json({ error: 'Office not found' });
        }
        res.json(office);
    } catch (error) {
        console.error('Failed to get office:', error);
        res.status(500).json({ error: 'Failed to get office' });
    }
});

// Create a new office
officesRoutes.post('/', async (req, res) => {
    try {
        const { name, status, agentIds, leaderId, currentTask, agentConfigs, agentRoles, botChannels } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const office = await officeService._createOffice({
            name,
            status,
            agentIds,
            leaderId,
            currentTask,
            agentConfigs,
            agentRoles,
            botChannels,
        });

        res.status(201).json(office);
    } catch (error) {
        console.error('Failed to create office:', error);
        res.status(500).json({ error: 'Failed to create office' });
    }
});

// Update an office
officesRoutes.put('/:id', async (req, res) => {
    try {
        const { name, status, agentIds, leaderId, currentTask, agentConfigs, agentRoles, botChannels } = req.body;
        const office = await officeService._updateOffice(req.params.id, {
            ...(name !== undefined && { name }),
            ...(status !== undefined && { status }),
            ...(agentIds !== undefined && { agentIds }),
            ...(leaderId !== undefined && { leaderId }),
            ...(currentTask !== undefined && { currentTask }),
            ...(agentConfigs !== undefined && { agentConfigs }),
            ...(agentRoles !== undefined && { agentRoles }),
            ...(botChannels !== undefined && { botChannels }),
        });

        if (!office) {
            return res.status(404).json({ error: 'Office not found' });
        }

        res.json(office);
    } catch (error) {
        console.error('Failed to update office:', error);
        res.status(500).json({ error: 'Failed to update office' });
    }
});

// Delete an office
officesRoutes.delete('/:id', async (req, res) => {
    try {
        const success = await officeService._deleteOffice(req.params.id);
        if (!success) {
            return res.status(404).json({ error: 'Office not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete office:', error);
        res.status(500).json({ error: 'Failed to delete office' });
    }
});

// Close/accept the current task (set status back to loafing)
officesRoutes.post('/:id/close-task', async (req, res) => {
    try {
        const office = await officeService._closeTask(req.params.id);
        if (!office) return res.status(404).json({ error: 'Office not found' });
        res.json(office);
    } catch (error) {
        console.error('Failed to close task:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

// Reject a pending task — keep status busy (office needs to redo the task)
officesRoutes.post('/:id/reject-task', async (req, res) => {
    try {
        const { feedback } = req.body;
        const office = await officeService._getOffice(req.params.id);
        if (!office) return res.status(404).json({ error: 'Office not found' });
        if (office.status !== 'pending') return res.status(400).json({ error: '只能驳回待验收的任务' });

        // Save the rejection feedback as a message
        await officeService._saveOfficeMessage(office.id, {
            agentId: null,
            role: 'user',
            content: `❌ 任务已驳回：${feedback || '不满意结果，请重做'}`,
        });

        // Set status to busy — rejection means redo, office is not idle
        const updated = await officeService._updateOffice(office.id, { status: 'busy' });
        res.json(updated);
    } catch (error) {
        console.error('Failed to reject task:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

// Get office message history
officesRoutes.get('/:id/messages', async (req, res) => {
    try {
        const messages = await officeService._getOfficeMessages(req.params.id);
        res.json(messages);
    } catch (error) {
        console.error('Failed to get office messages:', error);
        res.status(500).json({ error: 'Failed to get office messages' });
    }
});

// Get office memory (task summary, results, etc.)
officesRoutes.get('/:id/memory', async (req, res) => {
    try {
        const memory = await officeService._getOfficeMemory(req.params.id);
        res.json(memory);
    } catch (error) {
        console.error('Failed to get office memory:', error);
        res.status(500).json({ error: 'Failed to get office memory' });
    }
});

// Search office messages
officesRoutes.post('/:id/search', async (req, res) => {
    try {
        const { query, limit = 10, threshold = 0.15 } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        const results = await officeService._searchOfficeMessages(req.params.id, query, limit, threshold);
        res.json(results);
    } catch (error) {
        console.error('Failed to search office messages:', error);
        res.status(500).json({ error: 'Failed to search office messages' });
    }
});

// Search all office messages
officesRoutes.post('/search', async (req, res) => {
    try {
        const { query, limit = 10, threshold = 0.15 } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        const results = await officeService._searchAllOfficeMessages(query, limit, threshold);
        res.json(results);
    } catch (error) {
        console.error('Failed to search all office messages:', error);
        res.status(500).json({ error: 'Failed to search all office messages' });
    }
});

/**
 * POST /api/offices/:id/dispatch-task
 * Body: { task: string, configId?: string }
 *
 * Flow (SSE stream):
 *  1. Leader decomposes the task and assigns sub-tasks to each member
 *  2. Each member executes their sub-task
 *  3. Leader reviews all results; if any fail → member retries (up to 2 rounds)
 *  4. Leader approves → office status set to 'pending'
 */
officesRoutes.post('/:id/dispatch-task', async (req, res) => {
    const { task, configId } = req.body;
    if (!task || !task.trim()) {
        return res.status(400).json({ error: '任务内容不能为空' });
    }

    let office;
    try {
        const dispatched = await officeService._dispatchTask(req.params.id, task.trim());
        office = dispatched.office;
    } catch (error) {
        return res.status(400).json({ error: (error as Error).message });
    }

    // Fetch leader & member agents
    const leaderAgent = agentService.getAgent(office.leaderId!);
    if (!leaderAgent) {
        await officeService._updateOffice(office.id, { status: 'loafing', currentTask: '' });
        return res.status(400).json({ error: '找不到组长 Agent' });
    }

    const memberAgents = office.agentIds
        .filter(id => id !== office.leaderId)
        .map(id => agentService.getAgent(id))
        .filter(Boolean) as ReturnType<typeof agentService.getAgent>[];

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (type: string, payload: object) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    const chat = async (systemPrompt: string, userMessage: string, agentConfigId?: string, currentAgentId?: string): Promise<string> => {
        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userMessage },
        ];

        let result;
        if (currentAgentId) {
            let permissionMode = 'normal';
            let permissionRestrictions: string[] = [];
            let agentToolsConfig: Record<string, any> = {};

            const reqAgent = agentService.getAgent(currentAgentId);
            if (reqAgent) {
                permissionMode = reqAgent.permissionMode || 'normal';
                agentToolsConfig = reqAgent.toolsConfig || {};

                switch (permissionMode) {
                    case 'auto-edit':
                        permissionRestrictions = [
                            '【自动编辑模式】你可以自由读取和编辑文件。',
                            '执行命令前必须询问用户确认。',
                            '危险操作（删除文件、系统命令）需要用户确认。',
                        ];
                        break;
                    case 'full-auto':
                        permissionRestrictions = [
                            '【全自动模式】你可以执行任何操作，无需询问。',
                            '请谨慎操作，避免不可逆的危险操作。',
                        ];
                        break;
                    default:
                        permissionRestrictions = [
                            '【普通模式】你可以自由读取文件。',
                            '编辑文件或执行命令前必须询问用户确认。',
                        ];
                }
            }

            let finalSystemPrompt = systemPrompt;

            if (permissionRestrictions.length > 0) {
                finalSystemPrompt += '\n\n## 权限限制\n' + permissionRestrictions.join('\n');
            }

            let injectedTools: any[] | undefined = undefined;
            const allowedToolNames = new Set<string>();

            if (reqAgent) {
                injectedTools = [];
                const isCustom = permissionMode === 'custom';

                if (isCustom ? agentToolsConfig.read_file : true) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'read_file'));
                    allowedToolNames.add('read_file');
                }
                if (isCustom ? agentToolsConfig.write_file : (permissionMode === 'auto-edit' || permissionMode === 'full-auto')) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'write_file'));
                    allowedToolNames.add('write_file');
                }
                if (isCustom ? agentToolsConfig.edit_file : (permissionMode === 'auto-edit' || permissionMode === 'full-auto')) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'edit_file'));
                    allowedToolNames.add('edit_file');
                }
                if (isCustom ? agentToolsConfig.delete_file : (permissionMode === 'auto-edit' || permissionMode === 'full-auto')) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'delete_file'));
                    allowedToolNames.add('delete_file');
                }
                if (isCustom ? agentToolsConfig.plan_and_execute : true) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'plan_and_execute'));
                    allowedToolNames.add('plan_and_execute');
                }
                if (isCustom ? agentToolsConfig.exec_cmd : permissionMode === 'full-auto') {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'exec_cmd'));
                    allowedToolNames.add('exec_cmd');
                }
                if (isCustom ? agentToolsConfig.manage_process : permissionMode === 'full-auto') {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'manage_process'));
                    allowedToolNames.add('manage_process');
                }
                if (isCustom ? agentToolsConfig.web_search : true) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'web_search'));
                    allowedToolNames.add('web_search');
                }
                if (isCustom ? agentToolsConfig.web_fetch : true) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'web_fetch'));
                    allowedToolNames.add('web_fetch');
                }
                if (isCustom ? agentToolsConfig.browser_open : (permissionMode === 'normal' || permissionMode === 'auto-edit' || permissionMode === 'full-auto')) {
                    const { AgentTools } = await import('../services/tools.js');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_open'));
                    allowedToolNames.add('browser_open');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_click'));
                    allowedToolNames.add('browser_click');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_type'));
                    allowedToolNames.add('browser_type');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_press_key'));
                    allowedToolNames.add('browser_press_key');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_refresh'));
                    allowedToolNames.add('browser_refresh');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_screenshot'));
                    allowedToolNames.add('browser_screenshot');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_scroll'));
                    allowedToolNames.add('browser_scroll');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_wait'));
                    allowedToolNames.add('browser_wait');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_select'));
                    allowedToolNames.add('browser_select');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_hover'));
                    allowedToolNames.add('browser_hover');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_go_back'));
                    allowedToolNames.add('browser_go_back');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_go_forward'));
                    allowedToolNames.add('browser_go_forward');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_close_tab'));
                    allowedToolNames.add('browser_close_tab');
                    injectedTools.push(AgentTools.find(t => t.function.name === 'browser_eval_js'));
                    allowedToolNames.add('browser_eval_js');
                }

                const { skillEngine } = await import('../services/skill-engine.js');
                const selectedSkillIds: string[] = Array.isArray(agentToolsConfig.selected_skills) ? agentToolsConfig.selected_skills : [];
                const shouldInjectAllSkills = permissionMode === 'full-auto';
                const shouldInjectSkills = shouldInjectAllSkills || (selectedSkillIds.length > 0);
                if (shouldInjectSkills) {
                    for (const skill of skillEngine.getEnabledSkills()) {
                        if (!shouldInjectAllSkills && !selectedSkillIds.includes(skill.id)) continue;
                        for (const action of skill.actions) {
                            if (action.type !== 'llm') {
                                const params: Record<string, any> = { type: 'object', properties: {}, required: [] };
                                if (action.parameters) {
                                    for (const p of action.parameters) {
                                        params.properties[p.name] = { type: p.type, description: p.description };
                                        if (p.required) params.required.push(p.name);
                                    }
                                }
                                const toolName = `skill_${skill.id}_${action.id}`.replace(/-/g, '_');
                                injectedTools.push({
                                    type: 'function',
                                    function: {
                                        name: toolName,
                                        description: `${skill.name} - ${action.name}: ${action.description}`,
                                        parameters: params
                                    }
                                });
                                allowedToolNames.add(toolName);
                            }
                        }
                    }
                }

                const { mcpService } = await import('../services/mcp-service.js');
                const selectedMCPIds: string[] = Array.isArray(agentToolsConfig.selected_mcp) ? agentToolsConfig.selected_mcp : [];
                const shouldInjectAllMCP = permissionMode === 'full-auto';
                const shouldInjectMCP = shouldInjectAllMCP || (selectedMCPIds.length > 0);
                if (shouldInjectMCP) {
                    for (const server of mcpService.getEnabledServers()) {
                        if (!shouldInjectAllMCP && !selectedMCPIds.includes(server.id)) continue;
                        const tools = mcpService.getAllTools().get(server.id) || [];
                        for (const mT of tools) {
                            const toolName = `mcp_${server.id}_${mT.name}`.replace(/-/g, '_');
                            injectedTools.push({
                                type: 'function',
                                function: {
                                    name: toolName,
                                    description: `[MCP: ${server.name}] ${mT.description}`,
                                    parameters: mT.inputSchema
                                }
                            });
                            allowedToolNames.add(toolName);
                        }
                    }
                }

                injectedTools = injectedTools.filter(t => t !== undefined);
                if (injectedTools.length === 0) injectedTools = undefined;
            }

            const messagesWithSystem = [
                { role: 'system' as const, content: finalSystemPrompt },
                ...messages.filter(m => m.role !== 'system')
            ];

            result = await modelsManager.chat({
                messages: messagesWithSystem,
                tools: injectedTools,
                tool_choice: injectedTools && injectedTools.length > 0 ? 'auto' : undefined
            }, agentConfigId || configId);
        } else {
            result = await modelsManager.chat({ messages }, agentConfigId || configId);
        }

        return result.content || '';
    };

    try {
        // Save user task message to chat
        await officeService._saveOfficeMessage(office.id, {
            agentId: null,
            role: 'user',
            content: `📋 下发任务：${task}`,
        });

        // ── Step 1: Leader decomposes task ──────────────────────────────
        send('status', { step: 'decompose', message: `🧠 组长「${leaderAgent.name}」正在分解任务...` });

        const memberList = memberAgents.length > 0
            ? memberAgents.map((a, i) => `${i + 1}. ${a!.name}`).join('\n')
            : '（暂无其他组员，请独立完成）';

        const leaderConfigId = office.agentConfigs?.[office.leaderId!]?.configId || configId;
        const decompositionPrompt = leaderAgent.systemPrompt || '你是一位高效的项目组长。';
        const decompositionRequest = `你是「${leaderAgent.name}」，担任此办公室的组长。\n\n当前任务：\n${task}\n\n团队成员：\n${memberList}\n\n请将任务分解，为每位成员（或你自己）分配一个具体子任务。以如下JSON格式回复（只回复JSON，不要加markdown代码块）：\n{\n  "plan": "整体计划简述",\n  "assignments": [\n    { "member": "成员名称", "subtask": "子任务描述" }\n  ]\n}`;

        const decompositionRaw = await chat(decompositionPrompt, decompositionRequest, leaderConfigId, leaderAgent.id);

        let assignments: Array<{ member: string; subtask: string }> = [];
        let plan = '';
        try {
            const parsed = JSON.parse(decompositionRaw.replace(/```json|```/g, '').trim());
            assignments = parsed.assignments || [];
            plan = parsed.plan || '';
        } catch {
            // Fallback: assign whole task to leader
            assignments = [{ member: leaderAgent.name, subtask: task }];
            plan = '（任务分解解析失败，由组长独立处理）';
        }

        // Save leader's plan and assignments to chat
        const assignmentLines = assignments.map(a => `  → @${a.member}：${a.subtask}`).join('\n');
        await officeService._saveOfficeMessage(office.id, {
            agentId: office.leaderId!,
            role: 'assistant',
            content: `🧠 **任务分解计划**\n${plan}\n\n**任务分配：**\n${assignmentLines}`,
        });

        send('decomposed', { plan, assignments });

        // ── Step 2: Each member executes their sub-task (up to 2 retries) ──
        const results: Array<{ member: string; subtask: string; result: string; approved: boolean }> = [];

        for (const assignment of assignments) {
            const memberAgent = [leaderAgent, ...memberAgents].find(a => a!.name === assignment.member) || leaderAgent;
            send('status', { step: 'member_working', message: `⚙️ 「${memberAgent!.name}」正在执行：${assignment.subtask}` });

            const memberConfigId = office.agentConfigs?.[memberAgent!.id]?.configId || configId;
            let memberResult = '';
            let approved = false;

            for (let attempt = 1; attempt <= 2; attempt++) {
                const memberSystemPrompt = memberAgent!.systemPrompt || '你是一名AI助手。';
                const memberRequest = attempt === 1
                    ? `你是「${memberAgent!.name}」。\n\n你的子任务是：\n${assignment.subtask}\n\n请完成此任务并汇报详细成果。`
                    : `你是「${memberAgent!.name}」。\n\n你上次提交的成果未获组长审核通过，反馈如下：\n${memberResult}\n\n请修改并重新提交成果。`;

                memberResult = await chat(memberSystemPrompt, memberRequest, memberConfigId, memberAgent.id);
                send('member_result', { member: memberAgent!.name, subtask: assignment.subtask, result: memberResult, attempt });

                // Save member result to chat
                await officeService._saveOfficeMessage(office.id, {
                    agentId: memberAgent!.id,
                    role: 'assistant',
                    content: `⚙️ 已完成子任务「${assignment.subtask}」(第${attempt}次)：\n\n${memberResult}`,
                });

                // ── Step 3: Leader reviews this member's result ──────────
                send('status', { step: 'review', message: `🔍 组长「${leaderAgent.name}」正在审核「${memberAgent!.name}」的成果...` });

                const reviewRequest = `你是「${leaderAgent.name}」，担任组长。\n\n子任务：${assignment.subtask}\n\n成员「${memberAgent!.name}」提交的成果：\n${memberResult}\n\n请判断成果是否合格。只回复如下JSON格式（不要加markdown代码块）：\n{ "approved": true/false, "feedback": "反馈意见" }`;
                const reviewRaw = await chat(decompositionPrompt, reviewRequest, leaderConfigId, leaderAgent.id);

                let reviewApproved = true;
                let reviewFeedback = '';
                try {
                    const reviewParsed = JSON.parse(reviewRaw.replace(/```json|```/g, '').trim());
                    reviewApproved = reviewParsed.approved !== false;
                    reviewFeedback = reviewParsed.feedback || '';
                } catch {
                    reviewApproved = true;
                }

                // Save review to chat
                await officeService._saveOfficeMessage(office.id, {
                    agentId: office.leaderId!,
                    role: 'assistant',
                    content: reviewApproved
                        ? `✅ @${memberAgent!.name} 审核通过：${reviewFeedback || '成果合格'}`
                        : `🔄 @${memberAgent!.name} 需要修改：${reviewFeedback}`,
                });

                send('review_result', { member: memberAgent!.name, approved: reviewApproved, feedback: reviewFeedback, attempt });

                if (reviewApproved) {
                    approved = true;
                    break;
                } else {
                    // Pass feedback as next attempt's context
                    memberResult = reviewFeedback;
                }
            }

            results.push({ member: memberAgent!.name, subtask: assignment.subtask, result: memberResult, approved });
        }

        // ── Step 4: Leader produces final summary ──────────────────────
        send('status', { step: 'summary', message: `📝 组长「${leaderAgent.name}」正在汇总最终报告...` });

        const summaryRequest = `你是「${leaderAgent.name}」，担任组长。\n\n原始任务：${task}\n\n各成员完成情况：\n${results.map(r => `• ${r.member}：${r.subtask}\n  成果：${r.result.slice(0, 300)}...`).join('\n\n')}\n\n请撰写一份完整的任务总结报告，并说明本次任务已全部完成，等待验收。`;
        const finalSummary = await chat(decompositionPrompt, summaryRequest, leaderConfigId, leaderAgent.id);

        // Save final summary to chat
        await officeService._saveOfficeMessage(office.id, {
            agentId: office.leaderId!,
            role: 'assistant',
            content: `📝 **任务总结报告**\n\n${finalSummary}`,
        });

        // ── Step 5: Set office to pending, save results ─────────────────
        await officeService._markPending(office.id);
        // Store summary and results for review
        await officeService._updateOfficeMemory(office.id, {
            taskSummary: finalSummary,
            taskResults: results,
            taskCompletedAt: Date.now(),
        });

        send('done', {
            message: '✅ 所有子任务已完成，办公室状态已更新为「待验收」',
            summary: finalSummary,
            results,
        });

        res.end();
    } catch (error) {
        console.error('[OfficeDispatch] Error:', error);
        // Restore office status on failure
        await officeService._updateOffice(office.id, { status: 'loafing', currentTask: '' });
        send('error', { message: (error as Error).message });
        res.end();
    }
});

// SSE Streaming Chat for Office
officesRoutes.post('/:id/chat', async (req, res) => {
    const { id: officeId } = req.params;
    const { agentId, content, attachments } = req.body;

    if (!content) return res.status(400).json({ error: 'Content is required' });

    try {
        const office = await officeService._getOffice(officeId);
        if (!office) return res.status(404).json({ error: 'Office not found' });

        const targetAgent = agentService.getAgent(agentId);
        if (!targetAgent) return res.status(404).json({ error: 'Agent not found' });

        // 1. Save User Message
        await officeService._saveOfficeMessage(officeId, {
            agentId: null,
            role: 'user',
            content,
            attachments
        });

        // 2. Build Office Context Prompt
        const isLeader = office.leaderId === agentId;
        const leaderName = office.leaderId ? (agentService.getAgent(office.leaderId)?.name || '未知') : '未指定';
        const memberNames = office.agentIds.map(id => agentService.getAgent(id)?.name).filter(Boolean).join(', ');

        const sharedMemory = await officeService._getOfficeMemory(officeId);
        const memoryContext = Object.keys(sharedMemory).length > 0
            ? `\n\n## 共享办公室记忆\n${JSON.stringify(sharedMemory, null, 2)}`
            : '';

        const roleInstructions = isLeader
            ? `你是本办公室的【组长】(Leader)。你负责统筹规划、分配任务给其他成员(${memberNames})，并审核他们的成果。你可以使用 @成员名 来明确分配工作。`
            : `你是本办公室的【成员】(Member)。你的组长是「${leaderName}」。你需要遵从组长的指示，配合团队工作。`;

        const officePrompt = `
# 办公室环境上下文
当前办公室：「${office.name}」
你的角色：${isLeader ? '组长' : '组员'}
团队成员：${memberNames}
组长：${leaderName}

${roleInstructions}

你与其他成员共享记忆和对话历史。请保持协作意识，并在对话中展现出你的身份定位。${memoryContext}
`;

        // 3. Prepare Chat
        const history = await officeService._getOfficeMessages(officeId);
        const messages = [
            { role: 'system' as const, content: (targetAgent.systemPrompt || '') + officePrompt },
            ...history.map(m => ({ role: m.role, content: m.content }))
        ];

        // 4. SSE Setup
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        // 5. Execute Chat & Stream
        const configId = office.agentConfigs?.[agentId]?.configId;
        let fullContent = '';

        const streamRes: any = await modelsManager.chat({
            messages,
            stream: true
        }, configId as string);

        if (streamRes.stream) {
            for await (const chunk of streamRes.stream as any) {
                const text = chunk.choices?.[0]?.delta?.content || '';
                if (text) {
                    fullContent += text;
                    res.write(`data: ${JSON.stringify({ type: 'chunk', delta: text })}\n\n`);
                }
            }
            res.write('data: [DONE]\n\n');
        } else {
            fullContent = streamRes.content || '';
            res.write(`data: ${JSON.stringify({ type: 'chunk', delta: fullContent })}\n\n`);
            res.write('data: [DONE]\n\n');
        }

        // 6. Save Assistant Message
        if (fullContent) {
            await officeService._saveOfficeMessage(officeId, {
                agentId,
                role: 'assistant',
                content: fullContent
            });

            // Auto-update memory if the agent mentions "记忆：" or "记点东西："
            if (fullContent.includes('记忆：') || fullContent.includes('记点东西：')) {
                const memoryMatch = fullContent.match(/(记忆|记点东西)[：:](.+)/);
                if (memoryMatch) {
                    await officeService._updateOfficeMemory(officeId, {
                        [`note_${Date.now()}`]: memoryMatch[2].trim()
                    });
                }
            }
        }

        res.end();

    } catch (error) {
        console.error('Office chat error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: (error as Error).message })}\n\n`);
        res.end();
    }
});
