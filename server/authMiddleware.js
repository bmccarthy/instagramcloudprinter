(function () {
    'use strict';

    var jwt = require('jsonwebtoken');
    var config = require('./config');
    var q = require('q');
    var r = require('rethinkdb');

    function getUser(id) {
        var deferred = q.defer();

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;
                return r.table('users').get(id).run(conn, function (err, user) {
                    if (err) {
                        deferred.reject(err);
                        return q.reject(err);
                    }

                    if (user == null) {
                        deferred.reject('No user found');
                        return q.reject('No user found');
                    }

                    deferred.resolve(user);
                });

            }).finally(function () {
                if (conn) conn.close();
            });

        return deferred.promise;
    }

    function ensureAuthenticated(req, res, next) {
        if (!req.headers.authorization) {
            return res.status(401).send({message: 'Please make sure your request has an Authorization header'});
        }
        var token = req.headers.authorization.split(' ')[1];

        jwt.verify(token, config.TOKEN_SECRET, function (err, decoded) {
            if (err) {
                return res.status(401).send(err);
            }

            getUser(decoded.sub)
                .then(function (user) {
                    req.user = user;
                    next();
                })
                .catch(function (err) {
                    return res.status(401).send(err);
                });
        });
    }

    module.exports = ensureAuthenticated;
})();
