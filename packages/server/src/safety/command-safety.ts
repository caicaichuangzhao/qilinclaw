/**
 * Command Safety Filter
 * 
 * Provides two layers of protection:
 * 1. INPUT:  Block dangerous commands before execution (rm -rf, privilege escalation, etc.)
 * 2. OUTPUT: Sanitize command output to redact sensitive info (IPs, ports, tokens, etc.)
 */

// ═══════════════════════════════════════════════════════════════════════
// Layer 1: Dangerous Command Detection (INPUT)
// ═══════════════════════════════════════════════════════════════════════

interface DangerousPattern {
    pattern: RegExp;
    category: string;
    description: string;
}

const DANGEROUS_COMMAND_PATTERNS: DangerousPattern[] = [
    // ── 破坏性文件/磁盘操作 ──
    { pattern: /rm\s+-[^\s]*r[^\s]*\s+\//i, category: '破坏性操作', description: '递归删除根目录文件 (rm -rf /)' },
    { pattern: /rm\s+-[^\s]*r[^\s]*\s+[A-Z]:\\/i, category: '破坏性操作', description: '递归删除整个磁盘 (rm -rf C:\\)' },
    { pattern: /del\s+\/[sq]\s+[A-Z]:\\/i, category: '破坏性操作', description: 'Windows 全盘删除 (del /s /q C:\\)' },
    { pattern: /rd\s+\/s\s+\/q\s+[A-Z]:\\/i, category: '破坏性操作', description: 'Windows 全盘删除 (rd /s /q C:\\)' },
    { pattern: /format\s+[A-Z]:/i, category: '破坏性操作', description: '格式化磁盘 (format C:)' },
    { pattern: /mkfs/i, category: '破坏性操作', description: '格式化文件系统 (mkfs)' },
    { pattern: /dd\s+if=.*of=\/dev\//i, category: '破坏性操作', description: '覆写磁盘设备 (dd to /dev/)' },
    { pattern: />\s*\/dev\/sd[a-z]/i, category: '破坏性操作', description: '重定向覆写磁盘块设备' },
    { pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/i, category: '破坏性操作', description: 'Fork 炸弹' },

    // ── 提权操作（仅拦截 Linux 系统级配置修改，sudo/su 需要密码所以不拦截） ──
    { pattern: /\bchmod\s+[0-7]*[4567][0-7]{2}\s+\/etc/i, category: '提权操作', description: '修改系统配置文件权限' },
    { pattern: /\bchown\s+root/i, category: '提权操作', description: '将文件所有权转给 root' },
    { pattern: /\busermod\b/i, category: '提权操作', description: '尝试修改用户账户' },
    { pattern: /\buseradd\b/i, category: '提权操作', description: '尝试创建用户账户' },
    { pattern: /\bvisudo\b/i, category: '提权操作', description: '尝试编辑 sudoers 配置' },
    { pattern: /net\s+user\s+.*\/add/i, category: '提权操作', description: 'Windows 创建用户账户' },
    { pattern: /net\s+localgroup\s+administrators/i, category: '提权操作', description: 'Windows 添加管理员权限' },

    // ── 网络信息泄露 ──
    { pattern: /\bipconfig\b/i, category: '信息泄露', description: '获取网络配置信息 (ipconfig)' },
    { pattern: /\bifconfig\b/i, category: '信息泄露', description: '获取网络配置信息 (ifconfig)' },
    { pattern: /\bip\s+addr\b/i, category: '信息泄露', description: '获取 IP 地址信息 (ip addr)' },
    { pattern: /\bip\s+a\b/i, category: '信息泄露', description: '获取 IP 地址信息 (ip a)' },
    { pattern: /\bhostname\s+-[iI]\b/i, category: '信息泄露', description: '获取主机 IP 地址 (hostname -I)' },
    { pattern: /\bnetstat\b/i, category: '信息泄露', description: '获取端口和连接信息 (netstat)' },
    { pattern: /\bss\s+-[^\s]*[tlnp]/i, category: '信息泄露', description: '获取端口监听信息 (ss)' },
    { pattern: /\bnmap\b/i, category: '信息泄露', description: '网络端口扫描 (nmap)' },
    { pattern: /\barp\s+-a\b/i, category: '信息泄露', description: '获取 ARP 表 (arp -a)' },
    { pattern: /\broute\b.*\bprint\b/i, category: '信息泄露', description: '获取路由表' },
    { pattern: /\btraceroute\b/i, category: '信息泄露', description: '追踪网络路由 (traceroute)' },
    { pattern: /\btracert\b/i, category: '信息泄露', description: '追踪网络路由 (tracert)' },
    { pattern: /curl\s+.*ifconfig\.me/i, category: '信息泄露', description: '获取公网 IP 地址' },
    { pattern: /curl\s+.*ip\.sb/i, category: '信息泄露', description: '获取公网 IP 地址' },
    { pattern: /curl\s+.*ipinfo\.io/i, category: '信息泄露', description: '获取公网 IP 和地理位置' },
    { pattern: /curl\s+.*icanhazip/i, category: '信息泄露', description: '获取公网 IP 地址' },
    { pattern: /\bwhoami\b/i, category: '信息泄露', description: '获取当前用户名' },
    { pattern: /cat\s+\/etc\/passwd/i, category: '信息泄露', description: '读取系统用户列表' },
    { pattern: /cat\s+\/etc\/shadow/i, category: '信息泄露', description: '读取系统密码哈希' },
    { pattern: /cat\s+\/etc\/hosts/i, category: '信息泄露', description: '读取 hosts 文件' },
    { pattern: /type\s+.*\\system32\\/i, category: '信息泄露', description: '读取 Windows 系统文件' },
    { pattern: /reg\s+query/i, category: '信息泄露', description: '查询 Windows 注册表' },
    { pattern: /systeminfo/i, category: '信息泄露', description: '获取完整系统信息 (systeminfo)' },
    { pattern: /\benv\b\s*$/im, category: '信息泄露', description: '列出所有环境变量' },
    { pattern: /printenv/i, category: '信息泄露', description: '列出所有环境变量' },
    { pattern: /\bset\b\s*$/im, category: '信息泄露', description: '列出所有环境变量 (Windows)' },
    { pattern: /echo\s+\$\w*(KEY|TOKEN|SECRET|PASSWORD|PASS|API|CREDENTIAL)/i, category: '信息泄露', description: '输出敏感环境变量' },
    { pattern: /echo\s+%\w*(KEY|TOKEN|SECRET|PASSWORD|PASS|API|CREDENTIAL)%/i, category: '信息泄露', description: '输出敏感环境变量 (Windows)' },

    // ── 反弹 Shell / 远程执行 ──
    { pattern: /\/dev\/tcp\//i, category: '远程攻击', description: '反向 Shell (/dev/tcp/)' },
    { pattern: /\bnc\s+-[^\s]*e/i, category: '远程攻击', description: 'Netcat 反弹 Shell (nc -e)' },
    { pattern: /curl\s+.*\|\s*(bash|sh|powershell|cmd)/i, category: '远程攻击', description: '远程代码执行 (curl | bash)' },
    { pattern: /wget\s+.*-O-?\s*\|\s*(bash|sh)/i, category: '远程攻击', description: '远程代码执行 (wget | bash)' },
    { pattern: /powershell\s+.*-enc/i, category: '远程攻击', description: 'PowerShell 编码执行' },
    { pattern: /powershell\s+.*downloadstring/i, category: '远程攻击', description: 'PowerShell 远程下载执行' },
    { pattern: /powershell\s+.*invoke-webrequest/i, category: '远程攻击', description: 'PowerShell 远程下载' },

    // ── 系统服务篡改 ──
    { pattern: /\bsystemctl\s+(stop|disable|mask)\b/i, category: '系统篡改', description: '停用系统服务 (systemctl)' },
    { pattern: /\bservice\s+\w+\s+stop\b/i, category: '系统篡改', description: '停止系统服务 (service stop)' },
    { pattern: /net\s+stop\b/i, category: '系统篡改', description: 'Windows 停止服务 (net stop)' },
    { pattern: /\biptables\b/i, category: '系统篡改', description: '修改防火墙规则 (iptables)' },
    { pattern: /netsh\s+firewall/i, category: '系统篡改', description: '修改 Windows 防火墙 (netsh)' },
    { pattern: /netsh\s+advfirewall/i, category: '系统篡改', description: '修改 Windows 防火墙 (netsh advfirewall)' },
    { pattern: /\bshutdown\b/i, category: '系统篡改', description: '关机/重启系统' },
    { pattern: /\breboot\b/i, category: '系统篡改', description: '重启系统' },
    { pattern: /\binit\s+[06]\b/i, category: '系统篡改', description: '关机/重启系统 (init)' },
    { pattern: /\bkill\s+-9\s+1\b/i, category: '系统篡改', description: '杀死 init/PID 1 进程' },
    { pattern: /taskkill\s+.*\/im\s+.*svchost/i, category: '系统篡改', description: '杀死 Windows 关键进程' },
    { pattern: /taskkill\s+.*\/im\s+.*csrss/i, category: '系统篡改', description: '杀死 Windows 关键进程' },
    { pattern: /taskkill\s+.*\/im\s+.*lsass/i, category: '系统篡改', description: '杀死 Windows 安全进程' },
    { pattern: /\bcrontab\s+-r\b/i, category: '系统篡改', description: '清空所有定时任务 (crontab -r)' },
    { pattern: /\bschtasks\s+.*\/delete/i, category: '系统篡改', description: '删除 Windows 计划任务' },
];

/**
 * Check if a command is dangerous.
 * Returns null if safe, or a rejection message if dangerous.
 */
export function checkCommandSafety(command: string): { blocked: boolean; category?: string; description?: string } {
    for (const entry of DANGEROUS_COMMAND_PATTERNS) {
        if (entry.pattern.test(command)) {
            return {
                blocked: true,
                category: entry.category,
                description: entry.description,
            };
        }
    }
    return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════════════
// Layer 2: Output Sanitization (OUTPUT)
// ═══════════════════════════════════════════════════════════════════════

const SENSITIVE_OUTPUT_PATTERNS: { pattern: RegExp; replacement: string; label: string }[] = [
    // IPv4 addresses (but preserve localhost-class 127.x.x.x and 0.0.0.0)
    { pattern: /\b(?!127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?!0\.0\.0\.0)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, replacement: '[IP已隐藏]', label: 'IPv4 地址' },
    // IPv6 addresses
    { pattern: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g, replacement: '[IPv6已隐藏]', label: 'IPv6 地址' },
    // Port numbers in common formats like :8080, :3000, port 22, etc.
    { pattern: /(?<=[:]\s?)(?:(?!65001)\d{2,5})(?=\s|$|\/)/gm, replacement: '[端口已隐藏]', label: '端口号' },
    // API keys / tokens (long hex or base64 strings that look like secrets)
    { pattern: /(?:api[_-]?key|token|secret|password|passwd|credential|auth)[=:]\s*['"]?([^\s'"]{8,})/gi, replacement: '$1=[凭证已隐藏]', label: '凭证/密钥' },
    // MAC addresses
    { pattern: /([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/g, replacement: '[MAC已隐藏]', label: 'MAC 地址' },
];

/**
 * Sanitize command output to redact sensitive information.
 * Only applied when sandbox mode is enabled (not in full-trust mode).
 */
export function sanitizeCommandOutput(output: string): string {
    let sanitized = output;
    for (const entry of SENSITIVE_OUTPUT_PATTERNS) {
        sanitized = sanitized.replace(entry.pattern, entry.replacement);
    }
    return sanitized;
}

/**
 * Format a blocked command result message.
 */
export function formatBlockedMessage(category: string, description: string, command: string): string {
    return `🛑 [安全拦截] 命令已被阻止执行\n` +
        `分类: ${category}\n` +
        `原因: ${description}\n` +
        `命令: ${command.substring(0, 80)}${command.length > 80 ? '...' : ''}\n\n` +
        `如果你确实需要执行此操作，请将命令告知用户，由用户在终端中手动执行。`;
}
