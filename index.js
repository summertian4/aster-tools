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

class AsterFuturesAPI {
    constructor(apiKey, apiSecret, accountName = 'default', proxyConfig = null) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.accountName = accountName;
        this.baseURL = 'https://fapi.asterdex.com';
        this.proxyUrl = null;
        this.proxyAgent = null;
        this.proxyConfig = proxyConfig;
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

    generateSignature(queryString) {
        return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
    }

    async makeRequest(method, endpoint, params = {}, needAuth = false) {
        try {
            let url = `${this.baseURL}${endpoint}`;
            let queryString = '';
            let body = null;
            
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'AsterAPI/1.0'
            };

            if (needAuth) {
                params.timestamp = Date.now();
                params.recvWindow = params.recvWindow || 5000;
                headers['X-MBX-APIKEY'] = this.apiKey;
            }

            if (Object.keys(params).length > 0) {
                queryString = new URLSearchParams(params).toString();
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

            // 使用代理
            if (this.proxyAgent) {
                fetchOptions.agent = this.proxyAgent;
            }

            const response = await nodeFetch(url, fetchOptions);

            if (!response.ok) {
                let errorMessage = `HTTP error! status: ${response.status}`;
                try {
                    const errorBody = await response.text();
                    if (errorBody) {
                        errorMessage += `, response: ${errorBody}`;
                    }
                } catch (e) {
                    // 忽略读取响应体的错误
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            logger.error(`[${this.accountName}] 请求失败: ${error.message}`);
            throw error;
        }
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

                const result = await this.placeOrder(orderParams);
                logger.log(`[${this.accountName}] 平仓成功: ${closeQuantity} ${symbol}`);
                return result;
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
    }

    formatTime() {
        return new Date().toLocaleString('zh-CN');
    }

    // 生成随机数量（带安全检查）
    generateRandomQuantity() {
        const min = api.minQuantity || 0.001;
        const max = api.maxQuantity || 0.01;
        const quantity = Math.random() * (max - min) + min;
        
        // 安全检查：确保不超过最大持仓价值
        const currentPrice = 112000; // 可以从API获取实时价格
        const positionValue = quantity * currentPrice;
        const maxValue = api.maxPositionValue || 2000;
        
        if (positionValue > maxValue) {
            const safeQuantity = maxValue / currentPrice;
            logger.log(`⚠️ 下单金额 ${positionValue.toFixed(2)} USDT 超过限制 ${maxValue} USDT，调整为 ${safeQuantity.toFixed(3)} BTC`);
            return parseFloat(safeQuantity.toFixed(3));
        }
        
        // BTC市场限制为3位小数
        return parseFloat(quantity.toFixed(3));
    }

    // 随机分配金额：主账号随机金额，辅账号金额总和等于主账号
    generateQuantityDistribution() {
        const mainQuantity = this.generateRandomQuantity();
        const remainingQuantity = mainQuantity;
        
        // 随机分配给两个辅账号
        const ratio1 = Math.random();
        const ratio2 = 1 - ratio1;
        
        const quantity1 = remainingQuantity * ratio1;
        const quantity2 = remainingQuantity * ratio2;
        
        return {
            mainQuantity: parseFloat(mainQuantity.toFixed(3)),
            quantities: [
                parseFloat(quantity1.toFixed(3)),
                parseFloat(quantity2.toFixed(3))
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
            positionTime = api.positionTime || 5,
            positionSide = 'BOTH',
            maxWaitTime = 300000
        } = config;

        logger.log(`\n🔁 === [${this.formatTime()}] 启动三账号循环对冲 ===`);
        logger.log(`币种: ${symbol}, 杠杆: ${leverage}x, 持仓: ${positionTime} 分钟`);
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

                // 2) 生成随机金额分配
                const quantityDist = this.generateQuantityDistribution();
                logger.log(`💰 金额分配:`);
                logger.log(`   主账号 ${mainAccountName}: ${quantityDist.mainQuantity} ${symbol}`);
                logger.log(`   辅账号 ${helperAccountNames[0]}: ${quantityDist.quantities[0]} ${symbol}`);
                logger.log(`   辅账号 ${helperAccountNames[1]}: ${quantityDist.quantities[1]} ${symbol}`);
                logger.log(`   验证: ${quantityDist.quantities[0] + quantityDist.quantities[1]} = ${quantityDist.mainQuantity}`);

                // 3) 获取买一价
                const bid1Price = await mainAccount.getBid1Price(symbol);
                logger.log(`📊 当前买一价: ${bid1Price}`);

                // 4) 主账号下限价单
                const limitOrder = await mainAccount.buyOrder(symbol, quantityDist.mainQuantity, bid1Price, 'LIMIT', positionSide);
                logger.log(`${mainAccountName} 限价买入提交: orderId=${limitOrder.orderId}, 价格=${bid1Price}, 数量=${quantityDist.mainQuantity}`);

                // 5) 监控主账号订单成交
                const monitorResult = await mainAccount.monitorOrderStatus(symbol, limitOrder.orderId, maxWaitTime);
                if (!monitorResult.success) {
                    logger.log(`⏭️ ${mainAccountName}订单未完全成交，跳过本周期`);
                    continue;
                }

                const executedQty = parseFloat(monitorResult.orderInfo.executedQty);
                logger.log(`✅ ${mainAccountName} 成交数量: ${executedQty}`);

                // 6) 按比例调整辅账号下单数量
                const ratio = executedQty / quantityDist.mainQuantity;
                const adjustedQuantities = quantityDist.quantities.map(qty => qty * ratio);

                // 7) 辅账号立即市价对冲
                logger.log(`⚡ 辅账号立即市价对冲...`);
                const hedgeResults = await Promise.allSettled([
                    helperAccounts[0].sellOrder(symbol, adjustedQuantities[0], null, 'MARKET', positionSide),
                    helperAccounts[1].sellOrder(symbol, adjustedQuantities[1], null, 'MARKET', positionSide)
                ]);

                hedgeResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        logger.log(`✅ ${helperAccountNames[index]} 市价对冲完成: orderId=${result.value.orderId}, 数量=${adjustedQuantities[index]}`);
                    } else {
                        logger.error(`❌ ${helperAccountNames[index]} 市价对冲失败: ${result.reason?.message}`);
                    }
                });

                // 8) 持仓
                const holdMs = Math.max(1, positionTime) * 60 * 1000;
                logger.log(`⏱️ 持仓 ${positionTime} 分钟...`);
                await sleep(holdMs);

                // 9) 同时平仓
                logger.log(`\n🧹 同时平仓中...`);
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

                logger.log(`🎉 平仓完成，准备进入下一轮`);
            } catch (err) {
                logger.error(`❌ 周期 #${cycle} 失败: ${err.message}`);
                logger.log(`🕒 休眠 5 秒后继续下一轮...`);
                await sleep(5000);
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

            return results;
        } catch (error) {
            logger.error(`平仓操作失败: ${error.message}`);
            throw error;
        }
    }


    // 显示当前配置和风险分析
    showConfigAnalysis() {
        const currentPrice = 112000; // BTC价格
        const minValue = (api.minQuantity || 0.001) * currentPrice;
        const maxValue = (api.maxQuantity || 0.01) * currentPrice;
        const leverage = api.leverage || 20;
        
        logger.log(`\n📊 === 当前配置分析 ===`);
        logger.log(`币种: ${api.symbol}`);
        logger.log(`杠杆: ${leverage}x`);
        logger.log(`BTC价格: ${currentPrice.toLocaleString()} USDT`);
        logger.log(`\n💰 下单金额分析:`);
        logger.log(`最小下单: ${api.minQuantity || 0.001} BTC = ${minValue.toFixed(2)} USDT`);
        logger.log(`最大下单: ${api.maxQuantity || 0.01} BTC = ${maxValue.toFixed(2)} USDT`);
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
    
    // 设置优雅退出处理
    process.on('SIGINT', async () => {
        logger.log('\n\n🛑 接收到退出信号，正在安全退出...');
        try {
            logger.log('📋 正在平仓所有持仓...');
            await tool.closeAllPositions();
            logger.log('✅ 安全退出完成');
        } catch (error) {
            logger.error(`退出时平仓失败: ${error.message}`);
        }
        process.exit(0);
    });
    
    try {
        logger.log('🚀 === Aster 三账号对冲交易工具启动 ===');
        
        // 步骤1: 检查并平仓所有账户的仓位
        logger.log('\n📋 === 步骤1: 检查并平仓现有仓位 ===');
        await tool.closeAllPositions();
        
        // 步骤2: 打印当前配置和风险分析
        logger.log('\n📊 === 步骤2: 配置和风险分析 ===');
        tool.showConfigAnalysis();
        
        // 步骤3: 开启循环对冲
        logger.log('\n🔄 === 步骤3: 启动循环对冲 ===');
        logger.log('按 Ctrl+C 可随时停止循环并安全退出');
        await tool.loopHedge();
        
    } catch (error) {
        logger.error(`自动化流程执行失败: ${error.message}`);
        throw error;
    }
}