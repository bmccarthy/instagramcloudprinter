(function () {
    'use strict';

    var config = require('./config');
    var google = require('googleapis');
    var OAuth2 = google.auth.OAuth2;
    var r = require('rethinkdb');
    var fs = require('fs');
    var q = require('q');
    var request = require('request').defaults({json: true});

    function getImage(id) {
        var deferred = q.defer();

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;
                return r.table('pictures').get(id).run(conn, function (err, picture) {
                    if (err) {
                        deferred.reject(err);
                    }

                    if (picture == null) {
                        deferred.reject('No picture found');
                    }

                    deferred.resolve(picture);
                });

            }).finally(function () {
                if (conn) conn.close();
            });

        return deferred.promise;
    }

    function getUser(id) {
        var deferred = q.defer();

        var conn;
        r.connect(config.database)
            .then(function (c) {
                conn = c;
                return r.table('users').get(id).run(conn, function (err, user) {
                    if (err) {
                        deferred.reject(err);
                    }

                    if (user == null) {
                        deferred.reject('No user found');
                    }

                    deferred.resolve(user);
                });

            }).finally(function () {
                if (conn) conn.close();
            });

        return deferred.promise;
    }

    function saveImage(url, filepath) {
        var deferred = q.defer();

        var ws = fs.createWriteStream(filepath);
        ws.on('error', function (err) {
            config.logger.error(err);
            deferred.reject(err);
        });
        ws.on('finish', function () {
            deferred.resolve();
        });

        request(url).pipe(ws);

        return deferred.promise;
    }

    function submitPrintJob(userId, imageId, original) {
        var user;
        var image;

        // get user
        return getUser(userId)
            // get image
            .then(function (u) {
                user = u;
                return getImage(imageId);
            })
            // make request to GCP to print the image
            .then(function (i) {
                image = i;

                var opath = config.printFolder + image.id + '.jpg';
                var npath = config.printFolder + image.id + '_edited.jpg';

                var filepath = original ? opath : npath;
                var filename = original ? image.id + '.jpg' : image.id + '_edited.jpg';

                return saveImage(image.images.standard_resolution.url, opath)
                    .then(function () {
                        return saveImage(image.images.standard_resolution.url, npath);
                    })
                    .then(function () {
                        var requestOptions = {
                            url: 'https://www.google.com/cloudprint/submit',
                            formData: {
                                printerid: user.printerId,
                                ticket: '{ "version": "1.0", "print": {} }',
                                contentType: 'image/jpeg',
                                title: filename,
                                content: fs.createReadStream(filepath),
                                tag: config.printTag
                            }
                        };

                        return gcp(userId, requestOptions);
                    })
                    .finally(function () {
                        fs.unlink(opath, function (err) {
                            config.logger.error(err);
                        });
                        fs.unlink(npath, function (err) {
                            config.logger.error(err);
                        });
                    });
            })
            // update rethinkdb with print job
            .then(function (response) {

                if (!response.success) {
                    return q.reject({message: response.message});
                }

                var conn;
                return r.connect(config.database)
                    .then(function (c) {
                        conn = c;
                        return r.table('pictures').get(imageId).update({
                            prints: r.row('prints').append(response.job).default([response.job])
                        }).run(conn);
                    })
                    .error(function (err) {
                        config.logger.error(err);
                        return q.reject(err);
                    })
                    .finally(function () {
                        if (conn) conn.close();
                    });
            })
            .error(function () {
                config.logger.error('Error attempting to submit print job');
            });
    }

    function gcp(userId, requestOptions) {
        var deferred = q.defer();

        if (!requestOptions.method) {
            requestOptions.method = 'POST';
        }

        requestOptions.headers = requestOptions.headers || {};

        getUser(userId)
            .then(function (user) {

                requestOptions.headers.Authorization = 'OAuth ' + user.tokens.access_token;

                request(requestOptions, function (err, response, body) {
                    if (err) {
                        deferred.reject(err);
                        return;
                    }

                    if (response.statusCode === 401 || response.statusCode === 403) {
                        var oauth2Client = new OAuth2(config.google.client, config.google.secret, config.google.redirect);
                        oauth2Client.setCredentials(user.tokens);

                        oauth2Client.refreshAccessToken(function (err, tokens) {
                            if (err) throw Error(err);

                            var conn;
                            r.connect(config.database)
                                .then(function (c) {
                                    conn = c;
                                    return r.table('users')
                                        .get(userId)
                                        .update({
                                            id: userId,
                                            tokens: tokens
                                        }).run(conn, function (err, resp) {
                                            //console.log('updated user with new tokens');
                                            //console.log(resp);
                                        });
                                })
                                .finally(function () {
                                    if (conn) conn.close();
                                });

                            requestOptions.headers.Authorization = 'OAuth ' + tokens.access_token;

                            request(requestOptions, function (err, response, body) {
                                if (err) {
                                    deferred.reject(err);
                                    return;
                                }

                                if (response.statusCode >= 200 && response.statusCode < 400) {
                                    deferred.resolve(body);
                                } else {
                                    deferred.reject(response);
                                }
                            });
                        });

                    } else if (response.statusCode >= 200 && response.statusCode < 400) {
                        deferred.resolve(body);
                    } else {
                        deferred.reject(response);
                    }
                });
            });

        return deferred.promise;
    }

    module.exports = {
        submitPrintJob: submitPrintJob,
        gcp: gcp,
        getImage: getImage
    };
})();
