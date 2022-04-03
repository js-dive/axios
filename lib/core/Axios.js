'use strict';

var utils = require('./../utils');
var buildURL = require('../helpers/buildURL');
var InterceptorManager = require('./InterceptorManager');
var dispatchRequest = require('./dispatchRequest');
var mergeConfig = require('./mergeConfig');
var validator = require('../helpers/validator');

var validators = validator.validators;
/**
 * Create a new instance of Axios
 *
 * @param {Object} instanceConfig The default config for the instance
 */
function Axios(instanceConfig) {
  this.defaults = instanceConfig;
  this.interceptors = {
    request: new InterceptorManager(),
    response: new InterceptorManager()
  };
}

/**
 * Dispatch a request
 *
 * @param {Object} config The config specific for this request (merged with this.defaults)
 */
Axios.prototype.request = function request(config) {
  /*eslint no-param-reassign:0*/
  // Allow for axios('example/url'[, config]) a la fetch API
  // 判断参数config的类型
  if (typeof config === 'string') {
    config = arguments[1] || {};
    config.url = arguments[0];
  } else {
    config = config || {};
  }

  // 将归一化过后的传入的配置与默认配置进行合并
  config = mergeConfig(this.defaults, config);

  // Set config.method
  // 判断要使用的请求方法
  if (config.method) {
    // 从配置中拿
    config.method = config.method.toLowerCase();
  } else if (this.defaults.method) {
    // 从类的默认配置中拿
    config.method = this.defaults.method.toLowerCase();
  } else {
    // 实在拿不到，直接使用get
    config.method = 'get';
  }

  var transitional = config.transitional;

  if (transitional !== undefined) {
    validator.assertOptions(transitional, {
      silentJSONParsing: validators.transitional(validators.boolean, '1.0.0'),
      forcedJSONParsing: validators.transitional(validators.boolean, '1.0.0'),
      clarifyTimeoutError: validators.transitional(validators.boolean, '1.0.0')
    }, false);
  }

  // filter out skipped interceptors
  var requestInterceptorChain = [];
  var synchronousRequestInterceptors = true;
  this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
    // 如果某个请求拦截器的配置中，runWhen 为函数，且 runWhen() 执行后得到 false，那么就不必使用这个请求拦截器
    if (typeof interceptor.runWhen === 'function' && interceptor.runWhen(config) === false) {
      return;
    }

    // 请求拦截器遍历完以后，如果所有拦截器都是同步拦截器，那么就把 synchronousRequestInterceptors 设置为 true
    // 也就意味着整个请求处理拦截器可以使用同步的方式来处理
    synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous;

    requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  var responseInterceptorChain = [];
  this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
    responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
  });

  var promise;

  // 如果是异步的请求拦截器 -- 通常都是这种情况
  if (!synchronousRequestInterceptors) {
    // 拦截器队列
    var chain = [dispatchRequest, undefined];

    // 将请求拦截器插入队列前方
    Array.prototype.unshift.apply(chain, requestInterceptorChain);
    // 将响应拦截器插入队列后方
    chain = chain.concat(responseInterceptorChain);

    promise = Promise.resolve(config); // 使用Promise包一下config，供拦截器队列中的各个拦截器使用
    while (chain.length) {
      // 队列中的拦截器从上方拦截器队列（数组）中一对一对作为 [resolve, reject] 出队，并附加到 Promise then 链式调用后方
      promise = promise.then(chain.shift(), chain.shift());
    }

    // 返回这个Promise
    return promise;
  }

  // 如果是同步的请求拦截器
  var newConfig = config;
  // 就不使用promise来包裹拦截器了
  while (requestInterceptorChain.length) {
    var onFulfilled = requestInterceptorChain.shift();
    var onRejected = requestInterceptorChain.shift();
    try {
      newConfig = onFulfilled(newConfig);
    } catch (error) {
      onRejected(error);
      break;
    }
  }

  try {
    promise = dispatchRequest(newConfig);
  } catch (error) {
    return Promise.reject(error);
  }

  while (responseInterceptorChain.length) {
    promise = promise.then(responseInterceptorChain.shift(), responseInterceptorChain.shift());
  }

  return promise;
};

Axios.prototype.getUri = function getUri(config) {
  config = mergeConfig(this.defaults, config);
  return buildURL(config.url, config.params, config.paramsSerializer).replace(/^\?/, '');
};

// Provide aliases for supported request methods
utils.forEach(['delete', 'get', 'head', 'options'], function forEachMethodNoData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: (config || {}).data
    }));
  };
});

utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, data, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: data
    }));
  };
});

module.exports = Axios;
