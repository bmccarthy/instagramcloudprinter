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

    //app.use(express.static(path.join(__dirname, '../app')));

    //app.get('/', function (req, res) {
    //    res.sendFile(path.join(__dirname, '../app/index.html'));
    //});

    //app.use('/api/google', require('./routes/google'));

    app.use('/api/instagram', require('./routes/instagram'));

    //// redirect all others to the index (HTML5 history)
    //app.get('*', function (req, res) {
    //    res.sendFile(path.join(__dirname, '../app/index.html'));
    //});

    var conn;

    r.connect(config.database)
        .then(function (c) {
            conn = c;
        })
        .then(setupDb)
        .then(startListening)
        .then(deleteAllSubscriptions)
        .then(subscribeToStaticTag);

    function createDb() {
        return r.dbCreate(config.database.db).run(conn);
    }

    function createPictures() {
        return r.tableCreate('pictures').run(conn)
            .then(function () {
                return q.all([
                    r.table('pictures').indexCreate('time').run(conn),
                    r.table('pictures').indexCreate('place', {geo: true}).run(conn)
                ]);
            });
    }

    function setupDb() {
        return createDb()
            .then(createPictures)
            .error(function (err) {
                if (err.msg.indexOf('already exists') == -1) {
                    throw err;
                }
            });
    }

    function startListening() {
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

    function subscribeToStaticTag() {
        return subscribeToTag(config.tag);
    }

    function deleteAllSubscriptions() {
        var deferred = q.defer();

        var url = 'https://api.instagram.com/v1/subscriptions?client_secret=' + config.instagram.secret + '&object=all&client_id=' + config.instagram.client;

        request.del(url, function (err) {
            if (err) return q.reject(err);

            config.logger.info('Successfully unsubscribed to all instagram tags.');

            deferred.resolve({});
        });

        return deferred.promise;
    }

    function handleNewInstagram(image) {
        return printer.submitPrintJob(image.images.standard_resolution.url, image.id);
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

            if (response.statusCode < 200 || response.statusCode >= 400) {
                config.logger.error('Error subscribing to tag: ' + JSON.stringify(body) + ', params:' + JSON.stringify(params));
                deferred.reject();
                return q.reject(body);
            } else {
                config.logger.info('Subscribed to tag: ' + tagName);
                deferred.resolve();
            }
        });

        return deferred.promise;
    }

    app.listen(app.get('port'), function () {
        console.log('Express server listening on port ' + app.get('port'));
        config.logger.info('Express server listening on port ' + app.get('port'));
    });
})();
