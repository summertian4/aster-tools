const api = require('./apiConfig');
const nodeFetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

class AsterFuturesAPI {
    constructor(apiKey, apiSecret, accountName = 'default') {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.accountName = accountName;
        this.baseURL = 'https://fapi.asterdex.com';
        // this.proxyUrl = 'http://127.0.0.1:1087';
        this.proxyUrl = null;
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
}

// 对冲交易工具类
class HedgeTool {
    constructor() {
        this.account1 = new AsterFuturesAPI(api.api1.apiKey, api.api1.apiSecret, '账号1');
        this.account2 = new AsterFuturesAPI(api.api2.apiKey, api.api2.apiSecret, '账号2');
    }

    // 格式化时间
    formatTime() {
        return new Date().toLocaleString('zh-CN');
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

    // 循环对冲：随机选择账号进行开仓和对冲 -> 成交即对冲 -> 持仓positionTime分钟 -> 同时平仓 -> 循环
    async loopHedge(config = {}) {
        const {
            symbol = api.symbol,
            leverage = api.leverage,
            positionTime = api.positionTime || 5, // 分钟
            positionSide = 'BOTH',
            maxWaitTime = 300000 // 限价单监控超时
        } = config;

        console.log(`\n🔁 === [${this.formatTime()}] 启动循环对冲 ===`);
        console.log(`币种: ${symbol}, 杠杆: ${leverage}x, 持仓: ${positionTime} 分钟`);
        console.log(`🎲 随机选择账号进行开仓和对冲`);
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
                // 随机选择账号1或账号2作为开仓账号
                const useAccount1ForLong = Math.random() < 0.5;
                const longAccount = useAccount1ForLong ? this.account1 : this.account2;
                const hedgeAccount = useAccount1ForLong ? this.account2 : this.account1;
                const longAccountName = useAccount1ForLong ? '账号1' : '账号2';
                const hedgeAccountName = useAccount1ForLong ? '账号2' : '账号1';
                
                console.log(`🎲 随机选择结果:`);
                console.log(`   ${longAccountName} - 开仓做多`);
                console.log(`   ${hedgeAccountName} - 对冲做空`);

                // 1) 取买一价
                const bid1Price = await longAccount.getBid1Price(symbol);
                // 随机选中的账号下限价单（买一价）
                const limitOrder = await longAccount.buyOrder(symbol, api.quantity, bid1Price, 'LIMIT', positionSide);
                console.log(`${longAccountName} 限价买入提交: orderId=${limitOrder.orderId}, 价格=${bid1Price}, 数量=${api.quantity}`);

                // 2) 监控开仓账号订单成交
                const monitorResult = await longAccount.monitorOrderStatus(symbol, limitOrder.orderId, maxWaitTime);
                if (!monitorResult.success) {
                    console.log(`⏭️ ${longAccountName}订单未完全成交，跳过本周期`);
                    continue;
                }

                const executedQty = parseFloat(monitorResult.orderInfo.executedQty);
                console.log(`✅ ${longAccountName} 成交数量: ${executedQty}`);

                // 3) 对冲账号立刻市价对冲（做空）
                const hedgeOrder = await hedgeAccount.sellOrder(symbol, executedQty, null, 'MARKET', positionSide);
                console.log(`✅ ${hedgeAccountName} 市价对冲完成: orderId=${hedgeOrder.orderId}`);

                // 4) 持仓 positionTime 分钟
                const holdMs = Math.max(1, positionTime) * 60 * 1000;
                console.log(`⏱️ 持仓 ${positionTime} 分钟...`);
                await sleep(holdMs);

                // 5) 同时平仓
                console.log(`\n🧹 同时平仓中...`);
                await Promise.allSettled([
                    this.account1.closePosition(symbol),
                    this.account2.closePosition(symbol)
                ]);
                console.log(`🎉 平仓完成，准备进入下一轮`);
            } catch (err) {
                console.log(`❌ 周期 #${cycle} 失败: ${err.message}`);
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
3. loopHedge() - 循环对冲（随机账号开仓->对冲->持仓->平仓->循环）
4. closeAllPositions() - 同时平仓
5. checkPositions() - 查询持仓状态
6. setLeverage() - 设置杠杆

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

// 5. 查询持仓状态
await tool.checkPositions();

// 6. 平仓所有持仓
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
        console.log('3. 循环对冲 (随机账号开仓->对冲->持仓->平仓->循环)');
        console.log('4. 同时平仓');
        console.log('5. 查询持仓状态');
        console.log('6. 设置杠杆');
        console.log('7. 显示帮助');
        console.log('8. 退出');

        const choice = await question('\n请输入选项 (1-8): ');

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
                    // 同时平仓
                    console.log(`\n使用配置币种: ${api.symbol}`);
                    await tool.closeAllPositions();
                    break;

                case '5':
                    // 查询持仓
                    console.log(`\n使用配置币种: ${api.symbol}`);
                    await tool.checkPositions();
                    break;

                case '6':
                    // 设置杠杆
                    console.log(`\n使用配置: 币种=${api.symbol}, 杠杆=${api.leverage}x`);
                    await tool.setLeverage(api.symbol, api.leverage);
                    break;

                case '7':
                    // 显示帮助
                    tool.showHelp();
                    break;

                case '8':
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