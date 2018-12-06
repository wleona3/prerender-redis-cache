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
var TTL = process.env.PAGE_TTL || 86400;

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

var get_cache_key = function(req) {
    return req.prerender.url+(req.headers[process.env.CACHE_HEADER_KEY] || '');
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
    requestReceived: function (req, res, next) {
        //
        if (req.method !== 'GET' || !redisOnline) {
            return next();
        }

        client.get(get_cache_key(req), function (error, result) {
            if (!error && result) {
                var response = JSON.parse(result);
                var headers = response.headers;
                var key;

                for (key in headers) {
                    if (headers.hasOwnProperty(key)) {
                        try{
                            res.setHeader(key, headers[key]);
                        }catch(e){
                            console.warn("Cannot set header");
                        }
                    }
                }
                res.send(response.statusCode, response.content);
            } else {
                next();
            }
        });
    },

    pageLoaded: function (req, res, next) {
        if (!redisOnline || !STATUS_CODES_TO_CACHE[req.prerender.statusCode]) {
            return next();
        }

        var key = get_cache_key(req);
        var response = {
            statusCode: req.prerender.statusCode,
            content: req.prerender.content.toString(),
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
            }
        });

        next();
    }
};
