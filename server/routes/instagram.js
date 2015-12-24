(function () {
    'use strict';

    var crypto = require('crypto');
    var bodyParser = require('body-parser');
    var r = require('rethinkdb');
    var config = require('../config');
    var router = require('express').Router();

    var lastUpdate = 0;

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

        config.logger.info('instagram is updated');
        config.logger.info(req.body);
        return;

        if (update.time - lastUpdate < 1) return;
        lastUpdate = update.time;

//        config.logger.info('POST request for /photo. object updated: ' + update.object_id);

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;

                //var recent = r.http(path)('data');
                //config.logger.info('data: ' + recent);
                //config.logger.info('Recent instagram pictures: ' + JSON.stringify(recent));
                //
                //var merged = recent.merge(function (item) {
                //    return {
                //        created_time: r.epochTime(item('created_time').coerceTo('number')),
                //        time: r.now(),
                //        place: r.point(
                //            item('location')('longitude'),
                //            item('location')('latitude')).default(null)
                //    }
                //});
                //
                //config.logger.info('Merged instagram pictures: ' + JSON.stringify(merged));

                var path = 'https://api.instagram.com/v1/tags/' + update.object_id + '/media/recent?client_id=' + config.instagram.client;

                return r.table('pictures').insert(r.http(path)('data')).run(conn, function (err, result) {
                    if (err) {
                        config.logger.error('Error while inserting pictures.');
                        config.logger.error(err);
                        throw err;
                    }
                    // errors are those which already exist. they are not inserted again. todo: possibly use the last time stamp to not get those from the recent query
                    config.logger.info('Inserted records: ' + result.inserted + ', errors: ' + result.errors);
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
