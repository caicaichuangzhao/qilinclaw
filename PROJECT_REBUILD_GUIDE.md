# Qilin Claw 项目重建指南

## 项目架构概述

### 技术栈
- **后端**: Node.js 18+, Express, TypeScript
- **前端**: Vue 3, Pinia, TailwindCSS
- **数据库**: SQLite (sql.js)
- **AI集成**: OpenAI, Anthropic, 自定义LLM提供商

### 核心功能模块

#### 1. 服务端核心 (`packages/server`)
```
src/
├── index.ts          # 主入口和路由
├── llm/             # LLM管理器
├── bots/            # 机器人平台集成
├── services/        # 核心服务层
├── safety/          # 安全防护系统
├── data/            # 数据模型定义
└── types/           # TypeScript类型定义
```

#### 2. 客户端核心 (`packages/client`)
```
src/
├── main.ts          # 应用入口
├── App.vue          # 根组件
├── router/          # 路由配置
├── stores/          # Pinia状态管理
├── views/           # 页面组件
└── components/      # 可复用组件
```

## 重建步骤

### 第一阶段：基础环境搭建
1. 创建新的项目目录结构
2. 初始化package.json工作区
3. 安装核心依赖包
4. 配置TypeScript和构建工具

### 第二阶段：服务端重建
1. 实现基础Express服务器
2. 重建LLM配置管理API
3. 恢复数据库Schema和模型
4. 重构安全防护机制

### 第三阶段：客户端重建
1. 搭建Vue 3基础框架
2. 实现核心UI组件
3. 重建状态管理和路由
4. 恢复主要功能页面

### 第四阶段：功能集成
1. 连接前后端API
2. 测试核心功能流程
3. 逐步恢复高级特性
4. 完善错误处理和用户体验

## 关键技术要点

### 环境变量配置 (.env)
```bash
PORT=3000
WORKSPACE_ROOT=./workspace
DATABASE_PATH=./data/claw.db
OPENAI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
```

### 启动命令
```bash
# 开发模式
npm run dev

# 生产构建
npm run build

# 单独启动服务
npm run dev:server
npm run dev:client
```

## 优先级建议

### 必须保留的核心功能
1. LLM模型配置和管理
2. 基础聊天对话功能
3. 文件上传和管理
4. 用户认证和权限控制

### 可后续补充的功能
1. 机器人平台集成
2. 高级安全特性
3. 复杂的数据分析功能
4. 第三方插件系统

## 风险评估

### 数据丢失风险
- 配置文件可通过代码推断重建
- 用户数据需要从备份恢复
- 聊天历史可重新生成测试数据

### 时间成本估算
- 基础框架重建: 2-3天
- 核心功能恢复: 5-7天
- 完整功能测试: 2-3天
- 总计约10-13个工作日

## 应急措施

如果原硬盘完全无法访问：
1. 立即停止对该硬盘的所有写入操作
2. 寻求专业数据恢复服务
3. 同时开始基于记忆的重建工作
4. 优先恢复最重要的功能模块