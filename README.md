# floret-gateway-kong

Gateway adapter for floret.  Use this module to connect floret to a Kong API Gateway.



# API

```js
const Floret = require('floret');
let floret = new Floret();
let Gateway = floret.Gateway;
let gw = new Gateway('gw', 'http://127.0.0.1', 8001, 8000, 'primary');

// * delete a single service and routes
gw.deleteService('serviceName').catch((e) => console.log(e));

// * delete all services/routes
// gw.deleteAllServices().catch((e) => console.log(e));
```