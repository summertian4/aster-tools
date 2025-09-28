#!/bin/bash

# Aster对冲交易工具 - PM2启动脚本
# 使用方法: ./start.sh

echo "🚀 Aster对冲交易工具启动脚本"
echo "================================"

# 检查PM2是否安装
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2未安装，正在安装..."
    npm install -g pm2
fi

# 检查Node.js版本
NODE_VERSION=$(node -v)
echo "📦 Node.js版本: $NODE_VERSION"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📥 安装依赖..."
    npm install
fi

# 创建logs目录
if [ ! -d "logs" ]; then
    echo "📁 创建日志目录..."
    mkdir -p logs
fi

# 停止现有进程（如果存在）
echo "🛑 停止现有进程..."
pm2 stop aster-hedge-tool 2>/dev/null || true
pm2 delete aster-hedge-tool 2>/dev/null || true

# 启动应用
echo "🚀 启动Aster对冲交易工具..."
pm2 start ecosystem.config.js

# 显示状态
echo "📊 应用状态:"
pm2 status

echo ""
echo "✅ 启动完成！"
echo "📝 查看日志: npm run pm2:logs"
echo "📊 监控面板: npm run pm2:monit"
echo "🛑 停止应用: npm run pm2:stop"
echo ""
