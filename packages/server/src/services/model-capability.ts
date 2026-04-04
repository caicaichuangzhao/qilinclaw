/**
 * Model Function-Calling Capability Detection
 * 
 * Different LLMs have varying levels of reliability when it comes to
 * tool/function calling. This module detects the capability tier and
 * provides appropriate constraints for less capable models.
 * 
 * Inspired by Claude Code's approach: Claude models are natively reliable
 * at function calling, but QilinClaw supports many providers, so we need
 * code-level defenses for weaker models.
 */

export type FCTier = 'native' | 'capable' | 'weak';

/**
 * Model name patterns → FC capability tier.
 * 
 * - native:  Nearly never "pretends" to execute. FC is reliable.
 * - capable: Occasionally skips FC. Needs gentle reminders.
 * - weak:    Frequently describes actions in text instead of calling tools.
 */
const TIER_RULES: Array<[RegExp, FCTier]> = [
    // Native: well-trained on function calling, rarely hallucinates execution
    [/claude|gpt-4o|gpt-4-turbo|gpt-4(?!-)/i, 'native'],

    // Capable: supports FC but occasionally skips it
    [/deepseek|qwen|glm|gemini|gpt-3\.5|gpt-4o-mini|chatglm/i, 'capable'],

    // Weak: frequently describes actions in text instead of using FC
    [/llama|mistral|phi|yi-|vicuna|ollama|codellama|wizardlm|solar/i, 'weak'],
];

/**
 * Detect the function-calling capability tier of a model by name.
 */
export function detectFCTier(modelName: string): FCTier {
    const lower = modelName.toLowerCase();
    for (const [pattern, tier] of TIER_RULES) {
        if (pattern.test(lower)) return tier;
    }
    // Default to 'capable' — apply moderate constraints
    return 'capable';
}

/**
 * Get extra system prompt constraint text for the given FC tier.
 * - 'native' models get no extra text (they don't need it).
 * - 'capable' models get a brief reminder about audit.
 * - 'weak' models get aggressive instructions to use FC exclusively.
 */
export function getExtraConstraint(tier: FCTier): string {
    if (tier === 'native') return '';

    if (tier === 'capable') {
        return `\n[系统约束] 你的回复将被系统自动审计。如果你声称完成了操作但没有发起 tool function call，回复将被自动拦截并要求重新执行。请务必使用标准的 function call 格式调用工具。\n`;
    }

    // weak
    return `\n[⚠️ 系统强制约束]
1. 你的每一句含有"已完成"意思的回复都会被代码自动扫描。
2. 如果扫描发现你没有真正调用工具 function call，系统会立刻拦截你的回复并要求重做。
3. 正确做法：直接发起 tool function call，不要在文本中描述操作过程。
4. 错误做法：在回复中写"我已经帮你创建了文件" — 这会被自动拦截。
请直接使用工具 function call，不要在文字中描述你要做什么或已经做了什么。\n`;
}
