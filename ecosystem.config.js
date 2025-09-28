module.exports = {
  apps: [{
    name: 'aster-hedge-tool',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    // 日志配置
    log_file: './logs/pm2-combined.log',
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // 进程管理
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // 监控配置
    monitoring: true,
    
    // 环境变量
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // 高级配置
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // 错误处理
    ignore_watch: [
      'node_modules',
      'logs',
      '*.log'
    ],
    
    // 自动重启条件
    exp_backoff_restart_delay: 100,
    
    // 进程标题
    instance_var: 'INSTANCE_ID'
  }],

  // 部署配置（可选）
  deploy: {
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/aster-hedge-tool.git',
      path: '/var/www/aster-hedge-tool',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
