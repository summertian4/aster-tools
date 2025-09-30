const config = {
   api1: {
   apiKey: '',
   apiSecret: '',
    proxy: {
      enabled: false,
      url: 'http://127.0.0.1:1087'
    }
   },
   api2: {
   apiKey: '',
   apiSecret: '',
    proxy: {
      enabled: false,
      url: 'http://127.0.0.1:1088'
    }
   },
   api3: {
   apiKey: '',
   apiSecret: '',
    proxy: {
      enabled: false,
      url: 'http://127.0.0.1:1089'
    }
   },
   symbol: 'BTCUSDT',
   leverage: 20,
   quantity: 0.005,
   price: 112000,
   positionTime: { min: 30, max: 60 }, // 持仓时间(单位秒) - 随机30-60秒
   // 随机金额范围配置
   minQuantity: 0.001,  // 最小下单数量
   maxQuantity: 0.01,   // 最大下单数量
   
   // 安全配置
   maxPositionValue: 10000,  // 最大持仓价值(USDT) - 防止过度杠杆
   minAccountBalance: 100,  // 最小账户余额要求(USDT)
}

module.exports = config;
