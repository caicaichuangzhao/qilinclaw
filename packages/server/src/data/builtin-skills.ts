import { Skill } from '../types/skills';

export function getBuiltInSkills(): Skill[] {
  return [
    createShellSkill(),
    createFileSkill(),
    createWebSearchSkill(),
    createCodeReviewSkill(),
    createTranslateSkill(),
    createSummarizeSkill(),
    createExplainSkill(),
    createSendMessageSkill(),
    createBrowserSkill(),
    createCliAnythingSkill(),
    createScreenshotSkill(),
  ];
}

function createShellSkill(): Skill {
  return {
    id: 'skill-shell',
    name: '终端执行',
    description: '执行终端命令，管理系统和文件',
    longDescription: '强大的终端命令执行能力，可以运行脚本、管理文件、控制系统。支持在指定目录下执行命令，确保安全操作。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['执行命令', 'run command', 'shell', '终端'],
    },
    actions: [
      {
        id: 'shell-exec',
        type: 'shell',
        name: '执行命令',
        description: '在安全环境中执行终端命令',
        parameters: [
          {
            name: 'command',
            type: 'string',
            required: true,
            description: '要执行的终端命令',
          },
          {
            name: 'cwd',
            type: 'string',
            required: false,
            description: '执行命令的工作目录',
          },
          {
            name: 'timeout',
            type: 'number',
            required: false,
            default: 30000,
            description: '命令超时时间（毫秒）',
          },
        ],
        config: {
          allowedDirectories: [process.cwd()],
          maxTimeout: 60000,
          requiresConfirmation: true,
        },
      },
    ],
    permissions: [
      {
        name: 'system.exec',
        description: '执行系统命令',
        granted: true,
        scope: ['allowed_directories'],
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '开发工具',
      tags: ['shell', 'terminal', 'command', 'system'],
      icon: 'terminal',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createFileSkill(): Skill {
  return {
    id: 'skill-file',
    name: '文件系统',
    description: '读写和管理本地文件',
    longDescription: '强大的文件系统操作能力，可以读取、写入、编辑、删除文件，创建目录，列出文件内容等。支持多种文件格式。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['文件操作', 'file', '读取文件', '写入文件'],
    },
    actions: [
      {
        id: 'file-read',
        type: 'file',
        name: '读取文件',
        description: '读取本地文件内容',
        parameters: [
          {
            name: 'path',
            type: 'string',
            required: true,
            description: '文件路径',
          },
        ],
        config: { operation: 'read' },
      },
      {
        id: 'file-write',
        type: 'file',
        name: '写入文件',
        description: '写入内容到文件',
        parameters: [
          {
            name: 'path',
            type: 'string',
            required: true,
            description: '文件路径',
          },
          {
            name: 'content',
            type: 'string',
            required: true,
            description: '文件内容',
          },
        ],
        config: { operation: 'write' },
      },
    ],
    permissions: [
      {
        name: 'file.read',
        description: '读取文件',
        granted: true,
      },
      {
        name: 'file.write',
        description: '写入文件',
        granted: true,
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '开发工具',
      tags: ['file', 'filesystem', 'io'],
      icon: 'folder',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createWebSearchSkill(): Skill {
  return {
    id: 'skill-web-search',
    name: '网络搜索',
    description: '搜索互联网获取最新信息',
    longDescription: '联网搜索能力，可以搜索新闻、查找资料、获取实时数据。支持多种搜索引擎和高级搜索语法。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['搜索', 'search', '查找资料', '查资料'],
    },
    actions: [
      {
        id: 'search-basic',
        type: 'api',
        name: '基础搜索',
        description: '执行基础网络搜索',
        parameters: [
          {
            name: 'query',
            type: 'string',
            required: true,
            description: '搜索关键词',
          },
          {
            name: 'numResults',
            type: 'number',
            required: false,
            default: 5,
            description: '返回结果数量',
          },
        ],
        config: {
          engine: 'duckduckgo',
          safeSearch: true,
        },
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '工具',
      tags: ['search', 'web', 'internet', 'browser'],
      icon: 'search',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createCodeReviewSkill(): Skill {
  return {
    id: 'skill-code-review',
    name: '代码审查',
    description: '自动审查代码质量和安全性',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['审查代码', 'code review', '检查代码'],
    },
    actions: [
      {
        id: 'review-code',
        type: 'llm',
        name: '审查代码',
        description: '使用AI审查代码',
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
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '开发',
      tags: ['code', 'review', 'quality', 'security'],
      icon: 'code',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createTranslateSkill(): Skill {
  return {
    id: 'skill-translate',
    name: '翻译助手',
    description: '多语言翻译服务',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['翻译', 'translate', '译成'],
    },
    actions: [
      {
        id: 'translate-text',
        type: 'llm',
        name: '翻译文本',
        description: '翻译用户提供的文本',
        config: {
          systemPrompt: `你是一位专业的翻译专家。请准确翻译用户提供的文本，保持原文的语气和风格。如果用户没有指定目标语言，请翻译为中文或英文。`,
        },
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '工具',
      tags: ['translate', 'language', 'multilingual'],
      icon: 'globe',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createSummarizeSkill(): Skill {
  return {
    id: 'skill-summarize',
    name: '内容摘要',
    description: '生成内容摘要和要点',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['总结', '摘要', 'summarize', 'summary'],
    },
    actions: [
      {
        id: 'summarize-content',
        type: 'llm',
        name: '生成摘要',
        description: '为内容生成摘要',
        config: {
          systemPrompt: `你是一位内容摘要专家。请为用户提供的内容生成：
1. 简洁的摘要
2. 关键要点列表
3. 主要结论

请保持摘要的准确性和完整性。`,
        },
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '工具',
      tags: ['summary', 'summarize', 'content'],
      icon: 'document-text',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createExplainSkill(): Skill {
  return {
    id: 'skill-explain',
    name: '概念解释',
    description: '解释复杂概念和术语',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['解释', '什么是', 'explain'],
    },
    actions: [
      {
        id: 'explain-concept',
        type: 'llm',
        name: '解释概念',
        description: '用易懂的语言解释概念',
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
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '学习',
      tags: ['explain', 'education', 'concept', 'learning'],
      icon: 'book',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createSendMessageSkill(): Skill {
  return {
    id: 'skill-send-message',
    name: '发送消息',
    description: '向外部平台发送消息（飞书、钉钉等）',
    longDescription: '主动向关联的外部平台发送消息。可以发送消息到飞书、钉钉、Discord等平台。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['发送消息', '发消息', 'send message', '通知'],
    },
    actions: [
      {
        id: 'send-platform-message',
        type: 'api',
        name: '发送平台消息',
        description: '向关联的平台发送消息',
        parameters: [
          {
            name: 'content',
            type: 'string',
            required: true,
            description: '要发送的消息内容',
          },
          {
            name: 'channelId',
            type: 'string',
            required: false,
            description: '目标频道ID（可选，默认发送到最后对话的频道）',
          },
        ],
        config: {
          endpoint: '/api/agents/{agentId}/send-message',
          method: 'POST',
        },
      },
    ],
    permissions: [
      {
        name: 'message.send',
        description: '发送消息到外部平台',
        granted: true,
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '工具',
      tags: ['message', 'send', 'notify', 'platform'],
      icon: 'send',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createBrowserSkill(): Skill {
  return {
    id: 'skill-browser',
    name: '网页自动化',
    description: '使用真实的本地宿主浏览器动态提取和操控网页内容',
    longDescription: '高级网页操控能力。允许Agent启动用户本地真实的物理浏览器执行交互（所有登录状态均可共享）。每个交互工具都会返回交互后的新页面状态。在多步操作时，必须严格检查每次返回的DOM状态来判断上一步是否成功。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['打开网页', '浏览器', '点击页面', '访问网站', '抓取'],
    },
    actions: [
      {
        id: 'browser-open',
        type: 'api',
        name: '打开页面',
        description: '在浏览器中打开网址并读取内容',
        parameters: [],
        config: {}
      },
      {
        id: 'browser-click',
        type: 'api',
        name: '点击元素',
        description: '点击页面中的互动元素',
        parameters: [],
        config: {}
      },
      {
        id: 'browser-type',
        type: 'api',
        name: '输入文本',
        description: '向页面的输入框填写内容',
        parameters: [],
        config: {}
      }
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '工具',
      tags: ['browser', 'web', 'automation', 'puppeteer', 'rpa'],
      icon: 'globe',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createCliAnythingSkill(): Skill {
  return {
    id: 'skill-cli-anything',
    name: 'CLI-Anything 专业软件CLI生成',
    description: '为专业软件（如GIMP、Blender、LibreOffice）生成或使用Python CLI进行精确控制',
    longDescription: '通过CLI-Anything框架，为任意专业软件生成Python命令行接口，实现精确、可重复的自动化操作。支持从ClawHub安装预生成CLI，或通过/cli-anything命令生成新CLI。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['cli-anything', 'gimp', 'blender', 'libreoffice', '专业软件cli', 'generate cli', '生成cli'],
    },
    actions: [
      {
        id: 'cli-anything-guide',
        type: 'llm',
        name: 'CLI-Anything 使用指南',
        description: '指导如何使用CLI-Anything为专业软件生成和使用CLI',
        config: {
          prompt: `你现在具备 CLI-Anything 能力，可以为专业桌面软件生成和使用 Python CLI 接口。

## CLI-Anything 使用策略

### 1. 检查ClawHub现有CLI
优先从ClawHub安装预生成的CLI（无需等待生成）：
\`\`\`
clawhub_search 搜索 "gimp-cli" 或 "blender-cli" 等关键词
clawhub_download 安装找到的CLI包
\`\`\`

### 2. 通过pip安装
\`\`\`bash
pip install cli-anything
pip install gimp-cli  # 或其他已发布的CLI包
\`\`\`

### 3. 生成新CLI（当ClawHub没有时）
使用 /cli-anything 命令（需要在支持的环境中）：
\`\`\`
/cli-anything --target gimp --output ./gimp_cli
\`\`\`
生成后使用 /refine 命令优化CLI：
\`\`\`
/refine --target gimp --fix "描述需要修复的问题"
\`\`\`

### 4. 使用生成的CLI
生成的CLI有对应的 SKILL.md 文件说明用法：
\`\`\`bash
python gimp_cli.py open-image --file /path/to/image.png
python gimp_cli.py apply-filter --filter blur --radius 5
python gimp_cli.py save --format png --output /path/to/output.png
\`\`\`

## 何时使用CLI-Anything？
- 需要精确控制专业软件（GIMP、Blender、Inkscape、LibreOffice等）
- 需要批量处理操作（批量图片编辑、批量文档转换）
- GUI操控不可靠或不稳定时
- 需要可重复、可脚本化的操作

## 何时使用GUI工具（回退）？
- 软件没有现成CLI支持
- 操作是一次性的简单点击
- 需要观察中间状态`,
        },
      }

    ],
    metadata: {
      author: 'QilinClaw',
      version: '1.0.0',
      tags: ['cli-anything', 'professional-software', 'automation', 'gimp', 'blender'],
      icon: 'terminal',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createScreenshotSkill(): Skill {
  return {
    id: 'skill-screenshot',
    name: '桌面截图',
    description: '截取当前桌面截图并发送给用户查看',
    longDescription: '截取当前桌面的完整截图，并将图片发送给用户。适用于需要与用户共享当前屏幕状态的场景。注意：这是用于发送给用户的截图功能，与 GUI 操控工具内部使用的截图不同。',
    type: 'tool',
    status: 'installed',
    enabled: true,
    trigger: {
      type: 'keyword',
      patterns: ['截图', 'screenshot', '截取屏幕', '屏幕截图', '发到用户'],
    },
    actions: [
      {
        id: 'take-screenshot',
        type: 'llm',
        name: '截取并发送截图',
        description: '截取桌面并把图片发给用户',
        config: {
          prompt: `当用户要求截图或查看当前屏幕时，按以下步骤操作：

1. 使用 exec_cmd 工具执行 PowerShell 截图命令，保存到临时文件：
\`\`\`
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$scr=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap($scr.Width,$scr.Height)
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0,0,0,0,$bmp.Size)
$g.Dispose()
$path="$env:TEMP\\screenshot_$(Get-Date -Format 'yyyyMMdd_HHmmss').png"
$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output $path
\`\`\`

2. 从命令输出中获取保存的文件路径。

3. 使用 send_file 工具将截图发送给用户：
   send_file(path=上一步获得的路径)

完成后告知用户截图已发送。`,
        },
      },
    ],
    metadata: {
      author: 'Qilin Claw Team',
      version: '1.0.0',
      license: 'MIT',
      category: '工具',
      tags: ['screenshot', 'screen', 'capture', 'image'],
      icon: 'camera',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}


