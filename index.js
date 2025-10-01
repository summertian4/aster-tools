const api = require('./apiConfig');
const nodeFetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 日志系统
class Logger {
    constructor() {
        this.logDir = './logs';
        this.logFile = null;
        this.init();
    }

    init() {
        // 创建logs目录
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        // 创建新的日志文件
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.logFile = path.join(this.logDir, `aster-tool-${timestamp}.log`);
        
        // 写入启动信息
        this.log(`🚀 Aster 对冲交易工具启动 - ${new Date().toLocaleString('zh-CN')}`);
    }

    log(message) {
        const timestamp = new Date().toLocaleString('zh-CN');
        const logMessage = `[${timestamp}] ${message}`;
        
        // 输出到控制台
        console.log(message);
        
        // 写入文件
        fs.appendFileSync(this.logFile, logMessage + '\n');
    }

    error(message) {
        const timestamp = new Date().toLocaleString('zh-CN');
        const logMessage = `[${timestamp}] ERROR: ${message}`;
        
        // 输出到控制台
        console.error(message);
        
        // 写入文件
        fs.appendFileSync(this.logFile, logMessage + '\n');
    }
}

// 创建全局日志实例
const logger = new Logger();

// 发送 Telegram 报警通知
async function sendTelegramAlert(text) {
    try {
        if (!api.telegram || !api.telegram.enabled) return;
        const botToken = api.telegram.botToken;
        const chatId = api.telegram.chatId;
        if (!botToken || !chatId) return;

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const body = new URLSearchParams({ chat_id: String(chatId), text: text });
        await nodeFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
    } catch (e) {
        // 仅记录，不中断主流程
        logger.error(`Telegram 通知失败: ${e.message}`);
    }
}

