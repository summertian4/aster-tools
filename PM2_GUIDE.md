# PM2 管理指南

## 📋 概述

PM2是一个强大的Node.js进程管理器，用于管理Aster对冲交易工具的运行。它提供了自动重启、日志管理、监控等功能。

## 🚀 快速开始

### 1. 安装PM2
```bash
# 全局安装PM2
npm install -g pm2

# 或者安装项目依赖
npm install
```

### 2. 启动应用
```bash
# 使用配置文件启动
npm run pm2:start

# 或者直接使用PM2命令
pm2 start ecosystem.config.js
```

## 📝 常用命令

### 基础管理
```bash
# 启动应用
npm run pm2:start

# 停止应用
npm run pm2:stop

# 重启应用
npm run pm2:restart

# 重载应用（零停机时间）
npm run pm2:reload

# 删除应用
npm run pm2:delete
```

### 监控和日志
```bash
# 查看应用状态
npm run pm2:status

# 查看实时日志
npm run pm2:logs

# 打开监控面板
npm run pm2:monit

# 清空日志
npm run pm2:flush
```

### 高级命令
```bash
# 查看详细信息
pm2 describe aster-hedge-tool

# 查看进程信息
pm2 show aster-hedge-tool

# 设置开机自启
pm2 startup
pm2 save

# 查看所有进程
pm2 list

# 停止所有进程
pm2 stop all

# 重启所有进程
pm2 restart all
```

## ⚙️ 配置文件说明

### ecosystem.config.js 主要配置项

```javascript
{
  name: 'aster-hedge-tool',        // 应用名称
  script: 'index.js',             // 启动脚本
  instances: 1,                    // 实例数量
  autorestart: true,              // 自动重启
  watch: false,                    // 文件监控
  max_memory_restart: '1G',       // 内存限制
  env: {                          // 环境变量
    NODE_ENV: 'production'
  }
}
```

### 日志配置
- `log_file`: 合并日志文件
- `out_file`: 标准输出日志
- `error_file`: 错误日志
- `log_date_format`: 日志时间格式

### 进程管理
- `min_uptime`: 最小运行时间
- `max_restarts`: 最大重启次数
- `restart_delay`: 重启延迟

## 📊 监控功能

### 1. 实时监控
```bash
pm2 monit
```
显示CPU、内存使用情况，进程状态等。

### 2. 日志管理
```bash
# 查看实时日志
pm2 logs aster-hedge-tool

# 查看错误日志
pm2 logs aster-hedge-tool --err

# 查看输出日志
pm2 logs aster-hedge-tool --out
```

### 3. 状态检查
```bash
pm2 status
```
显示所有进程的运行状态。

## 🔧 故障排除

### 常见问题

1. **应用无法启动**
   ```bash
   # 检查日志
   pm2 logs aster-hedge-tool --err
   
   # 检查配置文件
   pm2 describe aster-hedge-tool
   ```

2. **内存使用过高**
   ```bash
   # 重启应用
   pm2 restart aster-hedge-tool
   
   # 检查内存使用
   pm2 monit
   ```

3. **频繁重启**
   ```bash
   # 查看重启历史
   pm2 show aster-hedge-tool
   
   # 调整重启策略
   # 编辑 ecosystem.config.js
   ```

### 日志位置
- 应用日志: `./logs/aster-tool-*.log`
- PM2日志: `./logs/pm2-*.log`

## 🛡️ 安全建议

1. **生产环境配置**
   - 设置合适的 `max_memory_restart`
   - 配置 `min_uptime` 防止频繁重启
   - 启用日志轮转

2. **监控设置**
   - 定期检查应用状态
   - 设置内存和CPU监控
   - 配置告警通知

3. **备份策略**
   - 定期备份配置文件
   - 保存重要的日志文件
   - 备份API密钥配置

## 📈 性能优化

1. **内存管理**
   - 设置合理的内存限制
   - 监控内存泄漏
   - 定期重启应用

2. **日志管理**
   - 定期清理旧日志
   - 使用日志轮转
   - 分离错误和普通日志

3. **进程管理**
   - 避免过度重启
   - 设置合理的重启延迟
   - 监控进程健康状态

## 🔄 部署流程

### 开发环境
```bash
npm run pm2:start
npm run pm2:logs
```

### 生产环境
```bash
# 1. 停止当前应用
pm2 stop aster-hedge-tool

# 2. 更新代码
git pull origin main

# 3. 安装依赖
npm install

# 4. 重启应用
pm2 restart aster-hedge-tool

# 5. 检查状态
pm2 status
```

## 📞 支持

如果遇到问题，请检查：
1. 应用日志文件
2. PM2状态信息
3. 系统资源使用情况
4. 网络连接状态

---

**注意**: 请确保在生产环境中正确配置API密钥和代理设置，并定期监控应用运行状态。
