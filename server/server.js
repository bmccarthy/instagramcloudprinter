(function () {
    'use strict';

    require('dotenv').load();

    var path = require('path');
    var bodyParser = require('body-parser');
    var express = require('express');
    var r = require('rethinkdb');
    var q = require('q');
    var request = require('request').defaults({json: true});
    var mkdirp = require('mkdirp');
    var printer = require('./printer');
    var config = require('./config');
    var ig = require('./instagram-helper');

    var myqueue = require('./MyQueue');

    var conn;
    var numPrinted = 0;

    var app = express();

    app.set('port', config.port);
    app.use(bodyParser.urlencoded({extended: true}));

    app.use('/api/instagram', require('./routes/instagram'));

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

    function createPictureDirectory() {
        var deferred = q.defer();

        mkdirp(config.printFolder, function (err) {
            if (err) {
                config.logger.info('error while creating path');
                return q.reject(err);
            }

            config.logger.info('picture directory now exists: ' + config.printFolder);
            deferred.resolve({});
        });

        return deferred.promise;
    }

    function startListening() {
        return r.table('pictures')
            .changes()
            .filter(r.row('old_val').eq(null))
            .run(conn, function (err, cursor) {
                if (err) throw err;

                cursor.each(function (err, row) {
                    if (err) throw err;

                    numPrinted = numPrinted + 1;

                    if (numPrinted < 8) {
                        myqueue.enqueue(handleNewInstagram(row.new_val));
                    } else if (numPrinted == 8) {
                        ig.deleteAllSubscriptions();
                    }
                });
            });
    }

    function handleNewInstagram(image) {
        return function () {
            return printer.submitPrintJob(image.images.standard_resolution.url, image.id);
        };
    }

    app.listen(app.get('port'), function () {
        config.logger.info('Express server listening on port ' + app.get('port'));

        r.connect(config.database)
            .then(function (c) {
                conn = c;
            })
            .then(setupDb)
            .then(createPictureDirectory)
            .then(startListening)
            .then(ig.deleteAllSubscriptions)
            .then(function () {
                return ig.getRecent(config.tag).then(function (recent) {
                    r.table('pictures').insert(recent).run(conn);
                });
            })
            .then(function () {
                return ig.subscribeToTag(config.tag);
            });
    });
})();
