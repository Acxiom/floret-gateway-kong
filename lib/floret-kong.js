const rp = require("request-promise");
const url = require("url");
//const utils = require("../utils/utils");

let KongGateway;

{
    const _name = Symbol('name');
    const _url = Symbol('url');
    const _adminPort = Symbol('adminPort');
    const _proxyPort = Symbol('proxyPort');
    const _type = Symbol('type');

    KongGateway = class KongGateway {

        /**
         *
         * @param gatewayName
         * @param gatewayURL
         * @param gatewayAdminPort
         * @param gatewayProxyPort
         * @param gatewayType
         */
        constructor(gatewayName, gatewayURL, gatewayAdminPort, gatewayProxyPort, gatewayType) {
            this[_name] = gatewayName;
            this[_url] = gatewayURL;
            this[_adminPort] = gatewayAdminPort;
            this[_proxyPort] = gatewayProxyPort;
            this[_type] = gatewayType;
        }

        ensureProtocol(str, protocol = 'http') {
            return str.indexOf('://') < 0 ? `${protocol}://${str}` : str;
        }


        async discover(keyword, serviceName) {
            let routes = serviceName ? await this.getServiceRoutes(serviceName) : await this.getAllRoutes();

            return routes.filter((route) => {
                console.log(JSON.stringify(route))
                let matched = route.paths.filter((path) => {
                    return path.indexOf(keyword) !== -1
                });

                return matched.length > 0;
            })
        }

        async discoverChannels(serviceName) {
            return await this.getServiceRoutes(serviceName + '-channel');
        }

        async discoverSubscribers(serviceName, channelName) {
            let res = await this.discover('subscriber', `${serviceName}-subscriber`);

            res = res.map(routeObj => {
                let res = [];

                for (let i = 0; i < routeObj.paths.length; i++) {
                    if (routeObj.paths[i].indexOf(`/${serviceName}/channels/${channelName}/subscriber`) > -1) {
                        let path = routeObj.paths[i].split('/subscriber/')[1];
                        let subscriberService = path.split('/')[0];

                        res.push({
                            path: path,
                            methods: routeObj.methods,
                            service: subscriberService,
                            channelName: channelName,
                            name: routeObj.paths[i].split('/subscriptions/')[1]
                        });
                    }
                }

                return res;
            });

            return res || [];
        }

        async discoverServices() {
            // get all api's that's name begins with input
            let apis = await this.getAPIs();
            let services = [];
            if (apis && apis.filter) {
                services = apis.filter((api) => {
                    let uris = api.uris;
                    // todo: make this better.  create a separate service api so detection is easier
                    let parts = uris[0].split('/');

                    if (parts[parts.length - 1] === 'healthcheck') {
                        return true;
                    }
                    return false;
                });
            }
            return services;
        }

        async discoverServiceChannels(serviceName) {
            let prefix = serviceName + '_channels_';
            let channels = await this.discover(prefix);
            return channels;
        }

        async discoverAllChannels() {
            let apis = await this.getAPIs();
            let services = await this.discoverServices();
            let servicesObj = {};

            for (let i = 0; i < services.length; i++) {
                servicesObj[services[i].name] = {
                    "channels": await this.discoverServiceChannels(services[i].name)
                }
            }

            return servicesObj;
        }

        async discoverAPISpecs() {
            return await this.discover('api-spec.json');
        }

        async post(uri, payload, options) {
            let stdOptions = {
                method: 'post',
                uri: this.proxyURL + uri,
                header: {
                    'Content-Type': 'application/json'
                },
                body: payload
            };

            let mergedOptions = Object.assign({}, stdOptions, options);

            return await this.send(mergedOptions).then((res) => res.data).catch((e) => {
                console.log('err: ' + e.message)
            });
        }

        async get(uri, options) {
            let stdOptions = {
                'method': 'get',
                'uri': this.proxyURL + uri,
                'headers': {
                    'Accept': 'application/json'
                },
                'simple': false
            };

            let mergedOptions = Object.assign({}, stdOptions, options);
            let res = await this.send(mergedOptions).then((res) => res.data).catch((e) => {
                console.log('err: ' + e.message)
            });
            return res;
        }

        // ### API methods
        async getAPIs(apiName) {
            let options = {
                method: 'get',
                uri: this.adminURL + '/apis/',
                header: {
                    'Accept': 'application/json'
                }
            };

            let apis = await this.send(options).then((res) => res.data).catch((e) => {
                console.log('err: ' + e.message)
            });
            return apis || [];
        }

        async getAPI(name) {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'GET',
                uri: this.adminURL + '/apis/' + name
            };
            return await this.send(options);
        }

        async apiRequestByName(name, options) {
            options.uri = this.proxyURL + '/' + name;
            return await this.send(options);
        }

        async apiRequestByURI(uri, options) {

        }

        async getAPIsWithUpstreamURL(upstreamURL) {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'GET',
                uri: this.adminURL + '/apis/?upstream_url=' + upstreamURL
            };
            return await this.send(options);
        }

        async addService({name, protocol = 'http', host, port, path, retries = 5, connect_timeout = 60000, write_timeout = 60000, read_timeout = 60000}) {
            if (this.adminURL) {
                console.log('ADD SERVICE CALLED ')
                let service = await this.getServiceByName(name);
                console.log('service is ' + JSON.stringify(service));
                if (service) return service;

                let options = {
                    header: {
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: {
                        name,
                        host,
                        port,
                        protocol,
                        path,
                        retries,
                        connect_timeout,
                        write_timeout,
                        read_timeout
                    },
                    uri: this.adminURL + '/services'
                };
                return await this.send(options);
            } else {
                console.log('could not add service ' + name)
            }
        }

        async deleteAllServices() {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'GET',
                uri: this.adminURL + '/services'
            };

            let res = await this.send(options);
            let services = res.data || [];

            for (let i = 0; i < services.length; i++) {
                await this.deleteService(services[i].name);
            }
        }

        async deleteService(name) {
            await this.deleteServiceRoutes(name);

            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'DELETE',
                uri: this.adminURL + '/services/' + name
            };
            return await this.send(options);
        }

        async getServiceByName(name) {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'GET',
                uri: this.adminURL + '/services/' + name
            };

            return await this.send(options).then((res) => {
                return res;

            }).catch((e) => {
                if (e.statusCode === 404) {
                    console.log('404 ')
                    return false;
                }
                console.log('ERROR IN getservicebyname' + e.message);
            });
        }

        async createNewRoute({serviceId, protocols = ['http', 'https'], path = '/', strip_path = true, preserve_host = false}) {
            let routeEndpoint = this.adminURL + '/routes';
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'POST',
                body: {
                    service: {
                        "id": serviceId
                    },
                    protocols,
                    paths: [path],
                    strip_path,
                    preserve_host
                },
                uri: routeEndpoint
            };

            return await this.send(options);
        }

        async addRoute({serviceName, protocols = ['http', 'https'], methods, hosts, paths = [], strip_path = false, preserve_host = false}) {
            if (!paths.length > 0) {
                return;
            }
            console.log('addROUTE')

            let service = await this.getServiceByName(serviceName);
            if (!service) return;

            let routes = await this.getServiceRoutes(serviceName);
            let method = 'PATCH';

            if (routes.length === 0) {
                let newRoute = await this.createNewRoute({serviceId: service.id});
                routes = routes.concat(newRoute)
            }

            let route = routes[0];
            let routeEndpoint = this.adminURL + '/routes';

            routeEndpoint = method === 'PATCH' && route && route.id ? `${routeEndpoint}/${route.id}` : routeEndpoint;
            paths = paths.concat(route.paths);
            paths = [...new Set(paths)];

            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: method,
                body: {
                    service: {
                        "id": route.service.id
                    },
                    protocols,
                    methods,
                    hosts,
                    paths,
                    strip_path,
                    preserve_host
                },
                uri: routeEndpoint
            };
            return await this.send(options);
        }

        async deleteRoutePath(serviceName, channelName, subscriberName) {
            let routes = await this.getServiceRoutes(serviceName);

            for (let i = 0; i < routes.length; i++) {
                let route = routes[i];
                let subRoute = await this.getServiceRoutes(`${serviceName}-subscriber`);
                if (subRoute.length > 0) {
                    let paths = subRoute[0].paths.filter((path) => {
                        let idx = path.indexOf(`/subscriptions/${subscriberName}`);
                        return idx < 0 || idx !== (path.length - `/subscriptions/${subscriberName}`.length)
                    });

                    let options = {
                        header: {
                            'Content-Type': 'application/json'
                        },
                        method: 'PATCH',
                        uri: `${this.adminURL}/routes/${subRoute[0].id}`,
                        body: {
                            paths
                        }
                    };
                    return await this.send(options);
                }
            }
        }

        async deleteRoute(id) {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'DELETE',
                uri: this.adminURL + '/routes/' + id
            };

            return await this.send(options);
        }

        async getAllRoutes() {
            let options = {
                header: {
                    'Accept': 'application/json'
                },
                method: 'GET',
                uri: `${this.adminURL}/routes`
            };
            let resp = await this.send(options);
            return resp.data || [];
        }

        async getServiceRoutes(serviceName) {
            let options = {
                header: {
                    'Accept': 'application/json'
                },
                method: 'GET',
                uri: `${this.adminURL}/services/${serviceName}/routes`
            };
            let resp;
            try {
                resp = await this.send(options);
            } catch (e) {
                if (e.statusCode === 404) {
                    console.log('caght a 404')
                    resp = {
                        data: []
                    };
                }
            }

            return resp.data || [];
        }

        async deleteServiceRoutes(serviceName) {
            let routes = await this.getServiceRoutes(serviceName);

            if (routes.length > 0) {
                for (let i = 0; i < routes.length; i++) {
                    await this.deleteRoute(routes[i].id);
                }
            }
        }

        async addAPI(name, uri, upstreamURL, methods, protocol = 'http') {
            let urlObj = url.parse(`${protocol}://${upstreamURL}`);
            let options = {
                name,
                protocol: urlObj.protocol.split(':')[0],
                host: urlObj.hostname,
                port: Number(urlObj.port),
                path: urlObj.pathname
            };

            await this.addService(options);

            let routeOptions = {
                serviceName: name,
                protocols: [urlObj.protocol.split(':')[0]],
                methods,
                path: uri
            };

            await this.addRoute(routeOptions);
        }

        async deleteAPI(name) {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                method: 'DELETE',
                uri: this.adminURL + '/apis/' + name
            };
            return await this.send(options);
            ;
        }

        get name() {
            return this[_name];
        }

        get url() {
            return this[_url];
        }

        get adminURL() {
            return this.ensureProtocol(this[_url] + ':' + this[_adminPort]);
        }

        get adminPort() {
            return this[_adminPort];
        }

        get proxyPort() {
            return this[_proxyPort];
        }

        get proxyURL() {
            return this.ensureProtocol(this[_url] + ':' + this[_proxyPort]);
        }

        get type() {
            return this[_type];
        }

        isPrimary() {
            return this[_type] === 'primary';
        }

        get subscribers() {
            return this[subscribers];
        }

        async subscribeTo({targetService, targetChannel, subscriberService, subscriberName, subscriptionEndpoint}) {
            let parts = subscriptionEndpoint.split('/');
            parts.reverse();
            let name = parts[0];
            subscriberName = subscriberName || name;

            let body = {
                "service": subscriberService,
                "channel": targetChannel,
                "name": subscriberName,
                "url": subscriptionEndpoint
            };

            let options = {
                header: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                method: 'POST',
                body: body,
                uri: this.proxyURL + '/' + targetService + '/subscribe'
            };

            return await this.send(options);
        }

        async unsubscribe(serviceName, channelName, subscriberName) {
            let options = {
                header: {
                    'Content-Type': 'application/json'
                },
                body: {
                    "channelName": channelName,
                    "subscriberName": subscriberName
                },
                method: 'DELETE',
                uri: this.proxyURL + '/' + serviceName + '/subscribe'
            };
            return await this.send(options);
        }

        async loadSubscribers(name) {
            let apis = await this.getAPIs();
            let result = [];
            if (apis && apis.filter) {
                result = apis.filter((api) => {
                    let found = false;
                    if (api.uris && api.uris.length > 0) {

                        api.uris.map((uri) => {
                            let uriParts = uri.split('/');
                            uriParts.map((part, idx) => {
                                if (!found) {
                                    found = (part === name && uriParts[idx + 3] === 'subscribers' && uriParts[idx + 4]);
                                }
                            });
                        });
                    }
                    return found;
                });
            }

            return result;
        }

        async createChannelAPI(name, serviceURI, upstreamURL, methods) {
            let channelAPI = await this.addAPI(name, serviceURI, upstreamURL, methods);
            return channelAPI;
        }

        async createSubscriptionAPI(name, serviceURI, upstreamURL, methods) {
            let subAPI = {};
            try {
                subAPI = await this.addAPI(name, serviceURI, upstreamURL, methods);

            } catch (e) {
                if (!e.status === 409) {
                    console.log('error adding new subscriber api. ' + e.message);
                    throw e;
                }
            }
            ;

            return subAPI;

        }

        async deleteChannelAPI(name) {
            return await this.deleteAPI(name);
        }

        async gatewayHealthCheck() {
            let opts = {
                uri: this.adminURL + '/status',
                method: 'GET'
            };

            return await this.send(opts).then((res) => {
                return {
                    "status": "active",
                    "result": res
                }
            }).catch((e) => {
                console.log(e.message);
                console.log(e.stack)
                throw new Error("Floret Gateway is invalid: " + this.adminURL)
            });
        }

        async deleteAllAPIs() {
            let apis = await this.getAPIs();

            apis.map(async (api) => {
                await this.deleteAPI(api.name);
            });
        }

        async publishAPISpec(options) {
            return await this.send(options);
        }

        async send(options, protocol = 'http') {
            if (options && options.uri) {
                if (options.uri.indexOf('://') < 0) {
                    options.uri = `${protocol}://${options.uri}`;
                }
                options.json = typeof options.body !== 'string';
                options.method = options.method || 'get';

                return await rp(options).then((res) => {
                        return res;
                    }
                ).catch((e) => {
                    console.log('send exception ' + e.message)
                })
            } else {
                throw new Error('URI not specified');
            }
        }

        async apiAlreadyExists(url, name) {
            let options = {
                uri: url + '/' + name,
                method: 'get',
                json: true
            };

            return await this.send(options).then((res) => {
                return res;
            }).catch((e) => {
                console.log(e)
                throw e;
            })
        }

        async apiNeedsPatch(options) {
            let api = await this.apiAlreadyExists(options.uri, options.body.name);

            let patchBody;

            if (api) {
                let patch = {
                    "methods": options.body.methods,
                    "upstream_url": options.body.upstream_url,
                    "uris": options.body.uris
                };

                if (patch.methods && !areEqualArr(api.methods, patch.methods)) {
                    patchBody = patchBody || {};
                    patchBody.methods = patch.methods;
                }
                if (patch.upstream_url && api.upstream_url !== patch.upstream_url) {
                    patchBody = patchBody || {};
                    patchBody.upstream_url = patch.upstream_url;
                }
                if (patch.uris && !areEqualArr(api.uris, patch.uris)) {
                    patchBody = patchBody || {};
                    patchBody.uris = patch.uris;
                }

                let count = 0;
                for (let key in patchBody) count++;
                return count > 0 ? patchBody : false;
            }
            return false;
        }

        async resolveAPIConfict(options) {
            let patchBody = await this.apiNeedsPatch(options);
            let cnt = 0;
            for (let key in patchBody) {
                cnt++;
            }

            if (patchBody && cnt > 0) {
                let name = options.body.name;
                options.method = 'PATCH';
                options.body = patchBody;
                options.uri = options.uri + '/' + name;

                await this.send(options).then((res) => {
                    console.log(res.name + ' was patched');
                }).catch((e) => {
                    console.log("could not patch " + options.body.name);
                    console.log(e.message)
                })
            }
        }

        async handlePromiseRejection(options, e) {
            console.log('in handlePromiseRejections')
            if (e.statusCode === 409) {
                // get the resource
                if (options.body.name) {
                    await this.resolveAPIConfict(options).then(() => {
                        console.log('evaluated any api change')
                    });
                } else {
                    console.log('409 for nameless ' + JSON.stringify(options))
                }
            }
            if (e.statusCode !== 409) {
                console.log('e.status: ' + e.statusCode);
                console.log(e.message)
                console.log(e.stack)
                throw e;
            }
        };

        arrayToObject(arr) {
            if (!arr.reduce) {
                console.log('tried to reduce ' + JSON.stringify(arr))
            }
            let newObj = arr.reduce((acc, val) => {
                acc[val] = 0;
                return acc;
            }, {});
            return newObj;
        }

        areEqualObj(obj1, obj2) {

            for (let key in obj1) {
                if (!obj2[key]) {
                    return false;
                }
            }
            for (let key in obj2) {
                if (!obj1[key]) {
                    return false;
                }
            }
            return true;
        }

        areEqualArr(arr1, arr2) {
            return this.areEqualObj(this.arrayToObject(arr1), this.arrayToObject(arr2))
        }
    }
}

module.exports = KongGateway;