const api = require('./apiConfig');
const nodeFetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

function normalizeProxyConfig(proxyConfig) {
    if (!proxyConfig) return null;

    if (typeof proxyConfig === 'string') {
        return proxyConfig;
    }

    if (typeof proxyConfig === 'object') {
        const { url, username, password } = proxyConfig;
        if (!url) {
            console.warn('代理配置缺少 url 字段，已忽略该配置');
            return null;
        }

        try {
            const proxyUrl = new URL(url);
            if (username) proxyUrl.username = username;
            if (password) proxyUrl.password = password;
            return proxyUrl.toString();
        } catch (error) {
            console.warn(`代理地址无效: ${url}`);
            return null;
        }
    }

    console.warn('代理配置格式不支持，只接受字符串或对象');
    return null;
}

class AsterFuturesAPI {
    constructor(apiKey, apiSecret, accountName = 'default', proxyUrl = null) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.accountName = accountName;
        this.baseURL = 'https://fapi.asterdex.com';
        this.proxyUrl = proxyUrl;
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

            if (this.proxyUrl) {
                fetchOptions.agent = new HttpsProxyAgent(this.proxyUrl);
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
            console.error(`[${this.accountName}] 请求失败:`, error.message);
            throw error;
        }
    }

    async getPrice(symbol) {
        const response = await this.makeRequest('GET', '/fapi/v1/ticker/price', { symbol });
        return response;
    }

    // 获取盘口深度数据
    async getOrderBook(symbol, limit = 5) {
        // Aster API 可能支持的深度限制值：5, 10, 20, 50, 100, 500, 1000
        const validLimits = [5, 10, 20, 50, 100, 500, 1000];
        const finalLimit = validLimits.includes(limit) ? limit : 5;
        
        const response = await this.makeRequest('GET', '/fapi/v1/depth', { symbol, limit: finalLimit });
        return response;
    }

    // 获取买1价格（最高买价）
    async getBid1Price(symbol) {
        try {
            const orderBook = await this.getOrderBook(symbol, 5); // 使用最小有效限制值
            if (orderBook.bids && orderBook.bids.length > 0) {
                const bid1Price = parseFloat(orderBook.bids[0][0]);
                console.log(`[${this.accountName}] ${symbol} 买1价格: ${bid1Price}`);
                return bid1Price;
            }
            throw new Error('无法获取买1价格');
        } catch (error) {
            console.error(`[${this.accountName}] 获取买1价格失败:`, error.message);
            throw error;
        }
    }

    // 获取卖1价格（最低卖价）
    async getAsk1Price(symbol) {
        try {
            const orderBook = await this.getOrderBook(symbol, 5); // 使用最小有效限制值
            if (orderBook.asks && orderBook.asks.length > 0) {
                const ask1Price = parseFloat(orderBook.asks[0][0]);
                console.log(`[${this.accountName}] ${symbol} 卖1价格: ${ask1Price}`);
                return ask1Price;
            }
            throw new Error('无法获取卖1价格');
        } catch (error) {
            console.error(`[${this.accountName}] 获取卖1价格失败:`, error.message);
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
        const orderParams = {
            symbol: symbol,
            side: 'BUY',
            type: type,
            quantity: quantity.toString(),
            positionSide: positionSide
        };

        if (type === 'LIMIT' && price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = 'GTC';
        }

        return await this.placeOrder(orderParams);
    }

    async sellOrder(symbol, quantity, price = null, type = 'MARKET', positionSide = 'BOTH') {
        const orderParams = {
            symbol: symbol,
            side: 'SELL',
            type: type,
            quantity: quantity.toString(),
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
                console.log(`[${this.accountName}] 没有找到 ${symbol} 的持仓`);
                return null;
            }

            for (const position of positions) {
                const positionAmt = parseFloat(position.positionAmt);
                if (positionAmt === 0) continue;

                const closeQuantity = quantity || Math.abs(positionAmt);
                let orderParams;

                if (positionAmt > 0) {
                    // 平多仓 - 卖出
                    orderParams = {
                        symbol: symbol,
                        side: 'SELL',
                        type: 'MARKET',
                        quantity: closeQuantity.toString(),
                        reduceOnly: 'true',
                        positionSide: position.positionSide
                    };
                } else {
                    // 平空仓 - 买入
                    orderParams = {
                        symbol: symbol,
                        side: 'BUY',
                        type: 'MARKET',
                        quantity: closeQuantity.toString(),
                        reduceOnly: 'true',
                        positionSide: position.positionSide
                    };
                }

                const result = await this.placeOrder(orderParams);
                console.log(`[${this.accountName}] 平仓成功: ${closeQuantity} ${symbol}`);
                return result;
            }

            console.log(`[${this.accountName}] 没有需要平仓的持仓`);
            return null;
        } catch (error) {
            console.error(`[${this.accountName}] 平仓失败:`, error.message);
            throw error;
        }
    }

    // 查询订单状态
    async getOrderStatus(symbol, orderId) {
        const response = await this.makeRequest('GET', '/fapi/v1/order', {
            symbol,
            orderId
        }, true);
        return response;
    }

    // 取消订单
    async cancelOrder(symbol, orderId) {
        const response = await this.makeRequest('DELETE', '/fapi/v1/order', {
            symbol,
            orderId
        }, true);
        return response;
    }

    // 查询所有开放订单
    async getOpenOrders(symbol = null) {
        const params = symbol ? { symbol } : {};
        const response = await this.makeRequest('GET', '/fapi/v1/openOrders', params, true);
        return response;
    }

    // 取消所有开放订单
    async cancelAllOrders(symbol = null) {
        const params = symbol ? { symbol } : {};
        const response = await this.makeRequest('DELETE', '/fapi/v1/allOpenOrders', params, true);
        return response;
    }

    // 监控订单状态直到完成或超时
    async monitorOrderStatus(symbol, orderId, maxWaitTime = 300000) { // 默认5分钟超时
        const startTime = Date.now();
        console.log(`[${this.accountName}] 开始监控订单 ${orderId} 状态...`);
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                const orderInfo = await this.getOrderStatus(symbol, orderId);
                console.log(`[${this.accountName}] 订单状态: ${orderInfo.status}, 已成交: ${orderInfo.executedQty}/${orderInfo.origQty}`);
                
                // 订单完全成交
                if (orderInfo.status === 'FILLED') {
                    console.log(`✅ [${this.accountName}] 订单 ${orderId} 完全成交！`);
                    return { success: true, orderInfo, filled: true };
                }
                
                // 订单部分成交
                if (orderInfo.status === 'PARTIALLY_FILLED') {
                    console.log(`⏳ [${this.accountName}] 订单 ${orderId} 部分成交，继续监控...`);
                }
                
                // 订单被取消或拒绝
                if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(orderInfo.status)) {
                    console.log(`❌ [${this.accountName}] 订单 ${orderId} 状态: ${orderInfo.status}`);
                    return { success: false, orderInfo, filled: false };
                }
                
                // 等待3秒后再次检查
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.error(`[${this.accountName}] 查询订单状态失败:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 5000)); // 错误时等待更长时间
            }
        }
        
        console.log(`⏰ [${this.accountName}] 监控订单 ${orderId} 超时`);
        return { success: false, orderInfo: null, filled: false, timeout: true };
    }

    // 监控订单状态并实时返回成交信息（支持边成交边对冲）
    async monitorOrderWithRealTimeExecution(symbol, orderId, onPartialFill, maxWaitTime = 300000) {
        const startTime = Date.now();
        console.log(`[${this.accountName}] 开始实时监控订单 ${orderId} 状态...`);
        
        let lastExecutedQty = 0;
        let totalExecuted = 0;
        
        while (Date.now() - startTime < maxWaitTime) {
            try {
                const orderInfo = await this.getOrderStatus(symbol, orderId);
                const currentExecuted = parseFloat(orderInfo.executedQty || 0);
                const newlyExecuted = currentExecuted - lastExecutedQty;
                
                console.log(`[${this.accountName}] 订单状态: ${orderInfo.status}, 已成交: ${orderInfo.executedQty}/${orderInfo.origQty}`);
                
                // 如果有新的成交量，立即回调
                if (newlyExecuted > 0) {
                    console.log(`🔄 [${this.accountName}] 新成交: ${newlyExecuted}, 累计: ${currentExecuted}`);
                    if (onPartialFill) {
                        try {
                            await onPartialFill(newlyExecuted, currentExecuted, orderInfo);
                        } catch (callbackError) {
                            console.error(`❌ 部分成交回调失败: ${callbackError.message}`);
                        }
                    }
                    lastExecutedQty = currentExecuted;
                    totalExecuted = currentExecuted;
                }
                
                // 订单完全成交
                if (orderInfo.status === 'FILLED') {
                    console.log(`✅ [${this.accountName}] 订单 ${orderId} 完全成交！总成交: ${totalExecuted}`);
                    return { success: true, orderInfo, filled: true, totalExecuted };
                }
                
                // 订单被取消或拒绝
                if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(orderInfo.status)) {
                    console.log(`❌ [${this.accountName}] 订单 ${orderId} 状态: ${orderInfo.status}, 已成交: ${totalExecuted}`);
                    return { success: false, orderInfo, filled: false, totalExecuted };
                }
                
                // 等待2秒后再次检查（更频繁检查以减少延迟）
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`[${this.accountName}] 查询订单状态失败:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        console.log(`⏰ [${this.accountName}] 监控订单 ${orderId} 超时, 已成交: ${totalExecuted}`);
        return { success: false, orderInfo: null, filled: false, timeout: true, totalExecuted };
    }
}

