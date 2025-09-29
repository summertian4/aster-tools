# Aster 期货对冲交易工具

一个专为 Aster 期货交易所设计的对冲交易工具，支持双账户自动对冲、持仓监控和风险管理。

## 功能特性

- 🔄 **双账户对冲交易**: 账号1做多，账号2做空，实现风险对冲
- 📊 **实时持仓监控**: 查询两个账户的持仓状态和盈亏情况
- ⚡ **自动平仓**: 同时平掉两个账户的所有持仓
- 🎯 **杠杆管理**: 批量设置两个账户的杠杆倍数
- 🛡️ **代理支持**: 内置代理功能，支持网络代理访问
- 💻 **交互式界面**: 提供友好的命令行交互界面
- 📈 **多种订单类型**: 支持市价单和限价单

## 安装说明

### 1. 克隆或下载项目
```bash
# 如果你有完整项目
git clone <repository-url>
cd aster

# 或者直接复制 aster 文件夹到本地
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置 API 密钥
编辑 `apiConfig.js` 文件，配置你的 Aster API 密钥：

```javascript
const config = {
   api1: {
    apiKey: '你的第一个账号API密钥',
    apiSecret: '你的第一个账号API密钥',
   },
   api2: {
    apiKey: '你的第二个账号API密钥',
    apiSecret: '你的第二个账号API密钥',
   },
   symbol: 'BTCUSDT',     // 交易币种
   leverage: 20,          // 杠杆倍数
   quantity: 0.001,       // 交易数量
}
```

## 使用方法

### 方法一：交互式界面（推荐）

```bash
npm start
```

启动后会显示交互式菜单：
```
请选择操作:
1. 对冲下单 (账号1做多, 账号2做空)
2. 同时平仓
3. 查询持仓状态
4. 设置杠杆
5. 显示帮助
6. 退出
```

### 方法二：编程调用

```javascript
const { HedgeTool } = require('./index');

async function example() {
    const tool = new HedgeTool();
    
    // 1. 对冲下单 - 市价单
    await tool.hedgeOrder();
    
    // 2. 对冲下单 - 限价单
    await tool.hedgeOrder({
        orderType: 'LIMIT',
        price: 100000
    });
    
    // 3. 查询持仓状态
    await tool.checkPositions();
    
    // 4. 同时平仓
    await tool.closeAllPositions();
    
    // 5. 设置杠杆
    await tool.setLeverage('BTCUSDT', 20);
}

example().catch(console.error);
```

## API 说明

### HedgeTool 类

#### `hedgeOrder(config)`
执行对冲下单操作

**参数:**
- `config` (可选): 配置对象
  - `orderType`: 订单类型 ('MARKET' 或 'LIMIT')
  - `price`: 价格 (限价单时必填)
  - `positionSide`: 持仓方向 (默认: 'BOTH')

**返回值:**
```javascript
{
    success: boolean,
    longResult: Object,   // 账号1做多结果
    shortResult: Object,  // 账号2做空结果
    summary: Object       // 交易摘要
}
```

#### `closeAllPositions(symbol)`
同时平掉两个账户的持仓

**参数:**
- `symbol` (可选): 币种符号，默认使用配置文件中的币种

#### `checkPositions(symbol)`
查询两个账户的持仓状态

**参数:**
- `symbol` (可选): 币种符号，默认使用配置文件中的币种

#### `setLeverage(symbol, leverage)`
设置两个账户的杠杆倍数

**参数:**
- `symbol`: 币种符号
- `leverage`: 杠杆倍数

### AsterFuturesAPI 类

底层 API 封装类，提供基础的交易功能：

- `getPrice(symbol)`: 获取价格
- `getPositions(symbol)`: 获取持仓
- `buyOrder()`: 买入订单
- `sellOrder()`: 卖出订单
- `closePosition()`: 平仓
- `setLeverage()`: 设置杠杆

## 配置说明

### api.js 配置文件

```javascript
const config = {
   api1: {
    apiKey: 'API密钥1',
    apiSecret: 'API密钥1',
   },
   api2: {
    apiKey: 'API密钥2', 
    apiSecret: 'API密钥2',
   },
   symbol: 'BTCUSDT',     // 默认交易币种
   leverage: 20,          // 默认杠杆倍数
   quantity: 0.001,       // 默认交易数量
}
```

### 代理设置

如需修改代理设置，请编辑 `index.js` 文件中的 `proxyUrl` 属性：

```javascript
this.proxyUrl = 'http://127.0.0.1:1087'; // 修改为你的代理地址
```

## 安全提示

⚠️ **重要安全提醒:**

1. **API密钥安全**: 请妥善保管你的API密钥，不要提交到公共代码仓库
2. **测试环境**: 建议先在测试环境中验证功能
3. **风险控制**: 对冲交易仍存在风险，请合理控制仓位大小
4. **网络安全**: 确保代理服务器的安全性

## 故障排除

### 常见问题

1. **连接超时**
   - 检查网络连接
   - 确认代理设置是否正确
   - 验证 Aster API 服务状态

2. **API密钥错误**
   - 检查 `api.js` 中的密钥是否正确
   - 确认API密钥权限是否包含期货交易

3. **下单失败**
   - 检查账户余额是否充足
   - 确认币种符号格式是否正确
   - 验证杠杆设置是否合理

### 日志查看

程序运行时会输出详细的日志信息，包括：
- 🔄 操作开始提示
- ✅ 成功操作结果  
- ❌ 错误信息和原因
- 📊 持仓和盈亏数据

## 系统要求

- Node.js >= 14.0.0
- npm 或 yarn
- 稳定的网络连接
- 有效的 Aster API 密钥

## 许可证

MIT License

## 更新日志

### v1.0.0
- 初始版本发布
- 支持基础对冲交易功能
- 提供交互式命令行界面
- 集成持仓监控和自动平仓功能

## 支持

如有问题或建议，请提交 Issue 或联系开发者。 