class AsterFuturesAPI {
    constructor(apiKey, apiSecret, accountName = 'default', proxyConfig = null) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.accountName = accountName;
        this.baseURL = 'https://fapi.asterdex.com';
        this.proxyUrl = null;
        this.proxyAgent = null;
        this.proxyConfig = proxyConfig;
        // 服务器时间偏移（serverTime - localTime）
        this.timeOffsetMs = 0;
        this.lastTimeSyncAt = 0;
        this.initProxy();
    }

    // 初始化代理设置
    initProxy() {
        if (this.proxyConfig && this.proxyConfig.enabled) {
            try {
                this.proxyUrl = this.proxyConfig.url;
                this.proxyAgent = new HttpsProxyAgent(this.proxyConfig.url);
                logger.log(`[${this.accountName}] 代理已启用: ${this.proxyConfig.url}`);
            } catch (error) {
                logger.error(`[${this.accountName}] 代理设置失败: ${error.message}`);
                this.proxyUrl = null;
                this.proxyAgent = null;
            }
        } else {
            logger.log(`[${this.accountName}] 代理未启用`);
        }
    }

    // 动态设置代理
    setProxy(proxyUrl) {
        try {
            if (proxyUrl) {
                this.proxyUrl = proxyUrl;
                this.proxyAgent = new HttpsProxyAgent(proxyUrl);
                logger.log(`[${this.accountName}] 代理已更新: ${proxyUrl}`);
            } else {
                this.proxyUrl = null;
                this.proxyAgent = null;
                logger.log(`[${this.accountName}] 代理已禁用`);
            }
        } catch (error) {
            logger.error(`[${this.accountName}] 代理设置失败: ${error.message}`);
        }
    }

    // 获取当前代理状态
    getProxyStatus() {
        return {
            enabled: !!this.proxyAgent,
            url: this.proxyUrl,
            agent: this.proxyAgent ? '已配置' : '未配置'
        };
    }

    async syncTime() {
        try {
            const url = `${this.baseURL}/fapi/v1/time`;
            const opts = { method: 'GET' };
            if (this.proxyAgent) opts.agent = this.proxyAgent;
            const res = await nodeFetch(url, opts);
            const data = await res.json();
            if (data && typeof data.serverTime === 'number') {
                this.timeOffsetMs = data.serverTime - Date.now();
                this.lastTimeSyncAt = Date.now();
                logger.log(`[${this.accountName}] 时间同步: 偏移 ${this.timeOffsetMs} ms`);
            }
        } catch (e) {
            logger.error(`[${this.accountName}] 时间同步失败: ${e.message}`);
        }
    }

    generateSignature(queryString) {
        return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
    }

    async makeRequest(method, endpoint, params = {}, needAuth = false) {
        const maxRetries = Number.isFinite(api.requestRetries) ? Math.max(0, api.requestRetries) : 3;
        const baseDelayMs = Number.isFinite(api.requestRetryDelayMs) ? Math.max(50, api.requestRetryDelayMs) : 800;
        const recvWindowDefault = Number.isFinite(api.recvWindow) ? Math.max(1000, api.recvWindow) : 10000;
        let attempt = 0;
        let lastError = null;
        const origParams = Object.assign({}, params);
        const shouldRetry = (err, status) => {
            const msg = String(err?.message || '').toLowerCase();
            const net = ['etimedout', 'econnreset', 'eai_again', 'fetch failed', 'network', 'socket hang up'].some(k => msg.includes(k));
            const httpRetry = status && (status === 429 || (status >= 500 && status < 600));
            const tsSkew = msg.includes('-1021') || msg.includes('recvwindow');
            return net || httpRetry || tsSkew;
        };

        while (attempt <= maxRetries) {
            try {
                // 每次尝试都重建参数，刷新时间戳
                const reqParams = Object.assign({}, origParams);
                let url = `${this.baseURL}${endpoint}`;
                let queryString = '';
                let body = null;

                const headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'AsterAPI/1.0'
                };

                if (needAuth) {
                    // 根据服务器时间偏移计算 timestamp
                    const now = Date.now() + (this.timeOffsetMs || 0);
                    reqParams.timestamp = now;
                    reqParams.recvWindow = reqParams.recvWindow || recvWindowDefault;
                    headers['X-MBX-APIKEY'] = this.apiKey;
                }

                if (Object.keys(reqParams).length > 0) {
                    queryString = new URLSearchParams(reqParams).toString();
                    if (needAuth) {
                        const signature = this.generateSignature(queryString);
                        queryString += `&signature=${signature}`;
                    }
                }

                if (method === 'GET') {
                    if (queryString) {
                        url += `?${queryString}`;
                    }
                } else if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
                    if (queryString) {
                        body = queryString;
                    }
                }

                const fetchOptions = {
                    method,
                    headers,
                    body
                };

                if (this.proxyAgent) {
                    fetchOptions.agent = this.proxyAgent;
                }

                // 首次尝试前，如长时间未同步则同步时间
                if (needAuth && (!this.lastTimeSyncAt || (Date.now() - this.lastTimeSyncAt) > 60_000)) {
                    await this.syncTime();
                }

                const response = await nodeFetch(url, fetchOptions);

                if (!response.ok) {
                    let errorMessage = `HTTP error! status: ${response.status}`;
                    try {
                        const errorBody = await response.text();
                        if (errorBody) {
                            errorMessage += `, response: ${errorBody}`;
                        }
                    } catch (e) {}
                    const httpErr = new Error(errorMessage);
                    httpErr.status = response.status;
                    throw httpErr;
                }

                const result = await response.json();
                return result;
            } catch (error) {
                lastError = error;
                const status = error?.status;
                const msg = String(error?.message || '').toLowerCase();
                attempt += 1;

                // 碰到时间戳误差时，先同步时间再重试
                if (msg.includes('-1021') || msg.includes('recvwindow')) {
                    await this.syncTime();
                }

                if (attempt > maxRetries || !shouldRetry(error, status)) {
                    logger.error(`[${this.accountName}] 请求失败: ${error.message}`);
                    const bpObj = Object.assign({}, origParams);
                    delete bpObj.signature;
                    const briefParams = Object.keys(bpObj).length ? `?${new URLSearchParams(bpObj).toString()}` : '';
                    const alertMsg = `⚠️ 报警：账号 ${this.accountName} API 请求失败\n${method} ${endpoint}${briefParams}\n错误: ${error.message}`;
                    await sendTelegramAlert(alertMsg);
                    throw error;
                }
                const jitter = Math.floor(Math.random() * 200);
                const delay = Math.min(15_000, baseDelayMs * Math.pow(2, attempt - 1)) + jitter;
                logger.log(`[${this.accountName}] 请求重试(${attempt}/${maxRetries}) ${method} ${endpoint}: ${error.message}，${delay}ms 后重试`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError || new Error('未知请求错误');
    }

    async getPrice(symbol) {
        const response = await this.makeRequest('GET', '/fapi/v1/ticker/price', { symbol });
        return response;
    }

    async getOrderBook(symbol, limit = 5) {
        const validLimits = [5, 10, 20, 50, 100, 500, 1000];
        const finalLimit = validLimits.includes(limit) ? limit : 5;
        
        const response = await this.makeRequest('GET', '/fapi/v1/depth', { symbol, limit: finalLimit });
        return response;
    }

    async getBid1Price(symbol) {
        try {
            const orderBook = await this.getOrderBook(symbol, 5);
            if (orderBook.bids && orderBook.bids.length > 0) {
                const bid1Price = parseFloat(orderBook.bids[0][0]);
                logger.log(`[${this.accountName}] ${symbol} 买1价格: ${bid1Price}`);
                return bid1Price;
            }
            throw new Error('无法获取买1价格');
        } catch (error) {
            logger.error(`[${this.accountName}] 获取买1价格失败: ${error.message}`);
            throw error;
        }
    }

    async getAsk1Price(symbol) {
        try {
            const orderBook = await this.getOrderBook(symbol, 5);
            if (orderBook.asks && orderBook.asks.length > 0) {
                const ask1Price = parseFloat(orderBook.asks[0][0]);
                logger.log(`[${this.accountName}] ${symbol} 卖1价格: ${ask1Price}`);
                return ask1Price;
            }
            throw new Error('无法获取卖1价格');
        } catch (error) {
            logger.error(`[${this.accountName}] 获取卖1价格失败: ${error.message}`);
            throw error;
        }
    }

    async getPositions(symbol = null) {
        const params = symbol ? { symbol } : {};
        const response = await this.makeRequest('GET', '/fapi/v2/positionRisk', params, true);
        return response;
    }

    async setLeverage(symbol, leverage) {
        const response = await this.makeRequest('POST', '/fapi/v1/leverage', {
            symbol,
            leverage
        }, true);
        return response;
    }

    async placeOrder(orderParams) {
        const response = await this.makeRequest('POST', '/fapi/v1/order', orderParams, true);
        return response;
    }

    async buyOrder(symbol, quantity, price = null, type = 'MARKET', positionSide = 'BOTH') {
        // BTC市场限制为3位小数
        const formattedQuantity = parseFloat(quantity).toFixed(3);
        
        const orderParams = {
            symbol: symbol,
            side: 'BUY',
            type: type,
            quantity: formattedQuantity,
            positionSide: positionSide
        };

        if (type === 'LIMIT' && price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = 'GTC';
        }

        return await this.placeOrder(orderParams);
    }

    async sellOrder(symbol, quantity, price = null, type = 'MARKET', positionSide = 'BOTH') {
        // BTC市场限制为3位小数
        const formattedQuantity = parseFloat(quantity).toFixed(3);
        
        const orderParams = {
            symbol: symbol,
            side: 'SELL',
            type: type,
            quantity: formattedQuantity,
            positionSide: positionSide
        };

        if (type === 'LIMIT' && price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = 'GTC';
        }

        return await this.placeOrder(orderParams);
    }

    async closePosition(symbol, quantity = null) {
        try {
            const positions = await this.getPositions(symbol);
            
            if (!positions || positions.length === 0) {
                logger.log(`[${this.accountName}] 没有找到 ${symbol} 的持仓`);
                return null;
            }

            for (const position of positions) {
                const positionAmt = parseFloat(position.positionAmt);
                if (positionAmt === 0) continue;

                const closeQuantity = quantity || Math.abs(positionAmt);
                // BTC市场限制为3位小数
                const formattedCloseQuantity = parseFloat(closeQuantity).toFixed(3);
                let orderParams;

                if (positionAmt > 0) {
                    orderParams = {
                        symbol: symbol,
                        side: 'SELL',
                        type: 'MARKET',
                        quantity: formattedCloseQuantity,
                        reduceOnly: 'true',
                        positionSide: position.positionSide
                    };
                } else {
                    orderParams = {
                        symbol: symbol,
                        side: 'BUY',
                        type: 'MARKET',
                        quantity: formattedCloseQuantity,
                        reduceOnly: 'true',
                        positionSide: position.positionSide
                    };
                }

                try {
                    const result = await this.placeOrder(orderParams);
                    logger.log(`[${this.accountName}] 平仓成功: ${closeQuantity} ${symbol}`);
                    return result;
                } catch (err) {
                    const msg = String(err.message || '').toLowerCase();
                    if (msg.includes('reduceonly') && msg.includes('rejected')) {
                        logger.log(`[${this.accountName}] 平仓请求被拒绝（reduceOnly），可能已无持仓，忽略。`);
                        return null;
                    }
                    throw err;
                }
            }

            logger.log(`[${this.accountName}] 没有需要平仓的持仓`);
            return null;
        } catch (error) {
            logger.error(`[${this.accountName}] 平仓失败: ${error.message}`);
            throw error;
        }
    }

    async getOrderStatus(symbol, orderId) {
        const response = await this.makeRequest('GET', '/fapi/v1/order', {
            symbol,
            orderId
        }, true);
        return response;
    }

    async getOpenOrders(symbol = null) {
        const params = symbol ? { symbol } : {};
        const response = await this.makeRequest('GET', '/fapi/v1/openOrders', params, true);
        return response;
    }

    // 账户信息 v4（包含总余额与资产明细）
    async getAccountInfoV4() {
        const response = await this.makeRequest('GET', '/fapi/v4/account', {}, true);
        return response;
    }

    async cancelOrder(symbol, orderId) {
        const response = await this.makeRequest('DELETE', '/fapi/v1/order', {
            symbol,
            orderId
        }, true);
        return response;
    }

    async cancelAllOrders(symbol = null) {
        const params = symbol ? { symbol } : {};
        const response = await this.makeRequest('DELETE', '/fapi/v1/allOpenOrders', params, true);
        return response;
    }

    async monitorOrderStatus(symbol, orderId, maxWaitTime = 300000) {
        const startTime = Date.now();
        logger.log(`[${this.accountName}] 开始监控订单 ${orderId} 状态...`);
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                const orderInfo = await this.getOrderStatus(symbol, orderId);
                logger.log(`[${this.accountName}] 订单状态: ${orderInfo.status}, 已成交: ${orderInfo.executedQty}/${orderInfo.origQty}`);
                
                if (orderInfo.status === 'FILLED') {
                    logger.log(`✅ [${this.accountName}] 订单 ${orderId} 完全成交！`);
                    return { success: true, orderInfo, filled: true };
                }
                
                if (orderInfo.status === 'PARTIALLY_FILLED') {
                    logger.log(`⏳ [${this.accountName}] 订单 ${orderId} 部分成交，继续监控...`);
                }
                
                if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(orderInfo.status)) {
                    logger.log(`❌ [${this.accountName}] 订单 ${orderId} 状态: ${orderInfo.status}`);
                    return { success: false, orderInfo, filled: false };
                }
                
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                logger.error(`[${this.accountName}] 查询订单状态失败: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        logger.log(`⏰ [${this.accountName}] 监控订单 ${orderId} 超时`);
        return { success: false, orderInfo: null, filled: false, timeout: true };
    }
}

// 三账号对冲交易工具类
class ThreeAccountHedgeTool {
    constructor() {
        this.account1 = new AsterFuturesAPI(api.api1.apiKey, api.api1.apiSecret, '账号1', api.api1.proxy);
        this.account2 = new AsterFuturesAPI(api.api2.apiKey, api.api2.apiSecret, '账号2', api.api2.proxy);
        this.account3 = new AsterFuturesAPI(api.api3.apiKey, api.api3.apiSecret, '账号3', api.api3.proxy);
        this.accounts = [this.account1, this.account2, this.account3];
        // 避免重复平仓/退出的状态标记
        this.isClosing = false;
        this.exitRequested = false;
    }

    formatTime() {
        return new Date().toLocaleString('zh-CN');
    }

    // 生成随机数量（基于参考价的安全检查）
    generateRandomQuantity() {
        const min = api.minQuantity || 0.001;
        const max = api.maxQuantity || 0.01;
        const quantity = Math.random() * (max - min) + min;

        // 安全检查：确保不超过最大持仓价值（使用配置参考价）
        const price = api.price || 0;
        if (price > 0) {
            const positionValue = quantity * price;
            const maxValue = api.maxPositionValue || 2000;

            if (positionValue > maxValue) {
                const safeQuantity = maxValue / price;
                logger.log(`⚠️ 下单金额 ${positionValue.toFixed(2)} USDT 超过限制 ${maxValue} USDT，调整为 ${safeQuantity.toFixed(3)}`);
                return parseFloat(safeQuantity.toFixed(3));
            }
        }

        // 市场常见精度为3位小数
        return parseFloat(quantity.toFixed(3));
    }

    // 随机分配金额：主账号随机金额，辅账号金额总和等于主账号
    generateQuantityDistribution() {
        const mainQuantity = this.generateRandomQuantity();
        const remainingQuantity = mainQuantity;
        
        // 优化分配逻辑：确保两个辅账号都有合理的数量
        // 避免极端分配（如99%和1%），使用更均匀的分配
        const minRatio = 0.2; // 最小比例20%
        const maxRatio = 0.8; // 最大比例80%
        
        const ratio1 = Math.random() * (maxRatio - minRatio) + minRatio;
        const ratio2 = 1 - ratio1;
        
        const quantity1 = remainingQuantity * ratio1;
        const quantity2 = remainingQuantity * ratio2;
        
        // 确保最小数量要求
        const minQuantity = 0.001; // 最小交易单位
        const finalQuantity1 = Math.max(quantity1, minQuantity);
        const finalQuantity2 = Math.max(quantity2, minQuantity);
        
        // 如果调整后总和超过主数量，按比例缩减
        const totalAdjusted = finalQuantity1 + finalQuantity2;
        if (totalAdjusted > mainQuantity) {
            const scaleFactor = mainQuantity / totalAdjusted;
            return {
                mainQuantity: parseFloat(mainQuantity.toFixed(3)),
                quantities: [
                    parseFloat((finalQuantity1 * scaleFactor).toFixed(3)),
                    parseFloat((finalQuantity2 * scaleFactor).toFixed(3))
                ]
            };
        }
        
        return {
            mainQuantity: parseFloat(mainQuantity.toFixed(3)),
            quantities: [
                parseFloat(finalQuantity1.toFixed(3)),
                parseFloat(finalQuantity2.toFixed(3))
            ]
        };
    }

    // 设置杠杆
    async setLeverage(symbol, leverage) {
        logger.log(`\n=== [${this.formatTime()}] 设置杠杆 ===`);
        logger.log(`币种: ${symbol}, 杠杆: ${leverage}x`);

        try {
            const results = await Promise.allSettled([
                this.account1.setLeverage(symbol, leverage),
                this.account2.setLeverage(symbol, leverage),
                this.account3.setLeverage(symbol, leverage)
            ]);

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    logger.log(`✅ 账号${index + 1} 设置 ${leverage}x 杠杆成功`);
                } else {
                    logger.log(`❌ 账号${index + 1} 设置杠杆失败: ${result.reason?.message || '未知错误'}`);
                }
            });

            return results;
        } catch (error) {
            logger.error(`设置杠杆失败: ${error.message}`);
            throw error;
        }
    }

    // 三账号循环对冲
    async loopHedge(config = {}) {
        const {
            symbol = api.symbol,
            leverage = api.leverage,
            positionTime = api.positionTime || { min: 30, max: 60 },
            positionSide = 'BOTH',
            maxWaitTime = 300000
        } = config;

        logger.log(`\n🔁 === [${this.formatTime()}] 启动三账号循环对冲 ===`);
        logger.log(`币种: ${symbol}, 杠杆: ${leverage}x, 持仓: 随机${positionTime.min}-${positionTime.max}秒`);
        logger.log(`🎲 随机选择主账号和辅账号，随机分配金额`);
        let cycle = 0;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            await this.setLeverage(symbol, leverage);
        } catch (e) {
            logger.log(`⚠️ 设置杠杆失败: ${e.message}, 将继续尝试下单`);
        }

        while (true) {
            cycle += 1;
            logger.log(`\n=== 周期 #${cycle} 开始 (${this.formatTime()}) ===`);
            
            try {
                // 1) 随机选择主账号
                const mainAccountIndex = Math.floor(Math.random() * 3);
                const mainAccount = this.accounts[mainAccountIndex];
                const mainAccountName = `账号${mainAccountIndex + 1}`;
                
                // 获取辅账号
                const helperAccounts = this.accounts.filter((_, index) => index !== mainAccountIndex);
                const helperAccountNames = helperAccounts.map((_, index) => {
                    const originalIndex = this.accounts.findIndex(acc => acc === helperAccounts[index]);
                    return `账号${originalIndex + 1}`;
                });

                logger.log(`🎲 随机选择结果:`);
                logger.log(`   主账号: ${mainAccountName} (做多)`);
                logger.log(`   辅账号: ${helperAccountNames.join(', ')} (做空)`);

                // 2) 获取买一价（用于数量风险控制与下单）
                const bid1Price = await mainAccount.getBid1Price(symbol);
                logger.log(`📊 当前买一价: ${bid1Price}`);

                // 3) 生成随机金额分配（基于配置参考价做风控）
                const quantityDist = this.generateQuantityDistribution();
                logger.log(`💰 金额分配:`);
                logger.log(`   主账号 ${mainAccountName}: ${quantityDist.mainQuantity} ${symbol}`);
                logger.log(`   辅账号 ${helperAccountNames[0]}: ${quantityDist.quantities[0]} ${symbol}`);
                logger.log(`   辅账号 ${helperAccountNames[1]}: ${quantityDist.quantities[1]} ${symbol}`);
                logger.log(`   验证: ${quantityDist.quantities[0] + quantityDist.quantities[1]} = ${quantityDist.mainQuantity}`);

                // 4) 主账号下限价单
                const limitOrder = await mainAccount.buyOrder(symbol, quantityDist.mainQuantity, bid1Price, 'LIMIT', positionSide);
                logger.log(`${mainAccountName} 限价买入提交: orderId=${limitOrder.orderId}, 价格=${bid1Price}, 数量=${quantityDist.mainQuantity}`);

                // 5) 监控主账号订单成交
                const monitorResult = await mainAccount.monitorOrderStatus(symbol, limitOrder.orderId, maxWaitTime);
                if (!monitorResult.success) {
                    logger.log(`⏭️ ${mainAccountName}订单未完全成交，启动清理后进入下一轮`);
                    try {
                        await this.ensureNoPositionsAndOrders(symbol);
                        await this.logAllAccountPositions();
                    } catch (cleanupError) {
                        logger.error(`⚠️ 清理挂单/仓位失败: ${cleanupError.message}`);
                    }
                    continue;
                }

                const executedQty = parseFloat(monitorResult.orderInfo.executedQty);
                logger.log(`✅ ${mainAccountName} 成交数量: ${executedQty}`);

                // 6) 按比例调整辅账号下单数量
                const ratio = executedQty / quantityDist.mainQuantity;
                const adjustedQuantities = quantityDist.quantities.map(qty => qty * ratio);
                
                // 验证和修正数量，确保所有数量都大于0且符合BTC市场要求
                const validatedQuantities = adjustedQuantities.map(qty => {
                    const formattedQty = parseFloat(qty.toFixed(3));
                    if (formattedQty <= 0) {
                        logger.log(`⚠️ 检测到无效数量 ${qty}，调整为最小数量 0.001`);
                        return 0.001; // BTC最小交易单位
                    }
                    return formattedQty;
                });
                
                logger.log(`📊 数量调整详情:`);
                logger.log(`   原始比例: ${ratio.toFixed(6)}`);
                logger.log(`   调整后数量: [${adjustedQuantities.map(q => q.toFixed(6)).join(', ')}]`);
                logger.log(`   验证后数量: [${validatedQuantities.join(', ')}]`);

                // 7) 辅账号立即市价对冲
                logger.log(`⚡ 辅账号立即市价对冲...`);
                const hedgeResults = await Promise.allSettled([
                    helperAccounts[0].sellOrder(symbol, validatedQuantities[0], null, 'MARKET', positionSide),
                    helperAccounts[1].sellOrder(symbol, validatedQuantities[1], null, 'MARKET', positionSide)
                ]);

                hedgeResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        logger.log(`✅ ${helperAccountNames[index]} 市价对冲完成: orderId=${result.value.orderId}, 数量=${validatedQuantities[index]}`);
                    } else {
                        logger.error(`❌ ${helperAccountNames[index]} 市价对冲失败: ${result.reason?.message}`);
                    }
                });

                await this.logAllAccountPositions();

                // 8) 随机持仓时间 (30-60秒)
                const randomHoldSeconds = Math.floor(Math.random() * (positionTime.max - positionTime.min + 1)) + positionTime.min;
                const holdMs = randomHoldSeconds * 1000;
                logger.log(`⏱️ 随机持仓 ${randomHoldSeconds} 秒...`);
                await sleep(holdMs);

                // 9) 同时平仓（加防抖，避免并发重复平仓）
                if (this.isClosing) {
                    logger.log(`\n⏳ 正在平仓中，跳过重复平仓请求...`);
                } else {
                    this.isClosing = true;
                    logger.log(`\n🧹 同时平仓中...`);
                    try {
                        const closeResults = await Promise.allSettled([
                            this.account1.closePosition(symbol),
                            this.account2.closePosition(symbol),
                            this.account3.closePosition(symbol)
                        ]);

                        closeResults.forEach((result, index) => {
                            if (result.status === 'fulfilled') {
                                if (result.value) {
                                    logger.log(`✅ 账号${index + 1} 平仓成功`);
                                } else {
                                    logger.log(`ℹ️ 账号${index + 1} 无需平仓`);
                                }
                            } else {
                                logger.error(`❌ 账号${index + 1} 平仓失败: ${result.reason?.message}`);
                            }
                        });

                        await this.ensureNoPositionsAndOrders(symbol);
                        await this.logAllAccountPositions();
                        logger.log(`🎉 平仓完成，准备进入下一轮`);
                    } finally {
                        this.isClosing = false;
                    }
                }
            } catch (err) {
                logger.error(`❌ 周期 #${cycle} 失败: ${err.message}`);
                logger.log(`🕒 休眠 5 秒后继续下一轮...`);
                await sleep(5000);
                this.isClosing = false; // 避免异常时锁未释放
            }
        }
    }

    // 查询所有账号持仓状态
    async checkAllPositions(symbol = api.symbol) {
        logger.log(`\n📊 === [${this.formatTime()}] 三账号持仓状态 ===`);
        
        try {
            const results = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol),
                this.account3.getPositions(symbol)
            ]);

            logger.log(`币种: ${symbol}`);

            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const pos = result.value.find(p => parseFloat(p.positionAmt) !== 0);
                    if (pos) {
                        logger.log(`账号${index + 1} 持仓: ${pos.positionAmt} ${symbol}`);
                        logger.log(`   开仓均价: ${pos.entryPrice} USDT`);
                        logger.log(`   未实现盈亏: ${pos.unRealizedProfit} USDT`);
                        logger.log(`   杠杆倍数: ${pos.leverage}x`);
                    } else {
                        logger.log(`账号${index + 1}: 无持仓`);
                    }
                } else {
                    logger.error(`账号${index + 1} 查询失败: ${result.reason?.message}`);
                }
            });

            return results;
        } catch (error) {
            logger.error(`查询持仓失败: ${error.message}`);
            throw error;
        }
    }

    // 取消所有账号的未成交订单
    async cancelAllOpenOrders(symbol = api.symbol) {
        const targetSymbol = symbol || api.symbol;
        logger.log(`\n🚫 === [${this.formatTime()}] 取消所有未成交订单 ===`);
        logger.log(`币种: ${targetSymbol}`);

        try {
            // 先查询所有账号的未成交订单
            const openOrdersResults = await Promise.allSettled([
                this.account1.getOpenOrders(targetSymbol),
                this.account2.getOpenOrders(targetSymbol),
                this.account3.getOpenOrders(targetSymbol)
            ]);

            let totalOrders = 0;
            let queryFailures = 0;
            openOrdersResults.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const orders = result.value.filter(order => !order.symbol || order.symbol === targetSymbol);
                    if (orders.length > 0) {
                        totalOrders += orders.length;
                        logger.log(`账号${index + 1} 发现 ${orders.length} 个${targetSymbol}未成交订单`);
                        orders.forEach(order => {
                            logger.log(`   订单ID: ${order.orderId}, 类型: ${order.side} ${order.type}, 数量: ${order.origQty}, 价格: ${order.price || '市价'}`);
                        });
                    } else {
                        logger.log(`账号${index + 1}: 无未成交订单`);
                    }
                } else {
                    logger.error(`账号${index + 1} 查询未成交订单失败: ${result.reason?.message}`);
                    queryFailures += 1;
                }
            });

            if (totalOrders === 0 && queryFailures === 0) {
                logger.log(`✅ 所有账号均无 ${targetSymbol} 未成交订单，无需取消`);
                return [];
            }

            // 执行取消订单
            if (queryFailures > 0) {
                logger.log(`\n⚠️ 因 ${queryFailures} 个账号查询失败，仍将尝试对所有账号执行 ${targetSymbol} 挂单取消（盲取消）...`);
            }
            logger.log(`\n🔄 开始取消 ${totalOrders} 个${targetSymbol}未成交订单...`);
            const cancelResults = await Promise.allSettled([
                this.account1.cancelAllOrders(targetSymbol),
                this.account2.cancelAllOrders(targetSymbol),
                this.account3.cancelAllOrders(targetSymbol)
            ]);

            cancelResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    logger.log(`✅ 账号${index + 1} 取消订单成功`);
                } else {
                    logger.error(`❌ 账号${index + 1} 取消订单失败: ${result.reason?.message}`);
                }
            });

            return cancelResults;
        } catch (error) {
            logger.error(`取消订单操作失败: ${error.message}`);
            throw error;
        }
    }

    // 确保所有账号无持仓和挂单
    async ensureNoPositionsAndOrders(symbol = api.symbol) {
        const targetSymbol = symbol || api.symbol;
        logger.log(`\n🧹 === [${this.formatTime()}] 确保 ${targetSymbol} 无持仓与挂单 ===`);
        logger.log(`币种: ${targetSymbol}`);

        // 先取消所有挂单
        await this.cancelAllOpenOrders(targetSymbol);

        const collectPositions = async () => {
            const positionResults = await Promise.allSettled([
                this.account1.getPositions(targetSymbol),
                this.account2.getPositions(targetSymbol),
                this.account3.getPositions(targetSymbol)
            ]);

            const leftovers = [];

            positionResults.forEach((result, index) => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                    const activePositions = result.value.filter(pos => {
                        if (pos.symbol && pos.symbol !== targetSymbol) {
                            return false;
                        }
                        const amt = parseFloat(pos.positionAmt);
                        return !Number.isNaN(amt) && Math.abs(amt) > 0;
                    });

                    if (activePositions.length > 0) {
                        leftovers.push({ index, positions: activePositions });
                        activePositions.forEach(pos => {
                            const amt = parseFloat(pos.positionAmt);
                            const side = pos.positionSide || (amt > 0 ? 'LONG' : 'SHORT');
                            logger.log(`⚠️ 账号${index + 1} 残余持仓: ${pos.positionAmt} ${targetSymbol} (side: ${side}, 均价: ${pos.entryPrice})`);
                        });
                    } else {
                        logger.log(`✅ 账号${index + 1} 无持仓`);
                    }
                } else {
                    const reason = result.reason?.message || '未知错误';
                    logger.error(`账号${index + 1} 查询持仓失败: ${reason}`);
                    throw new Error(`账号${index + 1} 查询持仓失败: ${reason}`);
                }
            });

            return leftovers;
        };

        let leftovers = await collectPositions();
        if (leftovers.length === 0) {
            logger.log(`✅ 已确认所有账号无 ${targetSymbol} 持仓与挂单`);
            return;
        }

        logger.log(`🔄 检测到残余持仓，执行补充平仓...`);
        const retryResults = await Promise.allSettled(leftovers.map(item => this.accounts[item.index].closePosition(targetSymbol)));

        retryResults.forEach((result, idx) => {
            const accountIndex = leftovers[idx].index;
            if (result.status === 'fulfilled') {
                logger.log(`✅ 账号${accountIndex + 1} 补充平仓指令已提交`);
            } else {
                const reason = result.reason?.message || '未知错误';
                logger.error(`❌ 账号${accountIndex + 1} 补充平仓失败: ${reason}`);
            }
        });

        leftovers = await collectPositions();
        if (leftovers.length === 0) {
            logger.log(`✅ 二次检查通过，所有账号已无 ${targetSymbol} 持仓`);
            return;
        }

        const stillHolding = leftovers.map(item => `账号${item.index + 1}`).join(', ');
        throw new Error(`仍检测到持仓未能清理: ${stillHolding}`);
    }

    async logAllAccountPositions() {
        logger.log(`\n📋 === [${this.formatTime()}] 当前各资产持仓 ===`);

        const positionResults = await Promise.allSettled([
            this.account1.getPositions(),
            this.account2.getPositions(),
            this.account3.getPositions()
        ]);

        positionResults.forEach((result, index) => {
            const accountLabel = `账号${index + 1}`;
            if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                const positions = result.value.filter(pos => {
                    const amt = parseFloat(pos.positionAmt);
                    return !Number.isNaN(amt) && Math.abs(amt) > 0;
                });

                if (positions.length === 0) {
                    logger.log(`${accountLabel}: 无持仓`);
                } else {
                    logger.log(`${accountLabel} 持仓概览:`);
                    positions.forEach(pos => {
                        const amt = parseFloat(pos.positionAmt);
                        const side = pos.positionSide || (amt > 0 ? 'LONG' : 'SHORT');
                        const symbol = pos.symbol || '未知合约';
                        logger.log(`   ${symbol}: ${pos.positionAmt} (side: ${side}, 均价: ${pos.entryPrice}, 未实现盈亏: ${pos.unRealizedProfit})`);
                    });
                }
            } else {
                const reason = result.reason?.message || '未知错误';
                logger.error(`${accountLabel} 查询持仓失败: ${reason}`);
            }
        });
    }

    // 查询三账号的合约账户余额
    async showAllBalances() {
        logger.log(`\n💼 === [${this.formatTime()}] 三账号合约账户余额（v4）===`);
        try {
            const results = await Promise.allSettled([
                this.account1.getAccountInfoV4(),
                this.account2.getAccountInfoV4(),
                this.account3.getAccountInfoV4()
            ]);

            let sumTotal = 0;
            let sumUSDF = 0;
            let sumUSDT = 0;

            const rows = [];
            const formatNum = (n, d = 8) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '0.00000000');

            results.forEach((result, index) => {
                const accName = `账号${index + 1}`;
                if (result.status !== 'fulfilled') {
                    logger.error(`${accName} 查询失败: ${result.reason?.message}`);
                    return;
                }

                const info = result.value || {};
                const totalNum = parseFloat(info.totalWalletBalance || '0') || 0;
                const assets = Array.isArray(info.assets) ? info.assets : [];
                const assetMap = new Map(assets.map(a => [a.asset, a]));
                const pickNum = (symbol) => {
                    const a = assetMap.get(symbol);
                    return a ? (parseFloat(a.walletBalance || '0') || 0) : 0;
                };

                const usdfNum = pickNum('USDF');
                const usdtNum = pickNum('USDT');

                sumTotal += totalNum;
                sumUSDF += usdfNum;
                sumUSDT += usdtNum;

                rows.push([accName, totalNum, usdfNum, usdtNum]);
            });

            // 构建表格输出
            const headers = ['账号', 'totalWalletBalance', 'USDF', 'USDT'];
            const stringRows = rows.map(([name, total, usdf, usdt]) => [
                name,
                formatNum(total),
                formatNum(usdf),
                formatNum(usdt)
            ]);

            const allRows = [headers, ...stringRows, ['合计', formatNum(sumTotal), formatNum(sumUSDF), formatNum(sumUSDT)]];
            const colWidths = [0, 1, 2, 3].map(i => Math.max(...allRows.map(r => r[i].length)));

            const padCell = (s, i) => (i === 0 ? s.padEnd(colWidths[i], ' ') : s.padStart(colWidths[i], ' '));
            const sep = colWidths.map(w => '-'.repeat(w)).join(' | ');

            // 标题
            logger.log('');
            logger.log(headers.map((h, i) => padCell(h, i)).join(' | '));
            logger.log(sep);
            // 行
            stringRows.forEach(r => logger.log(r.map((c, i) => padCell(c, i)).join(' | ')));
            // 合计
            logger.log(sep);
            logger.log(['合计', formatNum(sumTotal), formatNum(sumUSDF), formatNum(sumUSDT)].map((c, i) => padCell(c, i)).join(' | '));
        } catch (error) {
            logger.error(`查询余额失败: ${error.message}`);
            throw error;
        }
    }

    // 同时平仓所有账号
    async closeAllPositions(symbol = api.symbol) {
        logger.log(`\n🔄 === [${this.formatTime()}] 三账号同时平仓 ===`);
        logger.log(`币种: ${symbol}`);

        try {
            // 先检查是否有持仓
            const positions = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol),
                this.account3.getPositions(symbol)
            ]);

            let hasPositions = false;
            positions.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const pos = result.value.find(p => parseFloat(p.positionAmt) !== 0);
                    if (pos) {
                        hasPositions = true;
                        logger.log(`账号${index + 1} 发现持仓: ${pos.positionAmt} ${symbol}`);
                    }
                }
            });

            if (!hasPositions) {
                logger.log(`✅ 所有账号均无 ${symbol} 持仓，无需平仓`);
                return [];
            }

            // 执行平仓
            const results = await Promise.allSettled([
                this.account1.closePosition(symbol),
                this.account2.closePosition(symbol),
                this.account3.closePosition(symbol)
            ]);

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    if (result.value) {
                        logger.log(`✅ 账号${index + 1} 平仓成功`);
                    } else {
                        logger.log(`ℹ️ 账号${index + 1} 无需平仓`);
                    }
                } else {
                    logger.error(`❌ 账号${index + 1} 平仓失败: ${result.reason?.message}`);
                }
            });

            // 平仓后打印当前各资产持仓概览
            await this.logAllAccountPositions();

            return results;
        } catch (error) {
            logger.error(`平仓操作失败: ${error.message}`);
            throw error;
        }
    }


    // 显示当前配置和风险分析
    showConfigAnalysis() {
        const referencePrice = api.price || 0; // 参考价（来自配置）
        const minValue = (api.minQuantity || 0.001) * referencePrice;
        const maxValue = (api.maxQuantity || 0.01) * referencePrice;
        const leverage = api.leverage || 20;
        
        logger.log(`\n📊 === 当前配置分析 ===`);
        logger.log(`币种: ${api.symbol}`);
        logger.log(`杠杆: ${leverage}x`);
        if (referencePrice > 0) {
            logger.log(`参考价: ${referencePrice.toLocaleString()} USDT`);
        } else {
            logger.log(`参考价: 未设置`);
        }
        logger.log(`\n💰 下单金额分析:`);
        if (referencePrice > 0) {
            logger.log(`最小下单: ${api.minQuantity || 0.001} = ${minValue.toFixed(2)} USDT`);
            logger.log(`最大下单: ${api.maxQuantity || 0.01} = ${maxValue.toFixed(2)} USDT`);
        } else {
            logger.log(`最小下单: ${api.minQuantity || 0.001}`);
            logger.log(`最大下单: ${api.maxQuantity || 0.01}`);
        }
        logger.log(`\n🛡️ 保证金需求:`);
        logger.log(`最小保证金: ${(minValue / leverage).toFixed(2)} USDT`);
        logger.log(`最大保证金: ${(maxValue / leverage).toFixed(2)} USDT`);
        logger.log(`\n⚠️ 风险控制:`);
        logger.log(`最大持仓价值限制: ${api.maxPositionValue || 2000} USDT`);
        logger.log(`最小账户余额要求: ${api.minAccountBalance || 100} USDT`);
        
        // 代理状态
        logger.log(`\n🌐 代理状态:`);
        this.accounts.forEach((account, index) => {
            const config = account.proxyConfig;
            logger.log(`账号${index + 1}: ${config?.enabled ? '✅ 已启用' : '❌ 未启用'} ${config?.url || ''}`);
        });
        
        // 风险等级评估
        const riskLevel = maxValue > 1000 ? '🔴 高风险' : maxValue > 500 ? '🟡 中风险' : '🟢 低风险';
        logger.log(`\n📈 风险等级: ${riskLevel}`);
        
        if (maxValue > (api.maxPositionValue || 2000)) {
            logger.log(`⚠️ 警告: 最大下单金额可能超过持仓限制！`);
        }
    }

}


