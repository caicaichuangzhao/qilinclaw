<p align="center">
  <img src="packages/client/src/assets/logo.png" width="120" alt="QilinClaw Logo" />
</p>

<h1 align="center">🐉 QilinClaw（麒麟爪）</h1>

<p align="center">
  <strong>开源 AI 助手平台 — 可视化、多智能体、多平台</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-功能特性">功能特性</a> •
  <a href="#-界面展示">界面展示</a> •
  <a href="#-项目结构">项目结构</a> •
  <a href="#-常见问题">常见问题</a>
</p>

---

## ✨ QilinClaw 是什么？

QilinClaw 是一个**本地部署的 AI 助手平台**，旨在让普通用户也能轻松创建和管理 AI 智能体。

我们把大部分功能都做成了**可视化操作界面** — 从创建智能体、接入聊天平台、构建知识库到系统配置，**看得懂 UI 就用得懂软件**，尽量降低使用门槛。

> 📢 这是个人开发的项目，受限于测试人力，部分功能可能还不够完善。如果你在使用中遇到问题，非常欢迎通过 [Issues](https://github.com/caicaichuangzhao/qilinclaw/issues) 反馈 Bug 或提出建议。也欢迎更多开发者一起参与共建，让这个项目变得更好！

### 🎯 核心亮点

- 🖥️ **全可视化 WebUI** — 所有功能都有图形化操作界面，零配置文件编辑
- 🤖 **多智能体系统** — 创建多个 AI 助手，各自拥有不同的性格、技能和模型
- 💬 **多平台机器人** — 一键接入 Telegram、Discord、微信、钉钉、飞书、WhatsApp、QQ、Slack 等
- 🧠 **知识库 (RAG)** — 上传文档，构建知识库，智能体自动检索相关信息回答问题
- 🏢 **办公室协作** — 创建团队空间，多个智能体协同处理复杂任务
- 🔌 **MCP 协议支持** — 通过 Model Context Protocol 服务器扩展智能体能力
- 🌐 **浏览器自动化** — 智能体可通过 Chrome 扩展控制你的真实浏览器
- 🚀 **系统热更新** — 内置自动防冲突拉取机制，探测 GitHub 状态并支持面板一键极速升级底层代码
- 🌍 **中英双语界面** — 一键切换，无需重启
- 🔒 **本地优先** — 所有数据保存在你的电脑上，无任何云端依赖

---

## 📋 安装前准备

| 软件 | 版本要求 | 是否必需 | 下载地址 |
|------|---------|---------|---------|
| **Node.js** | **v22 LTS（推荐）** 或 v24 LTS | ✅ 必需 | [nodejs.org](https://nodejs.org/) |
| **Git** | 任意近期版本 | ✅ 必需 | [git-scm.com](https://git-scm.com/) |
| **Python** | 3.8+ | ❌ 可选 | [python.org](https://www.python.org/) |

> 💡 **建议：** 打开 [nodejs.org](https://nodejs.org/) 下载左侧绿色按钮的 **LTS** 版本。Node.js v22 LTS 已经充分测试，完美兼容。
>
> **提示：** Python 仅在使用本地 Embedding 模型时需要。其他所有功能无需 Python。

### 第 0 步 — 安装 Node.js 和 Git（已安装则跳过）

打开终端，运行以下命令。如果能正确打印版本号，说明已安装，可直接跳到 [快速开始](#-快速开始)。

```bash
node -v   # 应输出 v20.x.x 或更高版本
git -v    # 应输出 git version x.x.x
```

<details>
<summary><b>🪟 Windows（大多数用户）</b></summary>

1. 下载并安装 **Node.js LTS**：[https://nodejs.org/](https://nodejs.org/)（安装时勾选“Add to PATH”）
2. 下载并安装 **Git**：[https://git-scm.com/download/win](https://git-scm.com/download/win)（使用默认设置即可）
3. 安装完成后，**关闭并重新打开**终端（命令提示符、PowerShell 或 Git Bash）
4. 验证安装：`node -v` 和 `git -v`

</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
# 安装 Homebrew（如果没有）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Node.js 和 Git
brew install node git
```

</details>

<details>
<summary><b>🐧 Linux（Ubuntu / Debian）</b></summary>

```bash
# 通过 NodeSource 安装 Node.js v20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

</details>

---

## 🚀 快速开始

### 1. 克隆 & 安装

```bash
git clone https://github.com/caicaichuangzhao/qilinclaw.git
cd qilinclaw
npm install
npm link
```

> 💡 执行 `npm link` 后，`qilinclaw` 命令会注册为全局命令 — 之后在**任何目录**都可以直接使用。

### 2. 启动

```bash
qilinclaw gateway
```

浏览器会**自动弹出** WebUI 界面：`http://127.0.0.1:18168/`

搞定！🎉

### CLI 命令一览

| 命令 | 说明 |
|------|------|
| `qilinclaw install` | 安装依赖并编译项目 |
| `qilinclaw gateway` | 启动网关（自动打开浏览器） |
| `qilinclaw gateway --no-browser` | 启动网关（不自动打开浏览器） |
| `qilinclaw doctor` | 检查环境与依赖 |
| `qilinclaw uninstall` | 卸载清理 |

---

## 🖼️ 界面展示

### 仪表盘
> 实时系统概览 — 智能体数量、对话、模型使用统计、系统状态一目了然。

![仪表盘](docs/screenshots/dashboard.png)

### AI 助手管理
> 创建和管理智能体。每个助手拥有独立的性格、模型、技能和知识库。

![AI 助手](docs/screenshots/agents.png)

### 多平台机器人
> 可视化配置即可接入各大即时通讯平台，无需编写任何 API 代码。

![机器人](docs/screenshots/bots.png)

### 知识库
> 上传文档（PDF、Word、TXT 等），自动分块和向量嵌入，支持语义搜索。

![知识库](docs/screenshots/knowledge.png)

### 模型配置
> 浏览并配置 100+ AI 模型 — OpenAI、Claude、Gemini、DeepSeek、通义千问、Ollama 等。

![模型配置](docs/screenshots/models.png)

### 系统设置
> 安全配置、记忆管理、请求限制、浏览器扩展安装指引。

![设置](docs/screenshots/settings.png)

---

## ⭐ 功能特性

### 🤖 AI 智能体管理

| 功能 | 说明 |
|------|------|
| **智能创建** | 用自然语言描述需求，QilinClaw 自动帮你创建智能体 |
| **自定义助手** | 精细调整系统提示词、性格和行为模式 |
| **多模型支持** | 每个智能体可使用不同的 AI 模型（GPT-4、Claude、Gemini 等） |
| **技能装备** | 为智能体装备工具：网页搜索、文件操作、代码执行等 |
| **对话历史** | 完整的聊天记录，支持编辑、删除和消息撤回 |
| **工作空间** | 内置代码编辑器、文件浏览器和终端 |

### 💬 即时通讯平台接入

一键将智能体接入任意聊天平台：

| 平台 | 状态 | 平台 | 状态 |
|------|------|------|------|
| Telegram | ✅ | Discord | ✅ |
| 企业微信 | ✅ | 钉钉 | ✅ |
| 飞书 | ✅ | WhatsApp | ✅ |
| QQ | ✅ | Slack | ✅ |
| LINE | ✅ | Microsoft Teams | ✅ |
| Google Chat | ✅ | Mattermost | ✅ |
| Signal | ✅ | Facebook Messenger | ✅ |
| iMessage | ✅ | | |

### 🧠 知识库 (RAG) 与 Embedding 配置

- 📄 支持上传 PDF、Word、Excel、TXT、Markdown 文档
- 🔍 自动文本分块和向量嵌入
- 🎯 语义搜索，可调节相似度阈值
- 🔗 将知识库关联到智能体，实现上下文感知对话
- 🏠 支持本地 Embedding 模型（零 API 成本）

#### 💡 通过 Embedding 节省 Token 消耗

QilinClaw 内置**智能上下文记忆系统**，通过 Embedding 模型将对话历史和知识库内容转换为向量，仅在对话时检索最相关的内容注入 prompt，避免将全部历史发送给 AI。这可以**显著减少 Token 消耗**，降低 API 调用费用。

在 **设置 → 上下文记忆配置** 中你可以调节：
- **应用场景** — 针对不同使用场景（编程、文档、对话、研究）的预设方案
- **最大 Token 数** — 控制每次对话的 Token 上限
- **摘要阈值** — 超过指定消息数时自动生成摘要，压缩历史上下文
- **相似度阈值** — 控制向量检索的精准度，过滤低相关性内容

### 🏢 办公室协作

- 👥 创建团队空间，多个智能体协同工作
- 🤝 智能体之间共享上下文和对话
- 📋 共享记忆和知识库
- 💬 群组对话，角色分配

### 🌐 浏览器自动化（Chrome 扩展）

- 🧭 导航网页
- 🖱️ 点击元素
- ⌨️ 填写表单
- 📸 截图分析
- ⬇️ 页面滚动
- 🔙 前进后退
- ⚙️ 执行 JavaScript

### 🔌 MCP 协议支持

- 连接任何 MCP 兼容服务器
- 通过外部工具扩展智能体能力
- 可视化服务器管理界面

### 🛡️ 安全机制

QilinClaw 内置多层安全保障，保护你的系统和数据：

| 功能 | 说明 |
|------|------|
| **请求频率限制** | 可配置每分钟/每小时的最大 API 请求数，防止意外消耗 |
| **文件操作安全** | 文件大小限制、最大并发操作数、路径白名单保护 |
| **自动备份** | 开启后自动为被修改的文件创建备份，可配置每个文件的最大备份数 |
| **一键系统备份** | 在设置页面一键备份当前系统状态，出问题时一键恢复 |
| **自动恢复** | 系统异常时自动恢复到最近一次成功配置，可配置健康检查间隔和恢复延迟 |
| **中断强杀** | 用户停止对话或切断连接时，网关利用全局 AbortController 立刻渗透到底层强行中止 LLM 和相关 GUI 引擎消耗 |
| **断连抢救** | 即时处理页面关闭或断网。当大片段落写到一半被终止时，自动将已产出的数据截断式保底落库，不丢失任何工作进度 |
| **实时健康监控** | 仪表盘和设置页显示数据库、机器人、内存、网络、网关的实时状态 |
| **命令安全过滤** | 危险系统命令自动拦截 |
| **输入验证** | 防止注入攻击的输入校验层 |

### 🐳 Docker 集成

QilinClaw 支持与 Docker 联动，为智能体提供安全的沙箱执行环境：

- 智能体执行的代码和命令可以在 Docker 容器中运行，避免直接操作宿主机
- 适合需要执行用户提交的代码或不信任脚本的场景
- 在模型配置或智能体设置中启用 Docker 沙箱模式

> **前提条件：需要在宿主机上安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 或 Docker Engine。**

---

## 🏗️ 项目结构

```
qilinclaw/
├── bin/                    # CLI 入口
│   └── qilinclaw.js       # 主 CLI（install/gateway/doctor）
├── packages/
│   ├── client/             # Vue.js 前端（Vite + TypeScript）
│   │   ├── src/views/      # 仪表盘、助手、机器人、知识库等页面
│   │   ├── src/i18n/       # 国际化（中文/英文）
│   │   └── src/components/ # 可复用 UI 组件
│   ├── server/             # Node.js 后端（Express + TypeScript）
│   │   ├── src/services/   # 核心服务（对话、记忆、知识库等）
│   │   ├── src/routes/     # REST API 路由
│   │   ├── src/bots/       # 平台适配器（Telegram、Discord 等）
│   │   ├── src/safety/     # 安全层（频率限制、文件安全等）
│   │   └── src/data/       # 内置技能和模型定义
│   └── extension/          # Chrome 浏览器扩展
└── docs/                   # 文档和截图
```

### 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Vue 3 + TypeScript + Vite + Tailwind CSS |
| **后端** | Node.js + Express + TypeScript |
| **数据库** | SQLite（better-sqlite3） |
| **向量存储** | 内置向量搜索引擎 |
| **AI 模型** | OpenAI、Anthropic、Google、DeepSeek、通义千问、Ollama 等 |
| **机器人适配器** | 15+ 平台适配器 |
| **浏览器扩展** | Chrome Manifest V3 |

---

## ⚙️ 使用指南

### 添加 AI 模型

1. 打开 WebUI → **模型配置** 页面
2. 点击一个提供商（OpenAI、Claude 等）
3. 输入你的 API Key
4. 勾选要启用的模型

### 创建智能体

1. 进入 **AI 助手** → 点击 **"智能创建"**
2. 用自然语言描述需求：*"帮我创建一个精通 Python 和 JavaScript 的编程助手"*
3. QilinClaw 自动配置智能体
4. 开始对话！

### 接入聊天机器人

1. 进入 **机器人** → 点击 **"创建机器人"**
2. 选择平台（Telegram、Discord 等）
3. 输入你的 Bot Token
4. 关联一个 AI 智能体
5. 机器人上线！

### 构建知识库

1. 进入 **知识库** → 点击 **"新建"**
2. 上传文档（PDF、Word、TXT 等）
3. 文档自动分块和向量嵌入
4. 将知识库关联到任意智能体

### 配置 Embedding 模型（节省 Token）

1. 进入 **知识库** → **Embedding 模型配置**
2. 选择提供商（本地模型或远程 API）
3. 进入 **设置** → **上下文记忆配置** 调节参数
4. 选择适合你的应用场景预设（编程/文档/对话/研究）

---

## 🌍 多语言支持

QilinClaw 开箱即用支持**中文**和**英文**。在侧边栏底部的**语言切换按钮**随时切换，无需重启。

---

## ❓ 常见问题

### Q: 使用 QilinClaw 需要 API Key 吗？

**A:** 需要至少一个 AI 模型的 API Key（如 OpenAI、Anthropic、DeepSeek 等）。QilinClaw 本身是免费开源的，但 AI 模型需要各自的 API Key。

### Q: 可以使用本地模型吗？

**A:** 可以！QilinClaw 支持 Ollama 和任何 OpenAI 兼容的本地模型服务器。在"模型配置"页面配置 API 地址即可。

### Q: 我的数据会发到云端吗？

**A:** 不会。QilinClaw 完全运行在你的本地电脑上。唯一的外部通信是你配置的 AI 模型 API 调用。

### Q: 如何更新？

现在您可以直接在 **Settings -> 检查更新卡片** 下点击一键无痛拉取最新源码。或者您也可以随时手动进行更新：
```bash
cd qilinclaw
git pull
qilinclaw install
```

---

## 🤝 参与贡献

这个项目目前由个人维护，非常欢迎社区的参与：

- 🐛 **报告 Bug** — 在 [Issues](https://github.com/caicaichuangzhao/qilinclaw/issues) 中提交问题
- 💡 **提出建议** — 告诉我们你想要什么功能
- 🔧 **提交 PR** — 欢迎代码贡献
- ⭐ **Star 这个项目** — 如果觉得有用，给个 Star 是最好的鼓励

---

## 📄 许可证

MIT 许可证 — 详见 [LICENSE](LICENSE)。

---

<p align="center">
  <strong>🐉 QilinClaw — 你的 AI，你的规则，你的桌面</strong>
</p>
