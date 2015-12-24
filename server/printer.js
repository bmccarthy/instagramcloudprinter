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

    function submitPrintJob(url, imageId) {
        var filepath = config.printFolder + imageId + '.jpg';

        return saveImage(url, filepath)
            .then(function () {
                var title = path.basename(filepath);
                var readStream = fs.createReadStream(filepath);

                config.logger.info('pre-submitting print request to google. title: ' + title);

                var requestOptions = {
                    url: 'https://www.google.com/cloudprint/submit',
                    formData: {
                        printerid: config.printerId,
                        ticket: '{ "version": "1.0", "print": {} }',
                        contentType: 'image/jpeg',
                        title: title,
                        content: readStream,
                        tag: config.printTag
                    }
                };

                return gcp(requestOptions);
            })
            .catch(function (err) {
                config.logger.error(err);
                return q.reject(err);
            })
            .then(function () {
                config.logger.info('printed file: ' + url);
                return q.when({});
            })
            .finally(function () {
                fs.unlink(filepath);
            });
    }

    function gcp(requestOptions) {
        config.logger.info('attempting to print file');

        var deferred = q.defer();

        if (!requestOptions.method) {
            requestOptions.method = 'POST';
        }

        requestOptions.headers = requestOptions.headers || {};
        requestOptions.headers.Authorization = 'OAuth ' + config.tokens.access_token;

        request(requestOptions, function (err, response, body) {
            if (err) {
                config.logger.error(err);
                throw err;
            }

            if (response.statusCode === 401 || response.statusCode === 403) {
                var oauth2Client = new OAuth2(config.google.client, config.google.secret, config.google.redirect);
                oauth2Client.setCredentials(config.tokens);

                oauth2Client.refreshAccessToken(function (err, tokens) {
                    if (err) {
                        config.logger.error(err);
                        throw err;
                    }

                    config.tokens = tokens;

                    requestOptions.headers.Authorization = 'OAuth ' + tokens.access_token;

                    request(requestOptions, function (err, response, body) {
                        if (err) {
                            config.logger.error(err);
                            throw err;
                        }

                        if (response.statusCode >= 200 && response.statusCode < 400) {
                            config.logger.info('google print job returned success');
                            deferred.resolve(body);
                        } else {
                            config.logger.error(response);
                            deferred.reject(response);
                        }
                    });
                });

            } else if (response.statusCode >= 200 && response.statusCode < 400) {
                config.logger.info('google print job returned success');
                deferred.resolve(body);
            } else {
                config.logger.error(response);
                deferred.reject(response);
            }
        });

        return deferred.promise;
    }

    module.exports = {
        submitPrintJob: submitPrintJob,
        gcp: gcp
    };
})();