// 导出
module.exports = { ThreeAccountHedgeTool, AsterFuturesAPI, Logger };

// 如果直接运行此文件，执行自动化流程
if (require.main === module) {
    runAutomatedFlow().catch(error => {
        logger.error(`程序执行失败: ${error.message}`);
        process.exit(1);
    });
}

// 自动化执行流程
async function runAutomatedFlow() {
    const tool = new ThreeAccountHedgeTool();
    const args = process.argv.slice(2);
    const isBalanceMode = args.includes('--balance') || args.includes('-b');
    const isTestTg = args.includes('--testtg');
    
    // 设置优雅退出处理
    let exiting = false;
    process.on('SIGINT', async () => {
        if (exiting) return; // 忽略重复信号
        exiting = true;
        tool.exitRequested = true;
        logger.log('\n\n🛑 接收到退出信号，正在安全退出...');
        try {
            logger.log('🚫 正在取消所有未成交订单...');
            await tool.cancelAllOpenOrders();
            
            // 防止与循环内平仓并发冲突
            if (!tool.isClosing) {
                tool.isClosing = true;
                logger.log('📋 正在平仓所有持仓...');
                await tool.closeAllPositions();
                tool.isClosing = false;
            } else {
                logger.log('⏳ 已在平仓中，跳过重复平仓');
            }
            
            logger.log('✅ 安全退出完成');
        } catch (error) {
            logger.error(`退出时操作失败: ${error.message}`);
        }
        process.exit(0);
    });
    
    try {
        logger.log('🚀 === Aster 三账号对冲交易工具启动 ===');
        
        // Telegram 测试消息模式
        if (isTestTg) {
            logger.log('\n📨 === Telegram 消息测试 ===');
            await sendTelegramAlert(`🔔 测试通知：来自 Aster 工具 ${new Date().toLocaleString('zh-CN')}`);
            logger.log('✅ 已调用 Telegram 接口（请检查聊天是否收到）');
            return;
        }

        // 余额查询模式：只查询余额后退出
        if (isBalanceMode) {
            logger.log('\n💼 === 余额查询模式 ===');
            await tool.showAllBalances();
            logger.log('✅ 余额查询完成');
            return;
        }
        
        // 步骤1: 取消所有未成交订单
        logger.log('\n🚫 === 步骤1: 取消所有未成交订单 ===');
        await tool.cancelAllOpenOrders();
        
        // 步骤2: 检查并平仓所有账户的仓位
        logger.log('\n📋 === 步骤2: 检查并平仓现有仓位 ===');
        await tool.closeAllPositions();
        
        // 步骤3: 打印当前配置和风险分析
        logger.log('\n📊 === 步骤3: 配置和风险分析 ===');
        tool.showConfigAnalysis();
        
        // 步骤4: 开启循环对冲
        logger.log('\n🔄 === 步骤4: 启动循环对冲 ===');
        logger.log('按 Ctrl+C 可随时停止循环并安全退出');
        await tool.loopHedge();
        
    } catch (error) {
        logger.error(`自动化流程执行失败: ${error.message}`);
        throw error;
    }
}
