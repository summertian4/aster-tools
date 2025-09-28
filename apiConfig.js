const config = {
   api1: {
    apiKey: '0369dd9b3ea7254734fc3ef1dddca22aca180eabaccbe8cda6a797c2d5a4df36',
    apiSecret: '4e1bf8700d828d546a5878f68f4941d42857cd630c963d61bb0af4e8a69a77d9',
    proxy: {
      enabled: false,
      url: 'http://127.0.0.1:1087'
    }
   },
   api2: {
    apiKey: 'e9524af5857cfb68102aba154898415e06568a7677a2ce999df90a5a0521ac84',
    apiSecret: '8f711b682d79633641a13a0c74e457f1641e789d343fa869a114ccb8128fd707',
    proxy: {
      enabled: false,
      url: 'http://127.0.0.1:1088'
    }
   },
   api3: {
    apiKey: 'b634f9330265687569536358e9acf21f8dc0ba7e1e15afcb3f4c6ce140110529',
    apiSecret: '6571e4deca3b92fddf6210efbe2f0c8fa085a4f31e49dfa7c5b4809b3c8a0599',
    proxy: {
      enabled: false,
      url: 'http://127.0.0.1:1089'
    }
   },
   symbol: 'BTCUSDT',
   leverage: 20,
   quantity: 0.005,
   price: 112000,
   positionTime: 10, // 持仓时间(单位分钟)
   // 随机金额范围配置
   minQuantity: 0.001,  // 最小下单数量
   maxQuantity: 0.01,   // 最大下单数量
   
   // 安全配置
   maxPositionValue: 10000,  // 最大持仓价值(USDT) - 防止过度杠杆
   minAccountBalance: 100,  // 最小账户余额要求(USDT)
}

module.exports = config;
