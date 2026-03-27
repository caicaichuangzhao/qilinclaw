<p align="center">
  <img src="packages/client/src/assets/logo.png" width="120" alt="QilinClaw Logo" />
</p>

<h1 align="center">🐉 QilinClaw</h1>

<p align="center">
  <strong>Open-source AI Assistant Platform — Visual, Multi-Agent, Multi-Platform</strong>
</p>

<p align="center">
  English | <a href="README_CN.md">中文</a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-screenshots">Screenshots</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-faq">FAQ</a>
</p>

---

## ✨ What is QilinClaw?

QilinClaw is a **self-hosted AI assistant platform** designed to let anyone easily create and manage AI agents.

We've built most features with a **fully visual interface** — from creating agents, connecting chat platforms, building knowledge bases, to system configuration. **If you can read the UI, you can use the software.** Our goal is to lower the barrier to entry as much as possible.

> 📢 This is a personal project with limited testing resources. Some features may not be fully polished yet. If you encounter any issues, please feel free to report them via [Issues](https://github.com/caicaichuangzhao/qilinclaw/issues). Contributions, feedback, and suggestions are always welcome — let's build this together!

### 🎯 Key Highlights

- 🖥️ **Fully Visual WebUI** — every feature has a point-and-click interface, zero config files to edit
- 🤖 **Multi-Agent System** — create multiple AI agents with different personalities, skills, and models
- 💬 **Multi-Platform Bots** — connect your agents to Telegram, Discord, WeChat, DingTalk, Feishu, WhatsApp, QQ, Slack, and more
- 🧠 **Knowledge Base (RAG)** — upload documents, build knowledge bases, agents auto-retrieve relevant info
- 🏢 **Office Collaboration** — create team spaces where multiple agents collaborate on tasks
- 🔌 **MCP Protocol** — extend agent capabilities with Model Context Protocol servers
- 🌐 **Browser Automation** — agents can control your real browser via Chrome extension
- 🖱️ **GUI Automation** *(Beta)* — agents can operate your desktop (click, type, screenshot)
- 🌍 **Bilingual UI** — full Chinese/English interface, switch with one click
- 🔒 **Local-First** — all data stays on your machine, no cloud dependency

---

## 📋 Prerequisites

| Software | Version | Required | Download |
|----------|---------|----------|----------|
| **Node.js** | v20 LTS or later | ✅ Yes | [nodejs.org](https://nodejs.org/) |
| **Git** | Any recent version | ✅ Yes | [git-scm.com](https://git-scm.com/) |
| **Python** | 3.8+ | ❌ Optional | [python.org](https://www.python.org/) |

> **Note:** Python is only needed for local embedding models. Everything else works without it.

### Step 0 — Install Node.js & Git (skip if already installed)

Open a terminal and run the commands below. If the version numbers print correctly, you already have them — skip to [Quick Start](#-quick-start).

```bash
node -v   # should print v20.x.x or higher
git -v    # should print git version x.x.x
```

<details>
<summary><b>🪟 Windows</b></summary>

1. Download and install **Node.js LTS** from [https://nodejs.org/](https://nodejs.org/) (check "Add to PATH" during install)
2. Download and install **Git** from [https://git-scm.com/download/win](https://git-scm.com/download/win) (use default settings)
3. **Close and re-open** your terminal (Command Prompt, PowerShell, or Git Bash)
4. Verify: `node -v` and `git -v`

</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js and Git
brew install node git
```

</details>

<details>
<summary><b>🐧 Linux (Ubuntu / Debian)</b></summary>

```bash
# Install Node.js v20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

</details>

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/caicaichuangzhao/qilinclaw.git
cd qilinclaw
npm install
npm link
```

> 💡 `npm link` registers the `qilinclaw` command globally — after this step you can run it from **any directory**.

### 2. Launch

```bash
qilinclaw gateway
```

The WebUI will **automatically open in your browser** at `http://127.0.0.1:18168/`.

That's it! 🎉

### CLI Commands

| Command | Description |
|---------|-------------|
| `qilinclaw install` | Install dependencies and build the project |
| `qilinclaw gateway` | Start the gateway (auto-opens browser) |
| `qilinclaw gateway --no-browser` | Start without opening browser |
| `qilinclaw doctor` | Check environment & dependencies |
| `qilinclaw uninstall` | Clean up everything |

---

## 🖼️ Screenshots

### Dashboard
> Real-time system overview — agents, conversations, models, and system health at a glance.

![Dashboard](docs/screenshots/dashboard.png)

### AI Agents
> Create and manage intelligent agents. Each agent has its own personality, model, skills, and knowledge base.

![AI Agents](docs/screenshots/agents.png)

### Multi-Platform Bots
> Connect your agents to messaging platforms with visual configuration. No API code needed.

![Bots](docs/screenshots/bots.png)

### Knowledge Base
> Upload documents (PDF, Word, TXT, etc.) and build searchable knowledge bases with vector embeddings.

![Knowledge Base](docs/screenshots/knowledge.png)

### Model Configuration
> Browse and configure 100+ AI models from multiple providers — OpenAI, Claude, Gemini, DeepSeek, Qwen, and more.

![Models](docs/screenshots/models.png)

### Settings
> System configuration, safety settings, memory management, and browser extension setup.

![Settings](docs/screenshots/settings.png)

---

## ⭐ Features

### 🤖 AI Agent Management

| Feature | Description |
|---------|-------------|
| **Smart Creation** | Describe what you want in natural language, QilinClaw creates the agent for you |
| **Custom Agents** | Fine-tune system prompts, personality, and behavior |
| **Multi-Model** | Each agent can use a different AI model (GPT-4, Claude, Gemini, etc.) |
| **Agent Skills** | Equip agents with tools: web search, file operations, code execution, and more |
| **Conversation History** | Full chat history with edit, delete, and recall capabilities |
| **Workspace** | Built-in code editor, file browser, and terminal for agent tasks |

### 💬 Bot Platform Integration

Connect agents to any messaging platform:

| Platform | Status | Platform | Status |
|----------|--------|----------|--------|
| Telegram | ✅ | Discord | ✅ |
| WeChat Work | ✅ | DingTalk | ✅ |
| Feishu (Lark) | ✅ | WhatsApp | ✅ |
| QQ | ✅ | Slack | ✅ |
| LINE | ✅ | Microsoft Teams | ✅ |
| Google Chat | ✅ | Mattermost | ✅ |
| Signal | ✅ | Facebook Messenger | ✅ |
| iMessage | ✅ | | |

### 🧠 Knowledge Base (RAG) & Embedding Configuration

- 📄 Upload PDF, Word, Excel, TXT, Markdown files
- 🔍 Automatic text chunking and vector embedding
- 🎯 Semantic search with configurable similarity threshold
- 🔗 Link knowledge bases to agents for context-aware conversations
- 🏠 Support local embedding models (no API cost)

#### 💡 Save Token Costs with Embedding

QilinClaw features a **smart context memory system** that converts conversation history and knowledge base content into vectors via embedding models. During conversations, only the most relevant content is retrieved and injected into the prompt — instead of sending the entire history to the AI. This can **significantly reduce token consumption** and save on API costs.

In **Settings → Context Memory Configuration** you can adjust:
- **Scenario** — presets for different use cases (coding, documents, conversation, research)
- **Max Tokens** — control the token limit per conversation
- **Summary Threshold** — auto-generate summaries when messages exceed a threshold, compressing history context
- **Similarity Threshold** — control vector retrieval precision, filtering low-relevance content

### 🏢 Office Collaboration

- 👥 Create team spaces with multiple agents
- 🤝 Agents collaborate and share context
- 📋 Shared memory and knowledge across the team
- 💬 Group conversations with role assignment

### 🌐 Browser Automation (Extension)

- 🧭 Navigate websites
- 🖱️ Click elements
- ⌨️ Fill forms
- 📸 Screenshot & analyze pages
- ⬇️ Scroll pages
- 🔙 Forward/backward navigation
- ⚙️ Execute JavaScript

### 🖱️ GUI Desktop Automation *(Beta)*

> ⚠️ **Warning:** This feature is in Beta. Some operations may not work perfectly. Use with caution.
>
> **Emergency Stop:** If GUI automation behaves unexpectedly, **double-press the ESC key** to immediately interrupt all GUI operations and regain mouse/keyboard control.

- 📷 Screen capture and analysis
- 🔍 UI element scanning (UIAutomation)
- 🖱️ Mouse control (click, drag, scroll)
- ⌨️ Keyboard input
- 🏷️ Set-of-Mark visual grounding

### 🔌 MCP Protocol Support

- Connect to any MCP-compatible server
- Extend agent capabilities with external tools
- Visual server management interface

### 🛡️ Safety & Security

QilinClaw includes multiple layers of security to protect your system and data:

| Feature | Description |
|---------|-------------|
| **Rate Limiting** | Configurable max requests per minute/hour to prevent accidental overconsumption |
| **File Safety** | File size limits, max concurrent operations, path whitelist protection |
| **Auto Backup** | Automatically backs up modified files, configurable max backups per file |
| **System Backup** | One-click backup of your entire system state, one-click restore |
| **Auto Recovery** | Automatically recovers to the last known good configuration on failure |
| **Health Monitoring** | Real-time status of database, bots, memory, network, and gateway |
| **Command Filtering** | Dangerous system commands are automatically blocked |
| **Input Validation** | Input sanitization layer to prevent injection attacks |

### 🐳 Docker Integration

QilinClaw supports Docker integration to provide a secure sandbox environment for agent code execution:

- Agent-executed code and commands can run inside Docker containers, avoiding direct host machine operations
- Ideal for scenarios involving user-submitted code or untrusted scripts
- Enable Docker sandbox mode in model configuration or agent settings

> **Prerequisite: [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine must be installed on the host machine.**

---

## 🏗️ Architecture

```
qilinclaw/
├── bin/                    # CLI entry point
│   └── qilinclaw.js       # Main CLI (install/gateway/doctor)
├── packages/
│   ├── client/             # Vue.js WebUI (Vite + TypeScript)
│   │   ├── src/views/      # Dashboard, Agents, Bots, Knowledge, etc.
│   │   ├── src/i18n/       # Internationalization (EN/ZH)
│   │   └── src/components/ # Reusable UI components
│   ├── server/             # Node.js Backend (Express + TypeScript)
│   │   ├── src/services/   # Core services (chat, memory, knowledge, etc.)
│   │   ├── src/routes/     # REST API endpoints
│   │   ├── src/bots/       # Platform adapters (Telegram, Discord, etc.)
│   │   ├── src/safety/     # Security layer (rate limit, file safety, etc.)
│   │   └── src/data/       # Built-in skills and model definitions
│   └── extension/          # Chrome browser extension
└── docs/                   # Documentation and screenshots
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vue 3 + TypeScript + Vite + Tailwind CSS |
| **Backend** | Node.js + Express + TypeScript |
| **Database** | SQLite (better-sqlite3) |
| **Vector Store** | Built-in vector search engine |
| **AI Models** | OpenAI, Anthropic, Google, DeepSeek, Qwen, Ollama, and more |
| **Bot Adapters** | 15+ platform adapters |
| **Browser Extension** | Chrome Manifest V3 |

---

## ⚙️ Configuration

### Adding AI Models

1. Open the WebUI → **Models** page
2. Click a provider (OpenAI, Claude, etc.)
3. Enter your API key
4. Select models to enable

### Creating an Agent

1. Go to **AI Agents** → Click **"Smart Create"**
2. Describe what you want: *"A coding assistant that knows Python and JavaScript"*
3. QilinClaw auto-configures the agent
4. Start chatting!

### Connecting a Bot

1. Go to **Bots** → Click **"Create Bot"**
2. Select platform (Telegram, Discord, etc.)
3. Enter your bot token
4. Link an AI agent
5. Your bot is live!

### Building a Knowledge Base

1. Go to **Knowledge** → Click **"Create"**
2. Upload documents (PDF, Word, TXT, etc.)
3. Documents are automatically chunked and embedded
4. Link the knowledge base to any agent

### Configuring Embedding Models (Save Tokens)

1. Go to **Knowledge** → **Embedding Model Configuration**
2. Select a provider (local model or remote API)
3. Go to **Settings** → **Context Memory Configuration** to adjust parameters
4. Choose a scenario preset that fits your use case (coding/documents/conversation/research)

---

## 🌍 Language Support

QilinClaw supports **Chinese** and **English** out of the box. Switch language anytime from the **sidebar language toggle** — no restart needed.

---

## ❓ FAQ

### Q: Do I need an API key to use QilinClaw?

**A:** Yes, you need at least one AI model API key (e.g., OpenAI, Anthropic, DeepSeek). QilinClaw itself is free and open-source, but the AI models require their own API keys.

### Q: Can I use local models?

**A:** Yes! QilinClaw supports Ollama and any OpenAI-compatible local model server. Just configure the API endpoint in the Models page.

### Q: Is my data sent to any cloud?

**A:** No. QilinClaw runs entirely on your local machine. The only external calls are to the AI model APIs you configure.

### Q: What if GUI automation goes out of control?

**A:** Double-press the ESC key to immediately interrupt all GUI operations and regain control. GUI features are currently in Beta — please report any issues you encounter.

### Q: How do I update?

```bash
cd qilinclaw
git pull
qilinclaw install
```

---

## 🤝 Contributing

This project is currently maintained by an individual. Community participation is very welcome:

- 🐛 **Report Bugs** — submit issues on [GitHub Issues](https://github.com/caicaichuangzhao/qilinclaw/issues)
- 💡 **Suggest Features** — tell us what you'd like to see
- 🔧 **Submit PRs** — code contributions are welcome
- ⭐ **Star the Project** — if you find it useful, a star is the best encouragement

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>🐉 QilinClaw — Your AI, Your Rules, Your Desktop</strong>
</p>
