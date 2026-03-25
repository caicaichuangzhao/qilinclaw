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

QilinClaw 是一个**本地部署的 AI 助手平台**，让你通过漂亮的可视化界面创建、管理和部署 AI 智能体。不需要任何命令行经验 ——**看得懂图标，就能用得懂 QilinClaw。**

### 🎯 核心亮点

- 🖥️ **全可视化 WebUI** — 所有功能都有图形化操作界面，零配置文件编辑
- 🤖 **多智能体系统** — 创建多个 AI 助手，各自拥有不同的性格、技能和模型
- 💬 **多平台机器人** — 一键接入 Telegram、Discord、微信、钉钉、飞书、WhatsApp、QQ、Slack 等
- 🧠 **知识库 (RAG)** — 上传文档，构建知识库，智能体自动检索相关信息回答问题
- 🏢 **办公室协作** — 创建团队空间，多个智能体协同处理复杂任务
- 🔌 **MCP 协议支持** — 通过 Model Context Protocol 服务器扩展智能体能力
- 🌐 **浏览器自动化** — 智能体可通过 Chrome 扩展控制你的真实浏览器
- 🖱️ **桌面 GUI 自动化** — 智能体可操作你的桌面（点击、输入、截图分析）
- 🌍 **中英双语界面** — 一键切换，无需重启
- 🔒 **本地优先** — 所有数据保存在你的电脑上，无任何云端依赖

---

## 📋 安装前准备

安装 QilinClaw 之前，请确保你的电脑已安装以下软件：

| 软件 | 版本要求 | 是否必需 | 下载地址 |
|------|---------|---------|---------|
| **Node.js** | v20 LTS 或更高 | ✅ 必需 | [nodejs.org](https://nodejs.org/) |
| **npm** | v9+（随 Node.js 自带） | ✅ 必需 | 随 Node.js 一起安装 |
| **Git** | 任意近期版本 | ✅ 必需 | [git-scm.com](https://git-scm.com/) |
| **Python** | 3.8+ | ❌ 可选 | [python.org](https://www.python.org/) |

> **提示：** Python 仅在使用本地 Embedding 模型构建知识库时需要。其他所有功能无需 Python。

### 支持的操作系统

- ✅ **Windows** 10/11（主要开发环境，完整测试）
- ✅ **macOS**（Node.js 兼容）
- ✅ **Linux**（Node.js 兼容）

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/caicaichuangzhao/qilinclaw.git
cd qilinclaw
```

### 2. 安装 & 编译

```bash
node bin/qilinclaw.js install
```

这一条命令会自动完成：
- 📦 安装所有依赖
- 🔨 编译服务端和客户端
- ⏰ 注册开机自启（仅 Windows）

### 3. 启动

```bash
node bin/qilinclaw.js gateway
```

浏览器会**自动弹出** WebUI 界面：`http://127.0.0.1:18168/`

搞定！🎉

### CLI 命令一览

| 命令 | 说明 |
|------|------|
| `node bin/qilinclaw.js install` | 安装依赖并编译项目 |
| `node bin/qilinclaw.js gateway` | 启动网关（自动打开浏览器） |
| `node bin/qilinclaw.js gateway --no-browser` | 启动网关（不自动打开浏览器） |
| `node bin/qilinclaw.js doctor` | 检查环境与依赖 |
| `node bin/qilinclaw.js uninstall` | 卸载清理 |

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

### 🧠 知识库 (RAG)

- 📄 支持上传 PDF、Word、Excel、TXT、Markdown 文档
- 🔍 自动文本分块和向量嵌入
- 🎯 语义搜索，可调节相似度阈值
- 🔗 将知识库关联到智能体，实现上下文感知对话
- 🏠 支持本地 Embedding 模型（零 API 成本）

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

### 🖱️ 桌面 GUI 自动化

- 📷 屏幕截图与分析
- 🔍 UI 元素扫描（UIAutomation）
- 🖱️ 鼠标控制（点击、拖拽、滚动）
- ⌨️ 键盘输入
- 🏷️ Set-of-Mark 视觉标注

### 🔌 MCP 协议支持

- 连接任何 MCP 兼容服务器
- 通过外部工具扩展智能体能力
- 可视化服务器管理界面

### 🛡️ 安全与保障

- 🔐 每分钟/每小时请求频率限制
- 📁 文件操作安全（大小限制、自动备份）
- 🔄 系统异常自动恢复
- 💾 一键系统备份与还原
- 🩺 实时健康状态监控

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

---

## 🌍 多语言支持

QilinClaw 开箱即用支持**中文**和**英文**。

在侧边栏底部的**语言切换按钮**随时切换，无需重启。

---

## ❓ 常见问题

### Q: 使用 QilinClaw 需要 API Key 吗？

**A:** 需要至少一个 AI 模型的 API Key（如 OpenAI、Anthropic、DeepSeek 等）。QilinClaw 本身是免费开源的，但 AI 模型需要各自的 API Key。

### Q: 可以使用本地模型吗？

**A:** 可以！QilinClaw 支持 Ollama 和任何 OpenAI 兼容的本地模型服务器。在"模型配置"页面配置 API 地址即可。

### Q: 我的数据会发到云端吗？

**A:** 不会。QilinClaw 完全运行在你的本地电脑上。你的对话记录、知识库和配置信息都保存在本地。唯一的外部通信是你配置的 AI 模型 API 调用。

### Q: 如何更新？

```bash
git pull
node bin/qilinclaw.js install
```

### Q: 如何设置开机自启？

运行 `node bin/qilinclaw.js install` 时会自动注册 Windows 开机自启任务。卸载时运行 `node bin/qilinclaw.js uninstall` 会自动移除。

---

## 📄 许可证

本项目为开源项目。详见 [LICENSE](LICENSE)。

---

<p align="center">
  <strong>🐉 QilinClaw — 你的 AI，你的规则，你的桌面</strong>
</p>