// 对冲交易工具类
class HedgeTool {
    constructor() {
        const globalProxy = normalizeProxyConfig(api.proxyUrl);
        const proxy1 = normalizeProxyConfig(api.api1?.proxyUrl) ?? globalProxy;
        const proxy2 = normalizeProxyConfig(api.api2?.proxyUrl) ?? globalProxy;

        this.account1 = new AsterFuturesAPI(api.api1.apiKey, api.api1.apiSecret, '账号1', proxy1);
        this.account2 = new AsterFuturesAPI(api.api2.apiKey, api.api2.apiSecret, '账号2', proxy2);
    }

    // 格式化时间
    formatTime() {
        return new Date().toLocaleString('zh-CN');
    }

    // 格式化交易数量为3位小数
    formatQuantity(quantity) {
        if (quantity === 0) return 0;
        return parseFloat(quantity.toFixed(3));
    }

    // 生成随机浮动值
    getRandomFloat(baseValue, minMultiple, maxMultiple, isQuantity = false) {
        // 生成minMultiple到maxMultiple之间的随机倍数
        const randomMultiple = minMultiple + Math.random() * (maxMultiple - minMultiple);
        // 应用到基础值
        const result = baseValue * randomMultiple;
        
        if (isQuantity) {
            // 如果是数量，保留3位有效数字
            return this.formatQuantity(result);
        } else {
            // 如果是时间，取整数
            return Math.round(result);
        }
    }

    // 设置杠杆
    async setLeverage(symbol, leverage) {
        console.log(`\n=== [${this.formatTime()}] 设置杠杆 ===`);
        console.log(`币种: ${symbol}, 杠杆: ${leverage}x`);

        try {
            const [result1, result2] = await Promise.allSettled([
                this.account1.setLeverage(symbol, leverage),
                this.account2.setLeverage(symbol, leverage)
            ]);

            if (result1.status === 'fulfilled') {
                console.log(`✅ 账号1 设置 ${leverage}x 杠杆成功`);
            } else {
                console.log(`❌ 账号1 设置杠杆失败:`, result1.reason?.message || '未知错误');
            }

            if (result2.status === 'fulfilled') {
                console.log(`✅ 账号2 设置 ${leverage}x 杠杆成功`);
            } else {
                console.log(`❌ 账号2 设置杠杆失败:`, result2.reason?.message || '未知错误');
            }

            return { result1, result2 };
        } catch (error) {
            console.error('设置杠杆失败:', error.message);
            throw error;
        }
    }

    // 对冲下单 - 账号1做多，账号2做空
    async hedgeOrder(config = {}) {
        // 从 api.js 读取配置，允许 config 参数覆盖
        const {
            symbol = api.symbol,
            quantity = api.quantity,
            leverage = api.leverage,
            orderType = 'MARKET',
            price = null,
            positionSide = 'BOTH'
        } = config;

        console.log(`\n🔄 === [${this.formatTime()}] 对冲下单 ===`);
        console.log(`配置参数:`);
        console.log(`- 币种: ${symbol}`);
        console.log(`- 数量: ${quantity}`);
        console.log(`- 杠杆: ${leverage}x`);
        console.log(`- 订单类型: ${orderType}`);
        console.log(`- 价格: ${price || '市价'}`);
        console.log(`- 持仓方向: ${positionSide}`);

        try {
            // 1. 获取当前价格
            const priceInfo = await this.account1.getPrice(symbol);
            console.log(`\n当前 ${symbol} 价格: ${priceInfo.price}`);

            // 2. 设置杠杆（如果指定）
            if (leverage) {
                await this.setLeverage(symbol, leverage);
            }

            // 3. 并行执行对冲下单
            console.log(`\n开始并行对冲下单...`);
            console.log(`账号1: 做多 ${quantity} ${symbol}`);
            console.log(`账号2: 做空 ${quantity} ${symbol}`);

            const [longResult, shortResult] = await Promise.allSettled([
                this.account1.buyOrder(symbol, quantity, price, orderType, positionSide),   // 账号1做多
                this.account2.sellOrder(symbol, quantity, price, orderType, positionSide)   // 账号2做空
            ]);

            // 4. 检查下单结果
            console.log(`\n=== 下单结果 ===`);
            if (longResult.status === 'fulfilled') {
                console.log(`✅ 账号1 做多下单成功`);
                console.log(`   订单ID: ${longResult.value.orderId}`);
                console.log(`   状态: ${longResult.value.status}`);
                console.log(`   数量: ${longResult.value.origQty} ${symbol}`);
            } else {
                console.error(`❌ 账号1 做多下单失败:`, longResult.reason?.message || '未知错误');
            }

            if (shortResult.status === 'fulfilled') {
                console.log(`✅ 账号2 做空下单成功`);
                console.log(`   订单ID: ${shortResult.value.orderId}`);
                console.log(`   状态: ${shortResult.value.status}`);
                console.log(`   数量: ${shortResult.value.origQty} ${symbol}`);
            } else {
                console.error(`❌ 账号2 做空下单失败:`, shortResult.reason?.message || '未知错误');
            }

            // 5. 检查是否有失败的订单
            const hasFailure = longResult.status === 'rejected' || shortResult.status === 'rejected';
            if (hasFailure) {
                console.log(`\n⚠️  部分订单失败，请检查上述错误信息`);
            } else {
                console.log(`\n🎉 对冲下单全部成功！`);
            }

            return {
                success: !hasFailure,
                longResult,
                shortResult,
                summary: {
                    symbol,
                    quantity,
                    leverage,
                    orderType,
                    price: priceInfo.price,
                    timestamp: this.formatTime()
                }
            };

        } catch (error) {
            console.error(`❌ 对冲下单失败:`, error.message);
            throw error;
        }
    }

