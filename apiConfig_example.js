const config = {
   proxyUrl: null,
   api1: {
      apiKey: '',
      apiSecret: '',
      proxyUrl: null,
   },
   api2: {
      apiKey: '',
      apiSecret: '',
      proxyUrl: {
         url: 'http://127.0.0.1:1087',
         username: 'your-proxy-user',
         password: 'your-proxy-password',
      },
   },
   symbol: 'BTCUSDT',
   leverage: 20,
   quantity: 0.007,
   price: 113125,
   positionTime: 20, // 持仓时间(单位分钟)
}

module.exports = config;
