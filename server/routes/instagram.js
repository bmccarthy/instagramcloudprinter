(function () {
    'use strict';

    var crypto = require('crypto');
    var bodyParser = require('body-parser');
    var r = require('rethinkdb');
    var config = require('../config');
    var ig = require('../instagram-helper');
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

        ig.getRecent(update.object_id)
            .then(function (recent) {

                var conn;
                r.connect(config.database)
                    .then(function (c) {
                        conn = c;
                        r.table('pictures').insert(recent).run(conn);
                    })
                    .finally(function () {
                        if (conn) conn.close();
                    });
            });
    });

    module.exports = router;
})();
