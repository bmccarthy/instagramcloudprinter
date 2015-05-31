(function () {
    'use strict';

    var jwt = require('jsonwebtoken');
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

                if (profile.id !== '113616792686032179958' && profile.id !== '111362183559100313008') {
                    return res.status(401).send({reason: 'BETA users only: ' + JSON.stringify(profile)});
                }

                var conn;
                var user = {id: profile.id, tokens: tokens};
                var options = {returnChanges: true, conflict: 'update'};

                r.connect(config.database)
                    .then(function (c) {
                        conn = c;

                        return r.table('users')
                            .insert(user, options)
                            .run(conn)
                            .then(function (result) {
                                if (result.inserted !== 1 && result.replaced !== 1) {
                                    return q.reject({message: 'Document was not inserted/updated'});
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
                        return res.status(500).send({reason: 'Error saving new user', message: err});
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
        settings.id = req.user.id;

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;
                return r.table('users')
                    .get(req.user.id)
                    .update(settings, {returnChanges: true})
                    .run(conn)
                    .then(function (result) {
                        if (result.changes.length === 0) {
                            res.status(304).send({});
                        } else {
                            res.send(result.changes[0].new_val);
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

        if (!req.user.printerId) {
            res.status(400).send({message: 'No printer is set up for this user.'});
        }

        var requestOptions = {
            url: 'https://www.google.com/cloudprint/jobs',
            formData: {
                q: config.printTag,
                printerid: req.user.printerId,
                sortOrder: 'CREATE_TIME_DESC',
                limit: req.query.limit || 10,
                offset: req.query.offset || 0
                //,status: 'DONE' //todo: currently passing status fails.
            }
        };

        printer.gcp(req.user, requestOptions)
            .then(function (result) {
                // array of job ids
                var jobIds = [];

                for (var i = 0; i < result.jobs.length; i++) {
                    jobIds.push(result.jobs[i].id);
                }

                var conn;
                r.connect(config.database)
                    .then(function (c) {
                        conn = c;
                        return r.table('pictures')
                            // filter all pictures by only ones which are in queue with google cloud print
                            .filter(r.row('prints')('id').setIntersection(jobIds).count().gt(0))
                            .run(conn)
                            .then(function (cursor) {

                                return cursor.toArray()
                                    .then(function (results) {
                                        res.send(results);
                                    });
                            });
                    })
                    .error(function (err) {
                        return res.status(500).send({reason: 'Error', message: err});
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
        printer.getImage(req.query.id)
            .then(function (image) {
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
                res.send({success: true});
            })
            .catch(function (err) {
                config.logger.error(err);
                res.status(500).send({message: err});
            });
    });

    router.get('/me', ensureAuthenticated, function (req, res) {
        res.send(req.user);
    });

    function createToken(user) {
        var token = jwt.sign({sub: user.id}, config.TOKEN_SECRET, {expiresInSeconds: 60 * 60 * 24 * 14});
        return token;
    }

    module.exports = router;
})();