    // 同时平仓
    async closeAllPositions(symbol = api.symbol) {
        console.log(`\n🔄 === [${this.formatTime()}] 同时平仓 ===`);
        console.log(`币种: ${symbol}`);

        try {
            // 1. 先查询当前持仓
            console.log(`\n查询当前持仓状态...`);
            const [positions1, positions2] = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol)
            ]);

            // 显示持仓信息
            if (positions1.status === 'fulfilled' && positions1.value) {
                const pos1 = positions1.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos1) {
                    console.log(`账号1 持仓: ${pos1.positionAmt} ${symbol}, 未实现盈亏: ${pos1.unRealizedProfit} USDT`);
                } else {
                    console.log(`账号1 无 ${symbol} 持仓`);
                }
            }

            if (positions2.status === 'fulfilled' && positions2.value) {
                const pos2 = positions2.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos2) {
                    console.log(`账号2 持仓: ${pos2.positionAmt} ${symbol}, 未实现盈亏: ${pos2.unRealizedProfit} USDT`);
                } else {
                    console.log(`账号2 无 ${symbol} 持仓`);
                }
            }

            // 2. 并行执行平仓
            console.log(`\n开始并行平仓...`);
            const [closeResult1, closeResult2] = await Promise.allSettled([
                this.account1.closePosition(symbol),
                this.account2.closePosition(symbol)
            ]);

            // 3. 检查平仓结果
            console.log(`\n=== 平仓结果 ===`);
            if (closeResult1.status === 'fulfilled') {
                if (closeResult1.value) {
                    console.log(`✅ 账号1 平仓成功`);
                    console.log(`   订单ID: ${closeResult1.value.orderId}`);
                    console.log(`   状态: ${closeResult1.value.status}`);
                } else {
                    console.log(`ℹ️  账号1 无需平仓（无持仓）`);
                }
            } else {
                console.error(`❌ 账号1 平仓失败:`, closeResult1.reason?.message || '未知错误');
            }

            if (closeResult2.status === 'fulfilled') {
                if (closeResult2.value) {
                    console.log(`✅ 账号2 平仓成功`);
                    console.log(`   订单ID: ${closeResult2.value.orderId}`);
                    console.log(`   状态: ${closeResult2.value.status}`);
                } else {
                    console.log(`ℹ️  账号2 无需平仓（无持仓）`);
                }
            } else {
                console.error(`❌ 账号2 平仓失败:`, closeResult2.reason?.message || '未知错误');
            }

            const hasFailure = closeResult1.status === 'rejected' || closeResult2.status === 'rejected';
            if (!hasFailure) {
                console.log(`\n🎉 平仓操作完成！`);
            }

            return {
                success: !hasFailure,
                closeResult1,
                closeResult2,
                timestamp: this.formatTime()
            };

        } catch (error) {
            console.error(`❌ 平仓操作失败:`, error.message);
            throw error;
        }
    }

    // 同时撤销所有挂单
    async cancelAllOpenOrders(symbol = api.symbol) {
        console.log(`\n🗑️ === [${this.formatTime()}] 同时撤销挂单 ===`);
        console.log(`币种: ${symbol}`);

        try {
            // 1. 先查询当前挂单
            console.log(`\n查询当前挂单状态...`);
            const [orders1, orders2] = await Promise.allSettled([
                this.account1.getOpenOrders(symbol),
                this.account2.getOpenOrders(symbol)
            ]);

            // 显示挂单信息
            let hasOrders = false;
            if (orders1.status === 'fulfilled' && orders1.value && orders1.value.length > 0) {
                console.log(`📋 账号1 当前挂单: ${orders1.value.length} 个`);
                orders1.value.forEach(order => {
                    console.log(`   订单ID: ${order.orderId}, 类型: ${order.side}, 数量: ${order.origQty}, 价格: ${order.price}`);
                });
                hasOrders = true;
            } else {
                console.log(`📋 账号1: 无挂单`);
            }

            if (orders2.status === 'fulfilled' && orders2.value && orders2.value.length > 0) {
                console.log(`📋 账号2 当前挂单: ${orders2.value.length} 个`);
                orders2.value.forEach(order => {
                    console.log(`   订单ID: ${order.orderId}, 类型: ${order.side}, 数量: ${order.origQty}, 价格: ${order.price}`);
                });
                hasOrders = true;
            } else {
                console.log(`📋 账号2: 无挂单`);
            }

            if (!hasOrders) {
                console.log(`ℹ️  两个账号都没有挂单，无需撤销`);
                return { success: true, message: '无挂单需要撤销' };
            }

            // 2. 并行执行撤单
            console.log(`\n开始并行撤销挂单...`);
            const [cancelResult1, cancelResult2] = await Promise.allSettled([
                this.account1.cancelAllOrders(symbol),
                this.account2.cancelAllOrders(symbol)
            ]);

            // 3. 检查撤单结果
            console.log(`\n=== 撤单结果 ===`);
            let successCount = 0;

            if (cancelResult1.status === 'fulfilled') {
                console.log(`✅ 账号1 撤单成功`);
                if (cancelResult1.value && Array.isArray(cancelResult1.value)) {
                    console.log(`   撤销订单数: ${cancelResult1.value.length}`);
                    cancelResult1.value.forEach(order => {
                        console.log(`   已撤销: ${order.orderId} (${order.side} ${order.origQty})`);
                    });
                }
                successCount++;
            } else {
                console.error(`❌ 账号1 撤单失败:`, cancelResult1.reason?.message || '未知错误');
            }

            if (cancelResult2.status === 'fulfilled') {
                console.log(`✅ 账号2 撤单成功`);
                if (cancelResult2.value && Array.isArray(cancelResult2.value)) {
                    console.log(`   撤销订单数: ${cancelResult2.value.length}`);
                    cancelResult2.value.forEach(order => {
                        console.log(`   已撤销: ${order.orderId} (${order.side} ${order.origQty})`);
                    });
                }
                successCount++;
            } else {
                console.error(`❌ 账号2 撤单失败:`, cancelResult2.reason?.message || '未知错误');
            }

            const allSuccess = successCount === 2;
            if (allSuccess) {
                console.log(`\n🎉 所有挂单撤销完成！`);
            } else {
                console.log(`\n⚠️  部分撤单失败，请检查上述错误信息`);
            }

            return {
                success: allSuccess,
                cancelResult1,
                cancelResult2,
                successCount,
                timestamp: this.formatTime()
            };

        } catch (error) {
            console.error(`❌ 撤单操作失败:`, error.message);
            throw error;
        }
    }

    // 智能平仓：账号2挂买1价平仓，账号1跟随市价平仓，2分钟未成交则重新挂单
    async smartClosePositions(symbol, maxWaitTime = 120000, maxRehangAttempts = 5) { // 默认2分钟超时，最多重挂5次
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        try {
            // 1. 获取当前持仓状态
            console.log(`\n📊 获取当前持仓状态...`);
            const [positions1, positions2] = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol)
            ]);

            let pos1Amount = 0, pos2Amount = 0;
            
            // 获取账号1持仓（多头）
            if (positions1.status === 'fulfilled' && positions1.value) {
                const pos1 = positions1.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos1) {
                    pos1Amount = parseFloat(pos1.positionAmt);
                    console.log(`📈 账号1 当前持仓: ${pos1Amount} ${symbol}`);
                } else {
                    console.log(`📈 账号1: 无持仓`);
                    return;
                }
            }

            // 获取账号2持仓（空头）
            if (positions2.status === 'fulfilled' && positions2.value) {
                const pos2 = positions2.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos2) {
                    pos2Amount = parseFloat(pos2.positionAmt);
                    console.log(`📉 账号2 当前持仓: ${pos2Amount} ${symbol}`);
                } else {
                    console.log(`📉 账号2: 无持仓`);
                    return;
                }
            }

            // 2. 初始化变量
            let totalClosed1 = 0; // 账号1已平仓数量（多头）
            let totalClosed2 = 0; // 账号2已平仓数量（空头）
            let remainingAmount = this.formatQuantity(Math.abs(pos2Amount)); // 剩余需要平仓的数量
            let rehangAttempts = 0;

            console.log(`\n开始智能平仓循环，最大重试次数: ${maxRehangAttempts}，每次超时: ${maxWaitTime/1000}秒`);

            // 3. 开始平仓循环
            while (remainingAmount > 0 && rehangAttempts < maxRehangAttempts) {
                rehangAttempts++;
                console.log(`\n📋 账号2挂买1价平仓中... (第${rehangAttempts}次尝试)`);
                console.log(`剩余待平仓数量: ${remainingAmount} ${symbol}`);

                try {
                    // 获取最新买1价
                    const currentBid1Price = await this.account1.getBid1Price(symbol);
                    console.log(`当前买1价格: ${currentBid1Price}`);

                    // 下限价单
                    const limitOrder = await this.account2.buyOrder(symbol, remainingAmount, currentBid1Price, 'LIMIT', 'BOTH');
                    console.log(`✅ 账号2 限价买入平空订单已提交: orderId=${limitOrder.orderId}, 价格=${currentBid1Price}, 数量=${remainingAmount}`);

                    // 监控订单状态
                    const monitorResult = await this.account2.monitorOrderWithRealTimeExecution(
                        symbol,
                        limitOrder.orderId,
                        async (newlyExecuted, currentExecuted, orderInfo) => {
                            // 处理部分成交
                            const formattedQty = this.formatQuantity(newlyExecuted);
                            console.log(`\n⚡ 账号2限价买入成交: ${formattedQty} ${symbol} @ ${currentBid1Price}`);
                            totalClosed2 += formattedQty;
                            
                            // 账号1对应市价卖出平多
                            try {
                                const closeOrder = await this.account1.sellOrder(symbol, formattedQty, null, 'MARKET', 'BOTH');
                                const actualClosed = this.formatQuantity(parseFloat(closeOrder.executedQty || formattedQty));
                                totalClosed1 += actualClosed;
                                console.log(`✅ 账号1 市价卖出平多成功: ${actualClosed} ${symbol}, orderId=${closeOrder.orderId}`);
                                console.log(`📊 平仓进度: 账号1(多)=${totalClosed1}/${pos1Amount}, 账号2(空)=${totalClosed2}/${Math.abs(pos2Amount)}`);
                            } catch (closeError) {
                                console.error(`❌ 账号1 市价平仓失败: ${closeError.message}`);
                            }
                        },
                        maxWaitTime
                    );

                    // 处理监控结果
                    if (monitorResult.success && monitorResult.filled) {
                        // 订单完全成交，更新剩余数量并退出循环
                        remainingAmount = 0;
                        console.log('🎉 账号2限价单完全成交！');
                        break;
                    } else {
                        // 订单未完全成交
                        const partiallyFilled = this.formatQuantity(monitorResult.totalExecuted || 0);
                        remainingAmount = this.formatQuantity(remainingAmount - partiallyFilled);
                        
                        if (remainingAmount > 0) {
                            console.log(`\n⏰ 订单在${maxWaitTime/1000}秒内未完全成交`);
                            console.log(`📊 已成交: ${partiallyFilled}, 剩余: ${remainingAmount}`);
                            
                            try {
                                // 撤销未完成的限价单
                                await this.account2.cancelOrder(symbol, limitOrder.orderId);
                                console.log('✅ 已撤销未完成的限价单，准备重新挂单...');
                                await sleep(1000); // 等待1秒
                            } catch (cancelError) {
                                console.error(`❌ 撤单失败: ${cancelError.message}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`❌ 平仓操作失败: ${error.message}`);
                    await sleep(3000); // 错误后等待3秒
                }
            }

            // 4. 如果达到最大重试次数，使用市价单平掉剩余仓位
            if (remainingAmount > 0) {
                console.log('\n⚠️ 达到最大重试次数或超时，使用市价单平掉剩余仓位...');
                try {
                    // 计算剩余需要平仓的数量
                    const remaining2 = this.formatQuantity(remainingAmount);
                    const remaining1 = this.formatQuantity(pos1Amount - totalClosed1);
                    
                    console.log(`\n🔄 市价同时平掉剩余仓位...`);
                    console.log(`剩余待平仓: 账号1(多)=${remaining1}, 账号2(空)=${remaining2}`);
                    
                    if (remaining2 > 0 || remaining1 > 0) {
                        // 同时市价平仓
                        const [finalClose1, finalClose2] = await Promise.allSettled([
                            remaining1 > 0 ? this.account1.sellOrder(symbol, remaining1, null, 'MARKET', 'BOTH') : null,
                            remaining2 > 0 ? this.account2.buyOrder(symbol, remaining2, null, 'MARKET', 'BOTH') : null
                        ]);

                        // 检查平仓结果
                        if (finalClose1.status === 'fulfilled' && finalClose1.value) {
                            console.log(`✅ 账号1 剩余多头市价卖出平仓成功: ${remaining1} ${symbol}`);
                        } else if (remaining1 > 0) {
                            console.error(`❌ 账号1 市价平仓失败:`, finalClose1.reason?.message || '未知错误');
                        }

                        if (finalClose2.status === 'fulfilled' && finalClose2.value) {
                            console.log(`✅ 账号2 剩余空头市价买入平仓成功: ${remaining2} ${symbol}`);
                        } else if (remaining2 > 0) {
                            console.error(`❌ 账号2 市价平仓失败:`, finalClose2.reason?.message || '未知错误');
                        }
                    }
                } catch (finalError) {
                    console.error(`❌ 市价平仓失败: ${finalError.message}`);
                }
            }

            // 5. 最后检查持仓状态
            console.log('\n📊 检查最终持仓状态...');
            await this.printPositionStatus(symbol);

        } catch (error) {
            console.error('❌ 智能平仓失败:', error.message);
            throw error;
        }
    }

    // 校验并修复对冲数量不匹配的问题
    async validateAndFixHedgeQuantity(symbol) {
        try {
            console.log(`🔍 正在检查两个账户的持仓数量...`);
            
            const [positions1, positions2] = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol)
            ]);

            let pos1Amount = 0, pos2Amount = 0;
            let pos1Info = null, pos2Info = null;

            // 获取账号1持仓
            if (positions1.status === 'fulfilled' && positions1.value) {
                pos1Info = positions1.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos1Info) {
                    pos1Amount = parseFloat(pos1Info.positionAmt);
                    console.log(`📈 账号1 持仓: ${pos1Amount} ${symbol}`);
                    console.log(`   开仓均价: ${pos1Info.entryPrice} USDT`);
                    console.log(`   未实现盈亏: ${pos1Info.unRealizedProfit} USDT`);
                } else {
                    console.log(`📈 账号1: 无持仓`);
                }
            } else {
                console.log(`❌ 账号1 持仓查询失败`);
                return;
            }

            // 获取账号2持仓
            if (positions2.status === 'fulfilled' && positions2.value) {
                pos2Info = positions2.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos2Info) {
                    pos2Amount = parseFloat(pos2Info.positionAmt);
                    console.log(`📉 账号2 持仓: ${pos2Amount} ${symbol}`);
                    console.log(`   开仓均价: ${pos2Info.entryPrice} USDT`);
                    console.log(`   未实现盈亏: ${pos2Info.unRealizedProfit} USDT`);
                } else {
                    console.log(`📉 账号2: 无持仓`);
                }
            } else {
                console.log(`❌ 账号2 持仓查询失败`);
                return;
            }

            // 计算理论对冲数量（账号1做多，账号2应该做空相同数量）
            const expectedPos2Amount = -pos1Amount; // 账号2应该是负数（做空）
            const quantityDiff = Math.abs(Math.abs(pos1Amount) - Math.abs(pos2Amount));
            
            console.log(`\n📊 数量校验:`);
            console.log(`账号1持仓: ${pos1Amount} ${symbol}`);
            console.log(`账号2持仓: ${pos2Amount} ${symbol}`);
            console.log(`理论对冲: ${expectedPos2Amount} ${symbol}`);
            console.log(`数量差异: ${quantityDiff.toFixed(6)} ${symbol}`);

            // 设置容差范围（0.001，考虑精度问题）
            const tolerance = 0.001;
            
            if (quantityDiff > tolerance) {
                console.log(`⚠️  检测到数量不匹配，差异: ${quantityDiff.toFixed(6)} ${symbol}`);
                console.log(`🔧 开始补充对冲...`);
                
                // 判断需要补充的方向和数量
                let fixQuantity = 0;
                let fixSide = '';
                
                if (Math.abs(pos1Amount) > Math.abs(pos2Amount)) {
                    // 账号1持仓多于账号2，需要账号2增加空头
                    fixQuantity = this.formatQuantity(Math.abs(pos1Amount) - Math.abs(pos2Amount));
                    fixSide = 'SELL'; // 账号2做空
                    console.log(`需要账号2补充做空: ${fixQuantity} ${symbol}`);
                    
                    try {
                        const fixOrder = await this.account2.sellOrder(symbol, fixQuantity, null, 'MARKET', 'BOTH');
                        console.log(`✅ 账号2 补充对冲成功: orderId=${fixOrder.orderId}`);
                    } catch (fixError) {
                        console.error(`❌ 账号2 补充对冲失败: ${fixError.message}`);
                    }
                    
                } else if (Math.abs(pos2Amount) > Math.abs(pos1Amount)) {
                    // 账号2持仓多于账号1，需要账号1增加多头
                    fixQuantity = this.formatQuantity(Math.abs(pos2Amount) - Math.abs(pos1Amount));
                    fixSide = 'BUY'; // 账号1做多
                    console.log(`需要账号1补充做多: ${fixQuantity} ${symbol}`);
                    
                    try {
                        const fixOrder = await this.account1.buyOrder(symbol, fixQuantity, null, 'MARKET', 'BOTH');
                        console.log(`✅ 账号1 补充对冲成功: orderId=${fixOrder.orderId}`);
                    } catch (fixError) {
                        console.error(`❌ 账号1 补充对冲失败: ${fixError.message}`);
                    }
                }
                
                // 再次检查修复后的持仓
                console.log(`\n🔍 补充对冲后，重新检查持仓...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒让订单生效
                await this.printPositionStatus(symbol);
                
            } else {
                console.log(`✅ 持仓数量匹配良好，差异在容差范围内`);
                
                // 计算总盈亏
                const pnl1 = pos1Info?.unRealizedProfit || 0;
                const pnl2 = pos2Info?.unRealizedProfit || 0;
                const totalPnl = parseFloat(pnl1) + parseFloat(pnl2);
                console.log(`💰 总未实现盈亏: ${totalPnl.toFixed(4)} USDT`);
            }
            
        } catch (error) {
            console.error(`❌ 数量校验失败: ${error.message}`);
            // 如果校验失败，仍然显示基本持仓信息
            await this.printPositionStatus(symbol);
        }
    }

    // 打印持仓状态的辅助方法
    async printPositionStatus(symbol) {
        try {
            const [positions1, positions2] = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol)
            ]);

            // 打印账号1持仓
            if (positions1.status === 'fulfilled' && positions1.value) {
                const pos1 = positions1.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos1) {
                    console.log(`📈 账号1 持仓: ${pos1.positionAmt} ${symbol}`);
                    console.log(`   开仓均价: ${pos1.entryPrice} USDT`);
                    console.log(`   未实现盈亏: ${pos1.unRealizedProfit} USDT`);
                    console.log(`   杠杆倍数: ${pos1.leverage}x`);
                } else {
                    console.log(`📈 账号1: 无持仓`);
                }
            } else {
                console.log(`❌ 账号1 持仓查询失败: ${positions1.reason?.message || '未知错误'}`);
            }

            // 打印账号2持仓
            if (positions2.status === 'fulfilled' && positions2.value) {
                const pos2 = positions2.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos2) {
                    console.log(`📉 账号2 持仓: ${pos2.positionAmt} ${symbol}`);
                    console.log(`   开仓均价: ${pos2.entryPrice} USDT`);
                    console.log(`   未实现盈亏: ${pos2.unRealizedProfit} USDT`);
                    console.log(`   杠杆倍数: ${pos2.leverage}x`);
                } else {
                    console.log(`📉 账号2: 无持仓`);
                }
            } else {
                console.log(`❌ 账号2 持仓查询失败: ${positions2.reason?.message || '未知错误'}`);
            }

            // 计算总盈亏
            const pnl1 = positions1.status === 'fulfilled' && positions1.value ? 
                (positions1.value.find(p => parseFloat(p.positionAmt) !== 0)?.unRealizedProfit || 0) : 0;
            const pnl2 = positions2.status === 'fulfilled' && positions2.value ? 
                (positions2.value.find(p => parseFloat(p.positionAmt) !== 0)?.unRealizedProfit || 0) : 0;
            const totalPnl = parseFloat(pnl1) + parseFloat(pnl2);
            console.log(`💰 总未实现盈亏: ${totalPnl.toFixed(4)} USDT`);
        } catch (posErr) {
            console.log(`❌ 查询持仓失败: ${posErr.message}`);
        }
    }

    // 查询持仓状态
    async checkPositions(symbol = api.symbol) {
        console.log(`\n📊 === [${this.formatTime()}] 持仓状态 ===`);
        
        try {
            const [positions1, positions2] = await Promise.allSettled([
                this.account1.getPositions(symbol),
                this.account2.getPositions(symbol)
            ]);

            console.log(`币种: ${symbol}`);

            // 显示账号1持仓
            if (positions1.status === 'fulfilled' && positions1.value) {
                const pos1 = positions1.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos1) {
                    console.log(`账号1 持仓: ${pos1.positionAmt} ${symbol}`);
                    console.log(`   开仓均价: ${pos1.entryPrice} USDT`);
                    console.log(`   未实现盈亏: ${pos1.unRealizedProfit} USDT`);
                    console.log(`   杠杆倍数: ${pos1.leverage}x`);
                    console.log(`   保证金模式: ${pos1.marginType}`);
                } else {
                    console.log(`账号1: 无持仓`);
                }
            }

            // 显示账号2持仓
            if (positions2.status === 'fulfilled' && positions2.value) {
                const pos2 = positions2.value.find(p => parseFloat(p.positionAmt) !== 0);
                if (pos2) {
                    console.log(`账号2 持仓: ${pos2.positionAmt} ${symbol}`);
                    console.log(`   开仓均价: ${pos2.entryPrice} USDT`);
                    console.log(`   未实现盈亏: ${pos2.unRealizedProfit} USDT`);
                    console.log(`   杠杆倍数: ${pos2.leverage}x`);
                    console.log(`   保证金模式: ${pos2.marginType}`);
                } else {
                    console.log(`账号2: 无持仓`);
                }
            }

            return { positions1, positions2 };
        } catch (error) {
            console.error('查询持仓失败:', error.message);
            throw error;
        }
    }

    // 对冲下单 - 账号1做多，账号2做空
    async hedgeOrder(config = {}) {
        const {
            symbol = api.symbol,
            quantity = api.quantity,
            leverage = api.leverage,
            orderType = 'MARKET',
            price = null,
            positionSide = 'BOTH'
        } = config;

        console.log(`\n🔄 === [${this.formatTime()}] 对冲下单 ===`);
        console.log(`配置参数:`);
        console.log(`- 币种: ${symbol}`);
        console.log(`- 数量: ${quantity}`);
        console.log(`- 杠杆: ${leverage}x`);
        console.log(`- 订单类型: ${orderType}`);
        console.log(`- 价格: ${price || '市价'}`);
        console.log(`- 持仓方向: ${positionSide}`);

        try {
            // 1. 获取当前价格
            const priceInfo = await this.account1.getPrice(symbol);
            console.log(`\n当前 ${symbol} 价格: ${priceInfo.price}`);

            // 2. 设置杠杆（如果指定）
            if (leverage) {
                await this.setLeverage(symbol, leverage);
            }

            // 3. 并行执行对冲下单
            console.log(`\n开始并行对冲下单...`);
            console.log(`账号1: 做多 ${quantity} ${symbol} (${orderType})`);
            console.log(`账号2: 做空 ${quantity} ${symbol} (${orderType})`);

            const [longResult, shortResult] = await Promise.allSettled([
                orderType === 'MARKET' 
                    ? this.account1.buyOrder(symbol, quantity, null, 'MARKET', positionSide)
                    : this.account1.buyOrder(symbol, quantity, price, 'LIMIT', positionSide),
                orderType === 'MARKET'
                    ? this.account2.sellOrder(symbol, quantity, null, 'MARKET', positionSide)
                    : this.account2.sellOrder(symbol, quantity, price, 'LIMIT', positionSide)
            ]);

            // 4. 检查下单结果
            console.log(`\n=== 下单结果 ===`);
            if (longResult.status === 'fulfilled') {
                console.log(`✅ 账号1 做多下单成功`);
                console.log(`   订单ID: ${longResult.value.orderId}`);
                console.log(`   状态: ${longResult.value.status}`);
                console.log(`   数量: ${longResult.value.origQty} ${symbol}`);
                if (longResult.value.price) {
                    console.log(`   价格: ${longResult.value.price}`);
                }
            } else {
                console.error(`❌ 账号1 做多下单失败:`, longResult.reason?.message || '未知错误');
            }

            if (shortResult.status === 'fulfilled') {
                console.log(`✅ 账号2 做空下单成功`);
                console.log(`   订单ID: ${shortResult.value.orderId}`);
                console.log(`   状态: ${shortResult.value.status}`);
                console.log(`   数量: ${shortResult.value.origQty} ${symbol}`);
                if (shortResult.value.price) {
                    console.log(`   价格: ${shortResult.value.price}`);
                }
            } else {
                console.error(`❌ 账号2 做空下单失败:`, shortResult.reason?.message || '未知错误');
            }

            // 5. 检查是否有失败的订单
            const hasFailure = longResult.status === 'rejected' || shortResult.status === 'rejected';
            if (hasFailure) {
                console.log(`\n⚠️  部分订单失败，请检查上述错误信息`);
            } else {
                console.log(`\n🎉 对冲下单全部成功！`);
                
                // 查询并打印持仓状态
                console.log(`\n📊 对冲完成，查询持仓状态...`);
                await this.printPositionStatus(symbol);
            }

            return {
                success: !hasFailure,
                longResult,
                shortResult,
                summary: {
                    symbol,
                    quantity,
                    orderType,
                    price: price || priceInfo.price,
                    timestamp: this.formatTime()
                }
            };

        } catch (error) {
            console.error(`❌ 对冲下单失败:`, error.message);
            throw error;
        }
    }

    // 智能对冲下单 - 账号1限价单，成交后账号2立即市价对冲
    async smartHedgeOrder(config = {}) {
        const {
            symbol = api.symbol,
            quantity = api.quantity,
            leverage = api.leverage,
            price = api.price,
            useBid1Price = false, // 新增：是否使用买1价格
            positionSide = 'BOTH',
            maxWaitTime = 300000 // 5分钟超时
        } = config;

        console.log(`\n🧠 === [${this.formatTime()}] 智能对冲下单 ===`);
        console.log(`配置参数:`);
        console.log(`- 币种: ${symbol}`);
        console.log(`- 数量: ${quantity}`);
        console.log(`- 杠杆: ${leverage}x`);
        console.log(`- 使用买1价格: ${useBid1Price ? '是' : '否'}`);
        if (!useBid1Price) {
            console.log(`- 限价价格: ${price}`);
        }
        console.log(`- 持仓方向: ${positionSide}`);
        console.log(`- 监控超时: ${maxWaitTime/1000}秒`);

        try {
            // 1. 获取当前市价和盘口信息
            const priceInfo = await this.account1.getPrice(symbol);
            console.log(`\n当前 ${symbol} 市价: ${priceInfo.price}`);
            
            let finalPrice = price;
            if (useBid1Price) {
                // 使用买1价格
                finalPrice = await this.account1.getBid1Price(symbol);
                console.log(`📊 使用买1价格: ${finalPrice}`);
            } else {
                console.log(`📋 使用配置价格: ${finalPrice} (${finalPrice > parseFloat(priceInfo.price) ? '高于' : '低于'}市价)`);
            }

            // 2. 设置杠杆
            if (leverage) {
                await this.setLeverage(symbol, leverage);
            }

            // 3. 账号1下限价单
            console.log(`\n📋 步骤1: 账号1下限价做多单 @ ${finalPrice}...`);
            const limitOrder = await this.account1.buyOrder(symbol, quantity, finalPrice, 'LIMIT', positionSide);
            
            console.log(`✅ 账号1 限价单下单成功:`);
            console.log(`   订单ID: ${limitOrder.orderId}`);
            console.log(`   状态: ${limitOrder.status}`);
            console.log(`   价格: ${limitOrder.price}`);
            console.log(`   数量: ${limitOrder.origQty}`);

            // 4. 监控账号1订单状态
            console.log(`\n👀 步骤2: 监控账号1订单成交状态...`);
            const monitorResult = await this.account1.monitorOrderStatus(symbol, limitOrder.orderId, maxWaitTime);

            if (!monitorResult.success) {
                if (monitorResult.timeout) {
                    console.log(`⏰ 监控超时，账号1订单未完全成交`);
                } else {
                    console.log(`❌ 账号1订单失败或被取消`);
                }
                return {
                    success: false,
                    limitOrder,
                    monitorResult,
                    hedgeOrder: null
                };
            }

            // 5. 账号1成交后，立即账号2市价对冲
            console.log(`\n⚡ 步骤3: 账号1已成交，立即触发账号2市价对冲...`);
            const executedQty = parseFloat(monitorResult.orderInfo.executedQty);
            
            console.log(`账号2 将做空 ${executedQty} ${symbol} (市价单)`);
            const hedgeOrder = await this.account2.sellOrder(symbol, executedQty, null, 'MARKET', positionSide);

            console.log(`✅ 账号2 市价对冲成功:`);
            console.log(`   订单ID: ${hedgeOrder.orderId}`);
            console.log(`   状态: ${hedgeOrder.status}`);
            console.log(`   数量: ${hedgeOrder.origQty}`);

            // 6. 显示最终结果
            console.log(`\n🎉 === 智能对冲完成 ===`);
            console.log(`账号1: 做多 ${monitorResult.orderInfo.executedQty} ${symbol} @ ${monitorResult.orderInfo.price || finalPrice}`);
            console.log(`账号2: 做空 ${hedgeOrder.origQty} ${symbol} @ 市价`);
            console.log(`对冲时间: ${this.formatTime()}`);

            return {
                success: true,
                limitOrder,
                monitorResult,
                hedgeOrder,
                summary: {
                    symbol,
                    quantity: executedQty,
                    limitPrice: finalPrice,
                    marketPrice: priceInfo.price,
                    executedPrice: monitorResult.orderInfo.price,
                    usedBid1Price: useBid1Price,
                    timestamp: this.formatTime()
                }
            };

        } catch (error) {
            console.error(`❌ 智能对冲失败:`, error.message);
            throw error;
        }
    }

    // 循环对冲：买一价限价买入 -> 成交即对冲 -> 持仓positionTime分钟 -> 同时平仓 -> 循环
    async loopHedge(config = {}) {
        const {
            symbol = api.symbol,
            leverage = api.leverage,
            basePositionTime = api.positionTime || 5, // 基础持仓时间（分钟）
            baseQuantity = api.quantity, // 基础交易数量
            positionSide = 'BOTH',
            rehangTimeout = 60000, // 1分钟未成交重挂
            maxRehangAttempts = 10 // 最大重挂次数
        } = config;

        console.log(`\n🔁 === [${this.formatTime()}] 启动循环对冲 ===`);
        console.log(`币种: ${symbol}`);
        console.log(`杠杆: ${leverage}x`);
        console.log(`基础持仓时间: ${basePositionTime} 分钟 (随机1-1.5倍)`);
        console.log(`基础交易数量: ${baseQuantity} (随机1-1.3倍)`);
        console.log(`重挂机制: ${rehangTimeout/1000}秒未成交自动重挂，最多重试${maxRehangAttempts}次`);
        let cycle = 0;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            // 设置杠杆
            await this.setLeverage(symbol, leverage);
        } catch (e) {
            console.log(`⚠️ 设置杠杆失败: ${e.message}, 将继续尝试下单`);
        }

        while (true) {
            cycle += 1;
            console.log(`\n=== 周期 #${cycle} 开始 (${this.formatTime()}) ===`);
            
            // 为本轮循环生成随机数量和持仓时间
            const quantity = this.getRandomFloat(baseQuantity, 1, 1.3, true); // 数量保留3位有效数字
            const positionTime = this.getRandomFloat(basePositionTime, 1, 1.5); // 时间取整数
            
            console.log(`本轮参数:`);
            console.log(`- 交易数量: ${quantity} (${(quantity/baseQuantity).toFixed(2)}倍)`);
            console.log(`- 持仓时间: ${positionTime} 分钟 (${(positionTime/basePositionTime).toFixed(2)}倍)`);
            
            let orderFilled = false;
            let totalHedged = 0;
            let hedgeOrders = [];
            let rehangAttempts = 0;
            
            try {
                // 智能重挂循环
                while (!orderFilled && rehangAttempts < maxRehangAttempts) {
                    rehangAttempts += 1;
                    console.log(`\n🎯 重挂尝试 #${rehangAttempts}/${maxRehangAttempts}`);
                    
                    // 1) 取最新买一价
                    const bid1Price = await this.account1.getBid1Price(symbol);
                    
                    // 2) 账号1下限价单（买一价）
                    const limitOrder = await this.account1.buyOrder(symbol, quantity, bid1Price, 'LIMIT', positionSide);
                    console.log(`账号1 限价买入提交: orderId=${limitOrder.orderId}, 价格=${bid1Price}, 数量=${quantity}`);

                    // 3) 实时监控账号1订单成交，边成交边对冲
                    const onPartialFill = async (newlyExecuted, currentExecuted, orderInfo) => {
                        // 账号2立刻对冲新成交的部分
                        const formattedQty = this.formatQuantity(newlyExecuted);
                        console.log(`⚡ 立即对冲新成交的 ${formattedQty} ${symbol}`);
                        try {
                            const hedgeOrder = await this.account2.sellOrder(symbol, formattedQty, null, 'MARKET', positionSide);
                            hedgeOrders.push(hedgeOrder);
                            
                            // 获取实际成交数量（可能与请求数量略有不同）
                            const actualHedgedQty = this.formatQuantity(parseFloat(hedgeOrder.origQty || hedgeOrder.executedQty || formattedQty));
                            totalHedged += actualHedgedQty;
                            
                            console.log(`✅ 账号2 部分对冲完成: ${actualHedgedQty} ${symbol}, orderId=${hedgeOrder.orderId}`);
                            console.log(`📊 累计对冲: ${totalHedged.toFixed(6)} ${symbol}`);
                        } catch (hedgeError) {
                            console.error(`❌ 部分对冲失败: ${hedgeError.message}`);
                            console.log(`⚠️  未对冲数量: ${newlyExecuted} ${symbol}`);
                        }
                    };

                    // 4) 监控订单状态，设置重挂超时时间
                    const monitorResult = await this.account1.monitorOrderWithRealTimeExecution(
                        symbol, 
                        limitOrder.orderId, 
                        onPartialFill, 
                        rehangTimeout // 使用重挂超时时间
                    );
                    
                    // 5) 检查订单结果
                    if (monitorResult.success && monitorResult.filled) {
                        // 订单完全成交，退出重挂循环
                        orderFilled = true;
                        console.log(`🎉 订单完全成交，退出重挂循环`);
                        
                        // 检查是否有未对冲的部分
                        const executedQty = monitorResult.totalExecuted || parseFloat(monitorResult.orderInfo.executedQty);
                        const unhedged = this.formatQuantity(executedQty - totalHedged);
                        if (unhedged > 0) {
                            console.log(`🔧 补充对冲剩余 ${unhedged} ${symbol}`);
                            try {
                                const finalHedge = await this.account2.sellOrder(symbol, unhedged, null, 'MARKET', positionSide);
                                hedgeOrders.push(finalHedge);
                                totalHedged += unhedged;
                                console.log(`✅ 补充对冲完成: orderId=${finalHedge.orderId}`);
                            } catch (finalHedgeError) {
                                console.error(`❌ 补充对冲失败: ${finalHedgeError.message}`);
                            }
                        }
                        
                        console.log(`✅ 账号1 总成交数量: ${executedQty}, 总对冲数量: ${totalHedged}`);
                        break;
                    } else {
                        // 订单未完全成交（超时或其他原因）
                        console.log(`⏰ 订单在${rehangTimeout/1000}秒内未完全成交`);
                        
                        if (monitorResult.totalExecuted > 0) {
                            // 有部分成交，记录但继续重挂剩余部分
                            console.log(`📊 已部分成交: ${monitorResult.totalExecuted}, 已对冲: ${totalHedged}`);
                            // 调整剩余数量
                            const remaining = api.quantity - monitorResult.totalExecuted;
                            if (remaining > 0) {
                                console.log(`🔄 剩余数量: ${remaining}, 准备重挂`);
                                api.quantity = remaining; // 临时调整数量
                            } else {
                                orderFilled = true;
                                break;
                            }
                        }
                        
                        if (rehangAttempts < maxRehangAttempts) {
                            // 撤销当前订单
                            console.log(`🗑️ 撤销当前订单: ${limitOrder.orderId}`);
                            try {
                                await this.account1.cancelOrder(symbol, limitOrder.orderId);
                                console.log(`✅ 订单撤销成功`);
                            } catch (cancelError) {
                                console.error(`❌ 订单撤销失败: ${cancelError.message}`);
                            }
                            
                            console.log(`🔄 等待2秒后重新挂单...`);
                            await sleep(2000);
                        } else {
                            console.log(`❌ 达到最大重挂次数 ${maxRehangAttempts}，跳过本周期`);
                            break;
                        }
                    }
                }
                
                // 如果没有成功的订单，跳过本周期
                if (!orderFilled) {
                    console.log(`⏭️ 周期 #${cycle} 未能成功下单，跳过`);
                    
                    // 查询并打印持仓状态
                    console.log(`\n📊 周期结束，查询当前持仓状态...`);
                    await this.printPositionStatus(symbol);
                    continue;
                }

                // 成功对冲完成，检查数量匹配并补充对冲
                console.log(`\n📊 实时对冲完成，检查持仓数量匹配...`);
                await this.validateAndFixHedgeQuantity(symbol);

                // 4) 持仓随机时间
                const holdMs = Math.max(1, positionTime) * 60 * 1000;
                console.log(`⏱️ 持仓 ${positionTime.toFixed(2)} 分钟...`);
                await sleep(holdMs);

                // 5) 智能平仓：账号2挂买1价，边成交边触发账号1市价平仓
                console.log(`\n🧹 开始智能平仓...`);
                await this.smartClosePositions(symbol);
                console.log(`🎉 智能平仓完成，准备进入下一轮`);

                const cooldownMinutes = Math.floor(Math.random() * 5) + 1;
                console.log(`🕒 周期冷却 ${cooldownMinutes} 分钟...`);
                await sleep(cooldownMinutes * 60 * 1000);
            } catch (err) {
                console.log(`❌ 周期 #${cycle} 失败: ${err.message}`);
                
                // 周期失败，查询并打印两个账户的持仓状态
                console.log(`\n📊 周期失败，查询当前持仓状态...`);
                await this.printPositionStatus(symbol);
                
                console.log(`🕒 休眠 5 秒后继续下一轮...`);
                await sleep(5000);
            }
        }
    }

    // 循环市价对冲：市价同时做多做空 -> 持仓positionTime分钟 -> 同时平仓 -> 循环
    async loopMarketHedge(config = {}) {
        const {
            symbol = api.symbol,
            quantity = api.quantity,
            leverage = api.leverage,
            positionTime = api.positionTime || 5, // 分钟
            positionSide = 'BOTH'
        } = config;

        console.log(`\n🔁 === [${this.formatTime()}] 启动循环市价对冲 ===`);
        console.log(`币种: ${symbol}, 杠杆: ${leverage}x, 持仓: ${positionTime} 分钟`);
        console.log(`每轮: 账号1市价做多 + 账号2市价做空 -> 持仓 -> 平仓 -> 循环`);
        let cycle = 0;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            // 设置杠杆
            await this.setLeverage(symbol, leverage);
        } catch (e) {
            console.log(`⚠️ 设置杠杆失败: ${e.message}, 将继续尝试下单`);
        }

        while (true) {
            cycle += 1;
            console.log(`\n=== 周期 #${cycle} 开始 (${this.formatTime()}) ===`);
            
            try {
                // 1) 获取当前价格
                const priceInfo = await this.account1.getPrice(symbol);
                console.log(`当前 ${symbol} 价格: ${priceInfo.price}`);

                // 2) 同时市价对冲下单
                console.log(`\n📋 步骤1: 同时市价对冲下单...`);
                console.log(`账号1: 市价做多 ${quantity} ${symbol}`);
                console.log(`账号2: 市价做空 ${quantity} ${symbol}`);

                const [longResult, shortResult] = await Promise.allSettled([
                    this.account1.buyOrder(symbol, quantity, null, 'MARKET', positionSide),   // 账号1做多
                    this.account2.sellOrder(symbol, quantity, null, 'MARKET', positionSide)   // 账号2做空
                ]);

                // 3) 检查下单结果
                console.log(`\n=== 下单结果 ===`);
                let orderSuccess = true;

                if (longResult.status === 'fulfilled') {
                    console.log(`✅ 账号1 市价做多成功`);
                    console.log(`   订单ID: ${longResult.value.orderId}`);
                    console.log(`   状态: ${longResult.value.status}`);
                    console.log(`   数量: ${longResult.value.origQty} ${symbol}`);
                } else {
                    console.error(`❌ 账号1 市价做多失败:`, longResult.reason?.message || '未知错误');
                    orderSuccess = false;
                }

                if (shortResult.status === 'fulfilled') {
                    console.log(`✅ 账号2 市价做空成功`);
                    console.log(`   订单ID: ${shortResult.value.orderId}`);
                    console.log(`   状态: ${shortResult.value.status}`);
                    console.log(`   数量: ${shortResult.value.origQty} ${symbol}`);
                } else {
                    console.error(`❌ 账号2 市价做空失败:`, shortResult.reason?.message || '未知错误');
                    orderSuccess = false;
                }

                if (!orderSuccess) {
                    console.log(`⏭️ 周期 #${cycle} 下单失败，跳过本轮`);
                    console.log(`🕒 休眠 5 秒后继续下一轮...`);
                    await sleep(5000);
                    continue;
                }

                console.log(`🎉 市价对冲下单全部成功！`);

                // 4) 查询并打印持仓状态
                console.log(`\n📊 市价对冲完成，查询持仓状态...`);
                await this.printPositionStatus(symbol);

                // 5) 持仓 positionTime 分钟
                const holdMs = Math.max(1, positionTime) * 60 * 1000;
                console.log(`⏱️ 持仓 ${positionTime} 分钟...`);
                await sleep(holdMs);

                // 6) 同时平仓
                console.log(`\n🧹 同时平仓中...`);
                const [closeResult1, closeResult2] = await Promise.allSettled([
                    this.account1.closePosition(symbol),
                    this.account2.closePosition(symbol)
                ]);

                // 检查平仓结果
                console.log(`\n=== 平仓结果 ===`);
                if (closeResult1.status === 'fulfilled') {
                    if (closeResult1.value) {
                        console.log(`✅ 账号1 平仓成功: 订单ID ${closeResult1.value.orderId}`);
                    } else {
                        console.log(`ℹ️  账号1 无需平仓（无持仓）`);
                    }
                } else {
                    console.error(`❌ 账号1 平仓失败:`, closeResult1.reason?.message || '未知错误');
                }

                if (closeResult2.status === 'fulfilled') {
                    if (closeResult2.value) {
                        console.log(`✅ 账号2 平仓成功: 订单ID ${closeResult2.value.orderId}`);
                    } else {
                        console.log(`ℹ️  账号2 无需平仓（无持仓）`);
                    }
                } else {
                    console.error(`❌ 账号2 平仓失败:`, closeResult2.reason?.message || '未知错误');
                }

                console.log(`🎉 周期 #${cycle} 完成，准备进入下一轮`);

            } catch (err) {
                console.log(`❌ 周期 #${cycle} 失败: ${err.message}`);
                
                // 周期失败，查询并打印两个账户的持仓状态
                console.log(`\n📊 周期失败，查询当前持仓状态...`);
                await this.printPositionStatus(symbol);
                
                console.log(`🕒 休眠 5 秒后继续下一轮...`);
                await sleep(5000);
            }
        }
    }

    // 显示帮助信息
    showHelp() {
        console.log(`
🛠️  Aster 对冲交易工具使用说明

当前配置 (来自 apiConfig.js):
- 币种: ${api.symbol}
- 数量: ${api.quantity}
- 杠杆: ${api.leverage}x
- 限价: ${api.price}
- 持仓: ${api.positionTime || 5} 分钟

主要功能：
1. hedgeOrder() - 对冲下单（账号1做多，账号2做空）
2. smartHedgeOrder() - 智能对冲（账号1限价单，成交后账号2立即市价对冲）
3. loopHedge() - 循环对冲（买一价->对冲->持仓->平仓->循环）
4. loopMarketHedge() - 循环市价对冲（市价对冲->持仓->平仓->循环）
5. cancelAllOpenOrders() - 同时撤销所有挂单
6. closeAllPositions() - 同时平仓
7. checkPositions() - 查询持仓状态
8. setLeverage() - 设置杠杆

智能对冲参数 (config):
{
    price: 112000,            // 限价价格 (默认从配置文件读取)
    useBid1Price: false,      // 是否使用买1价格 (实时盘口最高买价)
    maxWaitTime: 300000       // 监控超时时间，毫秒 (默认5分钟)
}

使用示例：
const tool = new HedgeTool();

// 1. 智能对冲 - 使用配置文件价格
await tool.smartHedgeOrder();

// 2. 智能对冲 - 使用买1价格
await tool.smartHedgeOrder({
    useBid1Price: true
});

// 3. 智能对冲 - 自定义价格和超时时间
await tool.smartHedgeOrder({
    price: 110000,
    maxWaitTime: 600000  // 10分钟
});

// 4. 传统对冲下单 - 市价单
await tool.hedgeOrder();

// 5. 循环市价对冲
await tool.loopMarketHedge();

// 6. 撤销所有挂单
await tool.cancelAllOpenOrders();

// 7. 查询持仓状态
await tool.checkPositions();

// 8. 平仓所有持仓
await tool.closeAllPositions();

注意：币种、数量、杠杆、价格都从 apiConfig.js 配置文件读取，如需修改请编辑该文件。
        `);
    }
}

