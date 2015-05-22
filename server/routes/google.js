(function () {
    'use strict';

    var moment = require('moment');
    var jwt = require('jwt-simple');

    var config = require('../config');
    var bodyParser = require('body-parser');
    var google = require('googleapis');
    var OAuth2 = google.auth.OAuth2;
    var plus = google.plus('v1');
    var r = require('rethinkdb');
    var fs = require('fs');
    var q = require('q');
    var ensureAuthenticated = require('../authMiddleware');
    var printer = require('../printer');

    var router = require('express').Router();

    router.use(bodyParser.json());

    var oauth2Client = new OAuth2(config.google.client, config.google.secret, config.google.redirect);

    router.post('/callback', function (req, res) {
        oauth2Client.getToken(req.body.code, function (err, tokens) {
            if (err) {
                return res.status(400).send({reason: 'Error getting token from code.', message: err});
            }

            oauth2Client.setCredentials(tokens);

            plus.people.get({userId: 'me', auth: oauth2Client}, function (err, profile) {
                if (err) {
                    return res.status(400).send({reason: 'Error getting google profile', message: err});
                }

                var conn;
                var user = {id: profile.id, tokens: tokens};
                var options = {returnChanges: true, conflict: 'update'};

                r.connect(config.database)
                    .then(function (c) {
                        conn = c;

                        return r.table('users').insert(user, options).run(conn).then(function (result) {
                            if (result.inserted !== 1 && result.replaced !== 1) {
                                throw new Error('Document was not inserted/updated.');
                            } else {
                                return res.send({
                                    token: createToken(result.changes[0].new_val),
                                    user: result.changes[0].new_val,
                                    state: req.body.state
                                });
                            }
                        })
                    })
                    .error(function (err) {
                        config.logger.error(err);
                        return res.status(400).send({reason: 'Error saving new user', message: err});
                    })
                    .finally(function () {
                        if (conn) conn.close();
                    });
            });
        });
    });

    router.get('/login', function (req, res) {
        var url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/cloudprint', 'https://www.googleapis.com/auth/userinfo.profile'],
            approval_prompt: 'force', // without this, if we lose the refresh token we won't get it back...
            state: req.query.state
        });

        res.send({url: url});
    });

    router.get('/printers', ensureAuthenticated, function (req, res) {
        var requestOptions = {
            url: 'https://www.google.com/cloudprint/search'
        };

        printer.gcp(req.user, requestOptions)
            .then(function (printers) {
                res.send(printers);
            })
            .catch(function (err) {
                config.logger.error(err);
                res.status(500).send(err);
            });
    });

    // from the settings/user screen
    router.post('/settings', ensureAuthenticated, function (req, res) {

        var settings = req.body;
        settings.id = req.user;

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;
                return r.table('users')
                    .get(req.user)
                    .update(settings, {returnChanges: true})
                    .run(conn, function (err, resp) {
                        if (resp.changes.length === 0) {
                            res.status(304).send({});
                        } else {
                            res.send(resp.changes[0].new_val);
                        }
                    });
            })
            .error(function (err) {
                config.logger.error(err);
                return res.status(500).send({reason: 'Error saving user', message: err});
            })
            .finally(function () {
                if (conn) conn.close();
            });
    });

    router.get('/printJobs', ensureAuthenticated, function (req, res) {
        var requestOptions = {
            url: 'https://www.google.com/cloudprint/jobs',
            formData: {
                q: config.printTag
            }
        };
        var showQueued = req.query.showQueued === 'true';

        printer.gcp(req.user, requestOptions)
            .then(function (result) {
                // array of job ids
                var jobIds = [];

                for (var i = 0; i < result.jobs.length; i++) {
                    if (!showQueued || result.jobs[i].status === 'QUEUED' || result.jobs[i].status === 'IN_PROGRESS' || result.jobs[i].status === 'HELD') {
                        jobIds.push(result.jobs[i].id);
                    }
                }

                var conn;
                r.connect(config.database)
                    .then(function (c) {
                        conn = c;
                        return r.table('pictures')
                            // filter all pictures by only ones which are in queue with google cloud print
                            .filter(r.row('prints')('id').setIntersection(jobIds).count().gt(0))
                            .run(conn, function (err, cursor) {

                                cursor.toArray()
                                    .then(function (results) {
                                        res.send(results);
                                    }).error(function (err) {
                                        return res.status(500).send({reason: 'Error', message: err});
                                    });
                            });
                    })
                    .error(function (err) {
                        return res.status(400).send({reason: 'Error', message: err});
                    })
                    .finally(function () {
                        if (conn) conn.close();
                    });
            })
            .catch(function (err) {
                config.logger.error(err);
                res.status(500).send(err);
            });
    });

    router.get('/printJob', ensureAuthenticated, function (req, res) {
        printer.getImage(req.query.id).then(function (image) {
            res.send(image);
        })
            .catch(function (err) {
                config.logger.error(err);
                return res.status(500).send({reason: 'Error', message: err});
            });
    });

    // print picture given id of the picture from pictures db table.
    router.post('/print', ensureAuthenticated, function (req, res) {

        printer.submitPrintJob(req.user, req.body.id, req.body.original)
            .then(function () {
                res.send({});
            })
            .catch(function (err) {
                config.logger.error(err);
                res.status(500).send({message: err});
            });
    });

    function createToken(user) {
        var payload = {
            sub: user.id,
            iat: moment().unix(),
            exp: moment().add(14, 'days').unix()
        };
        return jwt.encode(payload, config.TOKEN_SECRET);
    }

    module.exports = router;
})();
