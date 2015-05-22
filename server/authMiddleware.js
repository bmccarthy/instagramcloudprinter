(function () {
    'use strict';

    var jwt = require('jsonwebtoken');
    var config = require('./config');

    function ensureAuthenticated(req, res, next) {
        if (!req.headers.authorization) {
            return res.status(401).send({message: 'Please make sure your request has an Authorization header'});
        }
        var token = req.headers.authorization.split(' ')[1];

        jwt.verify(token, config.TOKEN_SECRET, function (err, decoded) {
            if (err) {
                return res.status(401).send(err);
            }

            req.user = decoded.sub;
            next();
        });
    }

    module.exports = ensureAuthenticated;
})();
