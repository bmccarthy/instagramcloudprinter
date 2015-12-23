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
    
    var conn;
    
    r.connect(config.database)
        .then(function(c){
            conn = c;
        })
        .then(setupDb)
        .then(startListening)
        .then(subscribeToStaticTag);
    
    function createDb() {
        return r.dbCreate(config.database.db).run(conn);
    }
    
    function createUsers() {
        return r.tableCreate('users').run(conn);
    }
    
    function createInstagramSubscription() {
        return r.tableCreate('instagram_subscription').run(conn);
    }
    
    function createPictures() {
        return r.tableCreate('pictures').run(conn)
        .then(function(){
             return q.all([
                    r.table('pictures').indexCreate('time').run(conn),
                    r.table('pictures').indexCreate('place', {geo: true}).run(conn)
                ]);
        });
    }
    
    function setupDb() {
        return createDb()
        .then(createPictures)
        .then(createUsers)
        .then(createInstagramSubscription)
        .error(function(err){
            if (err.msg.indexOf('already exists') == -1) {
                throw err;
            }
        });
    }
    
    function startListening () {
        return r.table('pictures')
                .changes()
                .filter(r.row('old_val').eq(null))
                .run(conn, function (err, cursor) {
                    if (err) throw err;

                    cursor.each(function (err, row) {
                        if (err) throw err;
                        handleNewInstagram(row.new_val);
                    });
                });
    }
    
    function subscribeToStaticTag () {
        return subscribeToTag(config.tag);
    }

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
                            printer.submitPrintJob(user, image.id);
                        }
                    });
                });
        });
    }

    function unsubscribeFromTag(tagName) {
        if (tagName == null || tagName === '') {
            return q.when({});
        }

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
