(function () {
    'use strict';

    require('dotenv').load();

    var path = require('path');
    var bodyParser = require('body-parser');
    var express = require('express');
    var r = require('rethinkdb');
    var q = require('q');
    var request = require('request').defaults({json: true});

    var printer = require('./printer');
    var config = require('./config');

    var app = express();

    app.set('port', config.port);
    app.use(bodyParser.urlencoded({extended: true}));

    app.use(express.static(path.join(__dirname, '../app')));

    app.get('/', function (req, res) {
        res.sendFile(path.join(__dirname, '../app/index.html'));
    });

    app.use('/api/google', require('./routes/google'));

    app.use('/api/instagram', require('./routes/instagram'));

    // redirect all others to the index (HTML5 history)
    app.get('*', function (req, res) {
        res.sendFile(path.join(__dirname, '../app/index.html'));
    });

    // connect to and set up rethinkdb - all instagram pictures
    var conn;
    r.connect(config.database)
        // create db
        .then(function (c) {
            conn = c;
            return r.dbCreate(config.database.db).run(conn);
        })
        // create the wedding pictures table
        .then(function () {
            return r.tableCreate('pictures').run(conn);
        })
        // create the pictures table indexes
        .then(function () {
            return q.all([
                r.table('pictures').indexCreate('time').run(conn),
                r.table('pictures').indexCreate('place', {geo: true}).run(conn)
            ]);
        })
        // create the users table
        .then(function () {
            return r.tableCreate('users').run(conn);
        })
        // create the users table
        .then(function () {
            return r.tableCreate('instagram_subscription').run(conn);
        })
        // if the table alrady exists, ignore that error
        .error(function (err) {
            if (err.msg.indexOf('already exists') == -1) {
                config.logger.error(err);
                throw err;
            }
        })
        // listen for new pictures
        .then(function () {
            return r.table('pictures')
                .changes()
                .run(conn, function (err, cursor) {
                    if (err) throw err;

                    cursor.each(function (err, row) {
                        if (err) throw err;

                        // only want to auto print images when they are newly inserted into the db, not when they are updated (they are updated during printing)
                        if (row.old_val == null) {
                            handleNewInstagram(row.new_val);
                        }
                    });
                });
        })
        // listen for changes to tags
        .then(function () {
            return r.table('users')
                .changes()
                .run(conn, function (err, cursor) {
                    if (err) throw err;

                    cursor.each(function (err, row) {
                        if (err) throw err;

                        if (row.new_val == null && row.old_val != null) {
                            // if user was deleted, call remove_if_unused(row.old_val.tag)
                            removeIfUnused(row.old_val.tag);
                        } else if (row.old_val == null && row.new_val != null && row.new_val.isOn) {
                            // if user is new, call add_if_new(row.new_val.tag)
                            addIfNew(row.new_val.tag);
                        } else if (row.new_val != null && row.old_val != null && row.new_val.tag != row.old_val.tag) {
                            // if old tag != new tag, call remove_if_unused(row.old_val.tag), add_if_new(row.new_val.tag)
                            removeIfUnused(row.old_val.tag);

                            if (row.new_val.isOn) {
                                addIfNew(row.new_val.tag);
                            }

                        } else if (row.new_val != null && row.new_val.isOn && row.old_val != null && !row.old_val.isOn) {
                            addIfNew(row.new_val.tag);
                        } else if (row.new_val != null && !row.new_val.isOn && row.old_val != null && row.old_val.isOn) {
                            removeIfUnused(row.old_val.tag);
                        }
                    });
                });
        })
        // always subscribe to the instagram realtime api after setting up the database.
        .finally(function () {
            var url = 'https://api.instagram.com/v1/subscriptions?client_secret=' + config.instagram.secret + '&object=all&client_id=' + config.instagram.client;

            db(function (conn) {
                return r.table('instagram_subscription')
                    .delete()
                    .run(conn)
                    .then(function () {
                        // delete all existing subscriptions, and than subscribe to all the tags
                        request.del(url, function (err) {
                            if (err) {
                                throw err;
                            }

                            getTags().then(function (tags) {
                                for (var i = 0; i < tags.length; i++) {
                                    subscribeToTag(tags[i].tag);
                                }
                            });
                        });
                    })
                    .catch(function (err) {
                        config.logger.error(err);
                    });
            });
        });

    function getTags() {
        var deferred = q.defer();

        db(function (conn) {

            return r.table('users')
                .filter({isOn: true})
                .pluck('tag')
                .distinct()
                .run(conn)
                .then(function (cursor) {
                    cursor.toArray(function (err, tags) {
                        if (err) deferred.reject(err);
                        else deferred.resolve(tags);
                    })
                });
        });

        return deferred.promise;
    }

    function removeIfUnused(tag) {
        getTags().then(function (tags) {
            if (tags.indexOf(tag) < 0) {
                unsubscribeFromTag(tag);
            }
        });
    }

    function addIfNew(tag) {
        getTags().then(function (tags) {
            if (tags.indexOf(tag) < 0) {
                subscribeToTag(tag);
            }
        });
    }

    function handleNewInstagram(image) {
        var tags = image.tags || [];

        db(function (conn) {
            //check for any users which subscribe to this tag, print it for them (only to unique printers? how about with different options).
            return r.table('users')
                .filter(function (user) {
                    return r.expr(tags).contains(user('tag'))
                })
                .run(conn)
                .then(function (cursor) {
                    cursor.each(function (err, user) {
                        if (err) throw err;

                        if (user.isOn) {
                            printer.submitPrintJob(user.id, image.id);
                        }
                    });
                });
        });
    }

    function unsubscribeFromTag(tagName) {
        var deferred = q.defer();

        db(function (conn) {

            return r.table('instagram_subscription')
                .filter({data: {object_id: tagName}})
                .delete({returnChanges: true})
                .run(conn)
                .then(function (result) {
                    if (!result.changes) {
                        deferred.resolve(result);
                        return;
                    }

                    for (var i = 0; i < result.changes.length; i++) {
                        request.del('https://api.instagram.com/v1/subscriptions?client_secret=' + config.instagram.secret + '&id=' + result.changes[i].old_val.data.id + '&client_id=' + config.instagram.client,
                            function (err, response, body) {
                                if (err) {
                                    config.logger.error(err);
                                    return;
                                }

                                config.logger.info('un-subscribed from instagram tag: ' + JSON.stringify(body));
                            });
                    }

                    deferred.resolve(result);
                });
        });

        return deferred.promise;
    }

    function db(func) {
        var conn;

        return r.connect(config.database)
            .then(function (c) {
                conn = c;

                return func(conn);
            })
            .finally(function () {
                if (conn) conn.close();
            });
    }

    function subscribeToTag(tagName) {
        if (tagName == null || tagName === '') return q.when();

        var deferred = q.defer();

        var params = {
            client_id: config.instagram.client,
            client_secret: config.instagram.secret,
            verify_token: config.instagram.verify,
            object: 'tag', aspect: 'media', object_id: tagName,
            callback_url: config.host + '/api/instagram/photo'
        };

        request.post({url: 'https://api.instagram.com/v1/subscriptions', form: params}, function (err, response, body) {
            if (err) {
                config.logger.error(err);
                deferred.reject(err);
                return q.reject(err);
            }

            var jsonBody = body;

            if (response.statusCode < 200 || response.statusCode >= 400) {
                config.logger.error('Error subscribing to tag: ' + JSON.stringify(body) + ', params:' + JSON.stringify(params));
                deferred.reject();
                return q.reject(jsonBody);
            }

            var options = {returnChanges: true, conflict: 'update'};

            db(function (conn) {
                return r.table('instagram_subscription')
                    .insert(jsonBody, options)
                    .run(conn)
                    .then(function (result) {
                        config.logger.info('successfully added tag subscription to instagram_subscription: ' + JSON.stringify(result));

                        if (result.inserted !== 1 && result.replaced !== 1) {
                            deferred.reject('item not upserted');
                        }

                        deferred.resolve(result.changes[0]);
                    });
            });
        });

        return deferred.promise;
    }

    app.listen(app.get('port'), function () {
        console.log('Express server listening on port ' + app.get('port'));
        config.logger.info('Express server listening on port ' + app.get('port'));
    });
})();