// 交互式命令行界面
async function interactive() {
    const tool = new HedgeTool();
    const readline = require('readline');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt) => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };

    console.log('🚀 欢迎使用 Aster 对冲交易工具！');
    tool.showHelp();

    while (true) {
        console.log('\n' + '='.repeat(50));
        console.log('请选择操作:');
        console.log('1. 智能对冲下单 (账号1限价单，成交后账号2立即市价对冲)');
        console.log('2. 传统对冲下单 (账号1做多, 账号2做空)');
        console.log('3. 循环对冲 (买一价->对冲->持仓->平仓->循环)');
        console.log('4. 循环市价对冲 (市价对冲->持仓->平仓->循环)');
        console.log('5. 同时撤单');
        console.log('6. 同时平仓');
        console.log('7. 查询持仓状态');
        console.log('8. 设置杠杆');
        console.log('9. 显示帮助');
        console.log('10. 退出');

        const choice = await question('\n请输入选项 (1-10): ');

        try {
            switch (choice.trim()) {
                case '1':
                    // 智能对冲下单
                    console.log(`\n使用配置: 币种=${api.symbol}, 数量=${api.quantity}, 杠杆=${api.leverage}x, 限价=${api.price}`);
                    
                    // 价格选择
                    console.log('\n请选择限价价格类型:');
                    console.log('1. 使用配置文件价格 (推荐)');
                    console.log('2. 使用买1价格 (实时盘口最高买价)');
                    console.log('3. 自定义价格');
                    
                    const priceChoice = await question('请选择价格类型 (1-3): ');
                    let smartConfig = {};
                    
                    switch (priceChoice.trim()) {
                        case '1':
                            // 使用配置文件价格，无需额外设置
                            console.log(`✅ 将使用配置文件价格: ${api.price}`);
                            break;
                            
                        case '2':
                            // 使用买1价格
                            smartConfig.useBid1Price = true;
                            console.log(`✅ 将使用买1价格 (实时获取)`);
                            break;
                            
                        case '3':
                            // 自定义价格
                            const customPrice = parseFloat(await question(`请输入自定义限价价格: `));
                            if (!isNaN(customPrice)) {
                                smartConfig.price = customPrice;
                                console.log(`✅ 将使用自定义价格: ${customPrice}`);
                            } else {
                                console.log(`❌ 价格输入无效，将使用配置文件价格: ${api.price}`);
                            }
                            break;
                            
                        default:
                            console.log(`❌ 选择无效，将使用配置文件价格: ${api.price}`);
                            break;
                    }

                    // 超时时间设置
                    const customTimeout = await question('监控超时时间(秒，默认300): ');
                    if (customTimeout && !isNaN(parseInt(customTimeout))) {
                        smartConfig.maxWaitTime = parseInt(customTimeout) * 1000;
                    }

                    await tool.smartHedgeOrder(smartConfig);
                    break;

                case '2':
                    // 传统对冲下单
                    console.log(`\n使用配置: 币种=${api.symbol}, 数量=${api.quantity}, 杠杆=${api.leverage}x`);
                    const orderType = await question('订单类型 MARKET/LIMIT (默认 MARKET): ') || 'MARKET';
                    
                    let price = null;
                    if (orderType.toUpperCase() === 'LIMIT') {
                        price = parseFloat(await question('限价价格: '));
                    }

                    await tool.hedgeOrder({
                        orderType: orderType.toUpperCase(),
                        price
                    });
                    break;

                case '3':
                    // 循环对冲
                    console.log(`\n使用配置: 币种=${api.symbol}, 杠杆=${api.leverage}x, 持仓=${api.positionTime || 5} 分钟`);
                    console.log('按 Ctrl+C 可随时停止循环');
                    await tool.loopHedge();
                    break;

                case '4':
                    // 循环市价对冲
                    console.log(`\n使用配置: 币种=${api.symbol}, 杠杆=${api.leverage}x, 持仓=${api.positionTime || 5} 分钟`);
                    console.log('按 Ctrl+C 可随时停止循环');
                    await tool.loopMarketHedge();
                    break;

                case '5':
                    // 同时撤单
                    console.log(`\n使用配置币种: ${api.symbol}`);
                    await tool.cancelAllOpenOrders();
                    break;

                case '6':
                    // 同时平仓
                    console.log(`\n使用配置币种: ${api.symbol}`);
                    await tool.closeAllPositions();
                    break;

                case '7':
                    // 查询持仓
                    console.log(`\n使用配置币种: ${api.symbol}`);
                    await tool.checkPositions();
                    break;

                case '8':
                    // 设置杠杆
                    console.log(`\n使用配置: 币种=${api.symbol}, 杠杆=${api.leverage}x`);
                    await tool.setLeverage(api.symbol, api.leverage);
                    break;

                case '9':
                    // 显示帮助
                    tool.showHelp();
                    break;

                case '10':
                    // 退出
                    console.log('👋 再见！');
                    rl.close();
                    process.exit(0);
                    break;

                default:
                    console.log('❌ 无效选项，请重新选择');
                    break;
            }
        } catch (error) {
            console.error('❌ 操作失败:', error.message);
        }
    }
}

// 导出
module.exports = { HedgeTool, AsterFuturesAPI };

// 如果直接运行此文件，启动交互式界面
if (require.main === module) {
    interactive().catch(error => {
        console.error('程序执行失败:', error.message);
        process.exit(1);
    });
}
