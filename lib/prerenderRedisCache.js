/**
 * Basic Config Variables
 * redis_url (string) - Redis hostname (defaults to localhost)
 * ttl (int) - TTL on keys set in redis (defaults to 1 day)
 */
var REDIS_URL = process.env.REDISTOGO_URL ||
    process.env.REDISCLOUD_URL ||
    process.env.REDISGREEN_URL ||
    process.env.REDIS_URL ||
    'redis://127.0.0.1:6379';

var url = require('url');
var TTL = process.env.PAGE_TTL || 864000;

// Parse out the connection vars from the env string.
var connection = url.parse(REDIS_URL);
var redis = require('redis');
var client = redis.createClient(connection.port, connection.hostname);
var redisOnline = false;

var STATUS_CODES_TO_CACHE = {
    200: true,
    203: true,
    204: true,
    206: true,
    300: true,
    301: true,
    404: true,
    405: true,
    410: true,
    414: true,
    501: true
};

// Make redis connection
// Select Redis database, parsed from the URL
connection.path = (connection.pathname || '/').slice(1);
connection.database = connection.path.length ? connection.path : '0';
client.select(connection.database);

// Parse out password from the connection string
if (connection.auth) {
    client.auth(connection.auth.split(':')[1]);
}

// Catch all error handler. If redis breaks for any reason it will be reported here.
client.on('error', function (error) {
    console.warn('Redis Cache Error: ' + error);
});

client.on('ready', function () {
    redisOnline = true;
    console.log('Redis Cache Connected');
});

client.on('end', function () {
    redisOnline = false;
    console.warn(
        'Redis Cache Conncetion Closed. Will now bypass redis until it\'s back.'
    );
});

module.exports = {
beforePhantomRequest: function (req, res, next) {
  console.log("beforePhantomRequest ",req.method,redisOnline,req.prerender.url);
        if (req.method !== 'GET' || !redisOnline) {
            return next();
        }
        //console.log("Trying "+req.prerender.url);
        client.get(req.prerender.url, function (error, result) {
            if (!error && result) {
                var response = JSON.parse(result);
                var headers = response.headers;
                //console.log(headers);
                var key;

                for (key in headers) {
                  var item = headers[key];
                  //console.log("Item",item,item.name,item.value);
                  try{
                    res.setHeader(item.name, item.value);
                  }catch(e){
                    console.log(`Cannot set header ${item.name}`);
                  }
                }
                res.send(response.statusCode, response.content);
            } else {
                console.warn(error);
                next();
            }
        });
    },

    afterPhantomRequest: function (req, res, next) {
        console.log("afterPhantomRequest", req.prerender.url);
        if (!redisOnline || !STATUS_CODES_TO_CACHE[req.prerender.statusCode]) {
            return next();
        }

        var key = req.prerender.url;
        var response = {
            statusCode: req.prerender.statusCode,
            content: req.prerender.documentHTML.toString(),
            headers: req.prerender.headers
        };
        client.set(key, JSON.stringify(response), function (error, reply) {
            // If library set to cache set an expiry on the key.
            if (!error && reply && TTL) {
                client.expire(key, TTL, function (error, didSetExpiry) {
                    if (!error && !didSetExpiry) {
                        console.warn('Could not set expiry for "' + key + '"');
                    }
                });
            }else{
              console.warn(error);
            }
        });

        next();
    }
};
