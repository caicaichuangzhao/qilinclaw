# 紧急备份和同步方案

## Git版本控制设置

### 1. 初始化Git仓库
```bash
cd "E:\BC\Qilin Claw"
git init
git add .
git commit -m "Initial commit - Full project backup"
```

### 2. 推送至远程仓库
```bash
# GitHub/GitLab创建私有仓库
git remote add origin https://github.com/yourusername/qilin-claw.git
git push -u origin main
```

### 3. 设置自动同步脚本
```batch
@echo off
cd /d "E:\BC\Qilin Claw"
git add .
git commit -m "Auto backup %date% %time%"
git push origin main
echo Backup completed at %date% %time%
```

## 云端存储方案

### 1. 使用网盘同步
- OneDrive/百度网盘等实时同步
- 设置选择性同步只同步代码目录
- 避免同步node_modules等大文件夹

### 2. 代码托管平台
```bash
# 创建.gitignore排除不必要的文件
node_modules/
dist/
.env
*.log
.claw/
```

## 分卷备份策略

### 1. 按功能模块分卷
```
卷1: 核心框架和配置文件 (100MB)
卷2: 服务端源代码 (200MB)  
卷3: 客户端源代码 (150MB)
卷4: 文档和资源文件 (50MB)
```

### 2. 备份验证脚本
```bash
#!/bin/bash
# 检查关键文件完整性
FILES=(
  "package.json"
  "packages/server/src/index.ts"
  "packages/client/src/main.ts"
  "packages/client/src/App.vue"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✓ $file exists"
  else
    echo "✗ $file missing"
  fi
done
```

## 硬盘健康监控

### 1. 磁盘检查命令
```cmd
chkdsk E: /f /r
```

### 2. SMART状态监控
使用CrystalDiskInfo等工具监控硬盘健康状态

## 紧急联系专业服务

如果硬盘确实损坏严重：
- 联系专业数据恢复公司
- 提供硬盘型号和故障描述
- 评估恢复成本和时间
- 同时启动代码重建计划

## 最佳实践建议

1. **立即行动**：硬盘有问题时不要延迟处理
2. **多重备份**：本地+云端+Git三重保障
3. **增量备份**：只备份变化的文件
4. **定期验证**：确保备份文件可正常恢复
5. **文档记录**：详细记录项目架构和关键技术点