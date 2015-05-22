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
                if(err.name === 'TokenExpiredError'){
                    return res.status(401).send({message: 'Token has expired'});
                } else{
                    return res.status(401).send({message: 'Invalid token'});
                }
            }

            req.user = decoded.sub;
            next();
        });
    }

    module.exports = ensureAuthenticated;
})();
