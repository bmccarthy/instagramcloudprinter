(function () {
    'use strict';

    var config = require('./config');
    var google = require('googleapis');
    var OAuth2 = google.auth.OAuth2;
    var r = require('rethinkdb');
    var fs = require('fs');
    var path = require('path');
    var q = require('q');
    var request = require('request').defaults({json: true});
    var mkdirp = require('mkdirp');

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

    function saveImage(url, filepath) {
        var deferred = q.defer();

        mkdirp(path.dirname(filepath), function (err) {
            if (err) {
                config.logger.err(err);
                return;
            }

            var ws = fs.createWriteStream(filepath);
            ws.on('error', function (err) {
                config.logger.error(err);
                deferred.reject(err);
            });
            ws.on('finish', function () {
                deferred.resolve();
            });

            request(url).pipe(ws);
        });

        return deferred.promise;
    }

    function submitPrintJob(user, imageId, original) {
        var image;

        // get image
        return getImage(imageId)
            // make request to GCP to print the image
            .then(function (i) {
                image = i;

                var filepath = config.printFolder + image.id + '.jpg';

                return saveImage(image.images.standard_resolution.url, filepath)
                    .then(function () {
                        var requestOptions = {
                            url: 'https://www.google.com/cloudprint/submit',
                            formData: {
                                printerid: user.printerId,
                                ticket: '{ "version": "1.0", "print": {} }',
                                contentType: 'image/jpeg',
                                title: path.basename(filepath),
                                content: fs.createReadStream(filepath),
                                tag: config.printTag
                            }
                        };

                        return gcp(user, requestOptions);
                    })
                    .finally(function () {
                        fs.unlink(filepath, function (err) {
                            if (err) {
                                config.logger.error(err);
                            }
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
            .catch(function (err) {
                config.logger.error('Error attempting to submit print job: ' + JSON.stringify(err));
            });
    }

    function gcp(user, requestOptions) {
        var deferred = q.defer();

        if (!requestOptions.method) {
            requestOptions.method = 'POST';
        }

        requestOptions.headers = requestOptions.headers || {};
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
                                .get(user.id)
                                .update({id: user.id, tokens: tokens})
                                .run(conn);
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

        return deferred.promise;
    }

    module.exports = {
        submitPrintJob: submitPrintJob,
        gcp: gcp,
        getImage: getImage
    };
})();
