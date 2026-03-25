# 开源智爪 (QilinClaw) 使用文档

欢迎使用 **QilinClaw** — 新一代全能型自主智能体 (Agent) 操作系统与跨平台 AI 助手。
在这里，你可以找到安装、配置和使用 QilinClaw 所需的全部内容。

---

## 快速入门指南

如果您是初次使用 QilinClaw，请参考以下指南快速启动您的专属 AI 助手：

- **系统要求**: 推荐使用 Node.js 18.0.0 或以上版本。
- **环境配置**: 复制根目录下的 `.env.example` 文件并重命名为 `.env`，配置必要的端口和数据路径。
- **启动服务**:
  1. 在根目录下运行 `npm install` 安装所有底层依赖。
  2. 运行 `npm run dev` 可同时启动带热更新的本地服务端与 Vue 前端客户端。
  3. 要启动原生桌面端，可进入 `packages/desktop` 目录并运行 `npm start`。

---

## 核心架构与功能

QilinClaw 采用模块化多包 (Monorepo) 架构设计，全方位赋能您的 AI 助手：

### 1. 服务端内核 (Server)
强大的后端枢纽，提供 70+ 个 API Endpoint，支持 OpenAI 兼容格式。内置强大的任务调度、记忆管理及系统保护。
- **Agents 与线程**: 管理不同的人设智能体以及它们的历史对话上下文，支持自动向量化存储对话记忆。
- **知识库 (RAG)**: 支持 PDF、Word、Excel、PPT、CSV、HTML 及纯文本的解析、切割与高维向量化转换，实现精准的语义检索。
- **多平台适配 (Bot Manager)**: 内置近 **16种** 聊天平台适配器！包括 Telegram, Discord, Slack, 微信公众号, 微信客服, 企业微信, 钉钉, 飞书, 个人QQ, 频道QQ, MS Teams, Google Chat, Signal, Mattermost, Messenger 以及 Apple iMessage。在任何地方都可以召唤您的智能伴侣。

### 2. 多元客户端与交互入口
- **纯粹 Web 界面 (Client)**: 基于 Vue3 + Element Plus 构建，包含 Agents 列表、配置面板、知识库管理、插件市场以及聊天交互等 **15 个**核心视图页面。
- **原生桌面端 (Desktop)**: 采用 Electron / Tauri 双架构思路构建，支持无边框透明窗口、全局热键呼出、系统托盘最小化护航，为您带来最原生的沉浸式体验。
- **浏览器伴侣扩展 (Extension)**: 专用的 Chrome/Edge 浏览器控制插件，搭起“外部大脑”至浏览器底层沙盒的沟通桥梁。
- **云管控制台 (Cloud Admin)**: 面向管理员的设备授权激活体系、设备心跳监控以及版本更新推送模块。

---

## 全局自主控制权 (Autonomous Hands)

QilinClaw 通过内置的 `Tools` 系统，赋予 Agent **50余项**超级执行能力。主要分为五大自动化领域：

### 1. 视窗与键鼠控制 (GUI Control)
最强大的**零依赖物理级桌面控制系统**：
- `gui_screenshot_annotated`: 🔬 **最佳实践工具**。底层调用 UI Automation 解析所有的带交互功能控件（按钮、输入框、复选框等），并同步截取高清桌面屏幕，通过 SoM (Set-of-Mark) 原理打标带编号的彩色蒙版。
- `gui_click_marker`: 只需说出截图上蒙版的**数字编号**，鼠标游标就会瞬间精准飞跃计算，执行高精度像素物理点击。
- `gui_click` / `gui_double_click` / `gui_right_click`: 支持传统的指定逻辑坐标（自动适配 Windows DPI Scaling）执行击键动作。
- `gui_type` / `gui_press_key` / `gui_scroll` / `gui_drag`: 模拟极其逼真的人类键鼠操控，从文本推流、组合快捷键（例如 `ctrl+c`, `win+d`）到窗口拖拽与滚轮漫游。
- *特别功能*: 针对“图标类”元素（UI Automation盲区），可通过系统级的 `gui_scan_desktop` 直接破解抓取桌面所有文件及程序快捷方式图标矩阵。

### 2. 浏览器自动化操作 (Browser Action)
采用无头/有头界面的混合式设计：
- `browser_open`: 命令 AI 代理打开网址并瞬间爬取可见纯文本以及所有的交互节点，附带隐形 CSS 选择器词典。
- `browser_click` / `browser_type` / `browser_select` / `browser_press_key`: 全链路表单与页面节点操控。如果遇到需要精确等待加载的数据，也会使用 `browser_wait` 实时阻塞探知。
- 支持 `browser_go_back`, `browser_go_forward` 以及运行高度定制的代码片段 `browser_eval_js`。

