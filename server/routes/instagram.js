(function () {
    'use strict';

    var crypto = require('crypto');
    var bodyParser = require('body-parser');
    var r = require('rethinkdb');
    var config = require('../config');
    var router = require('express').Router();

    router.get('/photo', function (req, res) {
        if (req.query['hub.verify_token'] == config.instagram.verify) {
            res.send(req.query['hub.challenge']);
        } else {
            config.logger.error('token verification incorrect');
            res.status(500).json({err: 'Verify token incorrect'});
        }
    });

    router.use(bodyParser.json({
        verify: function (req, res, buf) {
            var hmac = crypto.createHmac('sha1', config.instagram.secret);
            var hash = hmac.update(buf).digest('hex');

            if (req.header('X-Hub-Signature') == hash) {
                req.validOrigin = true;
            }
        }
    }));

    router.post('/photo', function (req, res) {
        if (!req.validOrigin) {
            config.logger.error('Invalid signature in POST /api/instagram/photo');
            return res.status(500).json({err: 'Invalid signature'});
        }

        var update = req.body[0];
        res.json({success: true, kind: update.object});

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;

                var path = 'https://api.instagram.com/v1/tags/' + update.object_id + '/media/recent?client_id=' + config.instagram.client;

                return r.table('pictures').insert(r.http(path)('data')).run(conn, function (err, result) {
                    if (err) {
                        config.logger.error('Error while inserting pictures.');
                        config.logger.error(err);
                        throw err;
                    }

                    // errors are those which already exist. they are not inserted again. todo: possibly use the last time stamp to not get those from the recent query
                    // config.logger.info('Inserted records: ' + result.inserted + ', errors: ' + result.errors);
                });
            })
            .error(function (err) {
                config.logger.error(err);
            })
            .finally(function () {
                if (conn) conn.close();
            });
    });

    module.exports = router;
})();
