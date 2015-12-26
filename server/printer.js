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

    var myTokens = config.tokens;
    var oauth2Client = new OAuth2(config.google.client, config.google.secret, config.google.redirect);
    oauth2Client.setCredentials(myTokens);

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

                return callGoogle(requestOptions);
            })
            .finally(function () {
                fs.unlink(filepath);
            });
    }

    function deletePrintJob(jobId) {
        //{
        //    "success": true,
        //    "message": "Print job deleted successfully.",
        //    "xsrf_token": "AIp06Dg77fXq6yyUwJwLZKlhpyf1L6-8FA:1451154134960",
        //    "request": {
        //    "time": "0",
        //        "users": [
        //        "brianm84@gmail.com"
        //    ],
        //        "params": {
        //        "jobid": [
        //            "12e704c7-2624-2e5d-d087-23346b8e4ccb"
        //        ]
        //    },
        //    "user": "brianm84@gmail.com"
        //}
        //}
        //
        var deferred = q.defer();

        var options = {
            url: 'https://www.google.com/cloudprint/deletejob?jobid=' + jobId
        };

        callGoogle(options)
            .then(function (result) {
                if (!result.success) {
                    deferred.reject(new Error(result));
                    return;
                }

                deferred.resolve(result.message);
            });

        return deferred.promise;
    }

    function deleteAllPrintJobs() {
        //{
        //    "tags": [
        //    "^own",
        //    "instagramprintjob"
        //],
        //    "createTime": "1451153405721",
        //    "printerName": "Save to Google Drive",
        //    "uiState": {
        //    "summary": "DONE"
        //},
        //    "updateTime": "1451153406758",
        //    "status": "DONE",
        //    "ownerId": "brianm84@gmail.com",
        //    "rasterUrl": "https://www.google.com/cloudprint/download?id\u003d12e704c7-2624-2e5d-d087-23346b8e4ccb\u0026forcepwg\u003d1",
        //    "ticketUrl": "https://www.google.com/cloudprint/ticket?format\u003dxps\u0026output\u003dxml\u0026jobid\u003d12e704c7-2624-2e5d-d087-23346b8e4ccb",
        //    "printerid": "__google__docs",
        //    "semanticState": {
        //    "state": {
        //        "type": "DONE"
        //    },
        //    "delivery_attempts": 1,
        //        "version": "1.0"
        //},
        //    "printerType": "DRIVE",
        //    "contentType": "image/jpeg",
        //    "fileUrl": "https://www.google.com/cloudprint/download?id\u003d12e704c7-2624-2e5d-d087-23346b8e4ccb",
        //    "driveUrl": "https://drive.google.com/file/d/1Vn3iKTxBn7Scn57nrpubxkPPamkjV_xNrfZhcs_oH8Cw2L_m-TTfOieAoBha2OxJl6zZ8qt7t5dshCbD/view",
        //    "message": "",
        //    "id": "12e704c7-2624-2e5d-d087-23346b8e4ccb",
        //    "title": "1148679914908774193_1923864314.jpg",
        //    "errorCode": "",
        //    "numberOfPages": 1
        //},

        var deferred = q.defer();

        var promises = [];

        getPrintJobs()
            .then(function (jobs) {
                config.logger.info(jobs);

                for (var i = 0; i < jobs.length; i++) {
                    promises.push(deletePrintJob(jobs[i].id));
                }

                q.allSettled(promises)
                    .then(function () {
                        config.logger.info('deleted all print jobs');
                        deferred.resolve({});
                    })
                    .catch(function (err) {
                        config.logger.error(err);
                        deferred.reject(err);
                    });
            });

        return deferred.promise;
    }

    function getPrintJobs() {
        var deferred = q.defer();

        var options = {
            url: 'https://www.google.com/cloudprint/jobs?q=' + config.printTag + '&printerid=' + config.printerId
        };

        callGoogle(options)
            .then(function (result) {
                if (!result.success) {
                    deferred.reject(new Error(result));
                    return;
                }

                deferred.resolve(result.jobs);
            });

        return deferred.promise;
    }

    function refreshTokenIfNeeded() {
        // if the access token looks good (has a value and is not expired yet, fullfil promise
        if (myTokens.access_token) return q.when({});

        var deferred = q.defer();

        oauth2Client.refreshAccessToken(function (err, tokens) {
            if (err) {
                config.logger.error(err);
                deferred.reject(err);
                return;
            }

            myTokens = tokens;
            oauth2Client.setCredentials(myTokens);

            config.logger.info('refreshed tokens.  They are now: ' + JSON.stringify(myTokens));
            deferred.resolve(tokens);
        });

        return deferred.promise;
    }

    function callGoogle(requestOptions) {
        return refreshTokenIfNeeded()
            .then(function () {
                return gcp(requestOptions)
            });
    }

    function gcp(requestOptions) {
        var deferred = q.defer();

        if (!requestOptions.method) {
            requestOptions.method = 'POST';
        }

        requestOptions.headers = requestOptions.headers || {};
        requestOptions.headers.Authorization = 'OAuth ' + myTokens.access_token;

        request(requestOptions, function (err, response, body) {
            config.logger.info('first attempt to print file sent. ' + requestOptions.headers.Authorization);

            if (err) {
                config.logger.error(err);
                deferred.reject(err);
                return;
            }

            if (response.statusCode === 401 || response.statusCode === 403) {
                config.logger.error('first attempt to print file failed.');

                myTokens.access_token = null;

                refreshTokenIfNeeded().then(function () {

                    requestOptions.headers.Authorization = 'OAuth ' + myTokens.access_token;

                    request(requestOptions, function (err, response, body) {
                        config.logger.info('second attempt to print file sent. ' + requestOptions.headers.Authorization);

                        if (err) {
                            config.logger.error(err);
                            deferred.reject(err);
                            return;
                        }

                        if (response.statusCode >= 200 && response.statusCode < 400) {
                            config.logger.info('google print job returned success');
                            deferred.resolve(body);
                        } else {
                            config.logger.error('second attempt to print file failed.');
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
        deleteAllPrintJobs: deleteAllPrintJobs,
        gcp: callGoogle
    };
})();