### 3. 系统级工程操作
- 文件的查询（`read_file`）、编辑覆盖（`write_file`, `edit_file`）、删除（`delete_file`）以及反向推送给用户的 `send_file` 工具。
- `exec_cmd`: 原生终端穿透，能替您执行各类配置脚本或系统运维命令。
- `manage_process`: 后台守护进程控制，支持对长时执行步骤的跟踪管控。

### 4. 日程协调与知识获取
- `web_search` / `web_fetch`: 集成实时搜索引擎爬网机制。
- 定时提醒管家：可通过 `set_reminder`（支持“5分钟后”、“30秒”等人类直觉时间语言），准时在任意聊天终端给您发送定制的提醒通知。

### 5. Clawhub 技能市场生态 (Skill Engine)
直接对接 Clawhub 开源技能市场，AI 可以自主发现、调用甚至主动给您“推荐并下载”第三方组件：
- 搜索与下载: `clawhub_search`, `clawhub_download`。
- MCP 协议整合: `clawhub_mcp_search`, `clawhub_mcp_download` 快速兼容 Model Context Protocol 协议外部计算图。

---

## 协作办公与多节点计算 (MCP & Office)

### 办公室网络 (Office Collaboration)
摒弃了传统的“单一 Agent”工作流，系统自带的 `OfficeService` 能让您在云端创建一个“聊天室团队”：
- **指派 Leader**: 设置群组核心管理员拆解复杂目标。
- **群体作战**: 内卷与互补的工作模式。Agent A 负责爬虫与抓取 -> Agent B 总结排版 -> Agent C 运行测试通过并回复给人类用户。系统支持自动的事件追踪。
- 所有通信通过底层的 WebSocket SSE Stream 完成实时推流透传。

### 增强上下文 (Model Context Protocol - MCP)
采用标准的 JSON-RPC / stdio 双轨通信引擎接入全球海量外部知识插件。您可以在系统中挂载、启动和监控各个不同的 MCP 服务进程（如 SQLite Reader, GitHub Analyzer 等）。

---

## 沙盒内核与安全合规 (Security)

系统共配置了 8 层核心安全防护堡垒（位于 `system-safety`）：
1. **Docker 沙盒代码执行**: 在高危需求下（例如运行未经验证的 Python 代码），系统内置了 `DockerSandboxService`，能在 3s 内快速热启动一个临时的 Docker 容器进行安全验证。
2. **命令与文件审计墙**: 所有涉及系统读写层面（`auth`, `command-safety`, `file-safety`）的操作将被强制过滤与审查。
3. **紧急刹车机制 (Emergency Stop)**: 无论大模型如何“暴走”抢夺鼠标，只需实体键盘双击 `ESC` 键，底层基于 Win32 API 轮询的 `GetAsyncKeyState` 将瞬间被触发（绕过 Node 事件循环拥堵），掐断所有运行动作并切断长连接响应流。系统立刻归零锁死。
4. **全自动容灾回滚**: 在任何毁灭性代码变更修改前，`SystemSafetyService.createBackup('pre-change')` 会触发闪电版本快照截录。
5. **频率限制与限流**: 基于本地或 Redis 协同的限流器（`RateLimiter`）。

---

## 内穿透隧道 (Tunnel Services)
QilinClaw 支持通过一条命令将部署在您本地内网的服务实例映射到公网：
- 完美聚合 `localhost.run`, `serveo.net`, `localtunnel` 及 `ngrok` 内网穿透四大服务。提供自定义子域名和 AuthToken 加密支持。

---

## LLM 大模型提供商引擎 (Models)

内建高级的模型分发机制 `modelsManager`：
- 当前已支持 OpenAI, Anthropic, Google Gemini 等多种 API 范式。
- 对接本地 Native 大模型或 Ollama 分发节点，自带测试验证 (`/test` Endpoint) 以及 Token Context 防暴涨预算控制逻辑。
- 允许定义不同的默认模型，或针对不同的工作任务（比如“代码执行”、“视觉图生文”或“推理运算”）智能分流选用最佳模型参数方案。

---

## 后续调试及支持反馈

在 QilinClaw 的部署及使用中：
1. 请不要阻挡 `screenshot-desktop` 的视窗重叠问题；在使用 `gui_` 系列工具时，屏幕需保持激活。
2. `bot_status.json` 及 `.claw/claw.db` 是系统运行的核心依赖数据库，请勿手动编辑覆盖。
3. QilinClaw 采用 Rust 赋能与 React/Vue 全栈支撑的设计，在遇到 Node 原生执行瓶颈（如高精度截图重绘）时，将使用 `powerShell` P/Invoke 插件直接投递 DLL 句柄代码。如果您的 Windows 未开放 PowerShell 执行策略权限，请在管理员模式下输入 `Set-ExecutionPolicy RemoteSigned`。
