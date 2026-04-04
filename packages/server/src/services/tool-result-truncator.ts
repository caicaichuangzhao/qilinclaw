/**
 * tool-result-truncator.ts
 * 
 * QilinClaw 工具结果智能截断服务 (Micro-Compact)
 * 
 * 灵感来源：BCGJ 的 microCompact 模块，但针对 QilinClaw 的工具体系
 * 做了完全自主的设计与实现。
 * 
 * 核心理念：工具返回的大块数据（如 grep 上千行、大文件读取）是上下文窗口
 * 最大的隐形杀手。本模块在工具执行完毕后立即截断过大的返回值，
 * 保留头尾的有效信息，中间用摘要占位符替代。
 * 
 * 设计原则：
 * 1. 纯函数，无副作用，完全可测试
 * 2. 保留头部（通常含关键状态码/摘要）和尾部（通常含最终结论/错误）
 * 3. 对不同工具类型有针对性的截断策略
 * 4. 截断提示本身要有指导意义（告诉模型如何获取完整数据）
 */

// ── 配置常量 ──

/** 工具结果的最大字符数上限。超过此值将被截断。 */
const DEFAULT_MAX_CHARS = 20_000;

/** 截断时头部保留的字符比例 */
const HEAD_RATIO = 0.6;

/** 截断时尾部保留的字符比例 */
const TAIL_RATIO = 0.35;

// 留 5% 给截断提示本身

/** 特定工具的自定义限制（某些工具需要更宽松/严格的阈值） */
const TOOL_SPECIFIC_LIMITS: Record<string, number> = {
  // 命令执行输出通常巨量且含大量噪声
  exec_cmd: 15_000,
  // 网页抓取包含大量 HTML/文本，给它多一些空间
  web_fetch: 25_000,
  // 文件读取保持默认
  read_file: 20_000,
  // 搜索结果一般结构化良好，可以少一些
  web_search: 12_000,
};

// ── 截断提示模板（面向 LLM 的指导性输出） ──

/**
 * 生成截断占位符文本。
 * 这段文字是给 LLM 看的，要让它明白发生了什么以及如何获取完整数据。
 */
function buildTruncationNotice(
  toolName: string,
  originalLength: number,
  truncatedChars: number,
): string {
  // 根据工具类型给出不同的恢复建议
  let recoveryHint: string;

  if (toolName === 'exec_cmd') {
    recoveryHint = '如需查看完整输出，请使用更精确的命令（如添加 grep 过滤、head/tail 限制行数，或将输出重定向到文件后用 read_file 分段读取）。';
  } else if (toolName === 'read_file') {
    recoveryHint = '如需查看完整文件，请使用 read_file 工具并指定 startLine/endLine 参数分段读取。';
  } else if (toolName === 'web_fetch') {
    recoveryHint = '如需获取完整内容，请尝试使用 web_search 先定位关键段落，或使用 browser_open 在浏览器中交互式查看。';
  } else if (toolName === 'web_search') {
    recoveryHint = '搜索结果已截断。如需更多结果，请使用更精确的搜索关键词或限定搜索范围。';
  } else {
    recoveryHint = '如需完整数据，请使用更精确的参数重新调用该工具。';
  }

  return [
    '',
    `═══════ [系统截断] ═══════`,
    `原始输出 ${originalLength.toLocaleString()} 字符，已截断中间 ${truncatedChars.toLocaleString()} 字符。`,
    `${recoveryHint}`,
    `═══════════════════════`,
    '',
  ].join('\n');
}

// ── 核心截断函数 ──

/**
 * 对工具返回结果进行智能截断。
 * 
 * 如果结果长度在限制内，原样返回（零开销 fast-path）。
 * 如果超出限制，保留头部和尾部，用截断提示替换中间部分。
 * 
 * @param toolName - 工具名称，用于选择策略和生成恢复建议
 * @param result - 工具执行返回的原始字符串结果
 * @param maxChars - 可选的自定义最大字符数（覆盖默认值）
 * @returns 截断后的结果字符串（如果未超限则为原字符串）
 */
export function truncateToolResult(
  toolName: string,
  result: string,
  maxChars?: number,
): string {
  // 确定此工具的字符上限
  const limit = maxChars ?? TOOL_SPECIFIC_LIMITS[toolName] ?? DEFAULT_MAX_CHARS;

  // Fast path：大部分工具返回值不会超限
  if (result.length <= limit) {
    return result;
  }

  // 计算头尾保留字符数
  const headChars = Math.floor(limit * HEAD_RATIO);
  const tailChars = Math.floor(limit * TAIL_RATIO);
  const truncatedChars = result.length - headChars - tailChars;

  // 提取头部和尾部
  const head = result.slice(0, headChars);
  const tail = result.slice(-tailChars);

  // 组装截断结果
  const notice = buildTruncationNotice(toolName, result.length, truncatedChars);

  return head + notice + tail;
}

/**
 * 检查结果是否被截断过（用于日志和调试）。
 */
export function wasResultTruncated(result: string): boolean {
  return result.includes('═══════ [系统截断] ═══════');
}

/**
 * 估算字符串的 Token 数（粗略估算，用于预算检查）。
 * 
 * 使用经验值：中英文混合内容约 3~4 字符/token。
 * 纯中文约 1.5~2 字符/token，纯英文/代码约 4~5 字符/token。
 * 取中间值 3.5 作为通用系数。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 简单统计中文字符比例来动态调整估算系数
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.length;
  const chineseRatio = totalChars > 0 ? chineseChars / totalChars : 0;

  // 中文比例越高，每 token 覆盖的字符越少
  const charsPerToken = 2 + (1 - chineseRatio) * 2.5;  // 范围: 2 (纯中文) ~ 4.5 (纯英文)

  return Math.ceil(totalChars / charsPerToken);
}
