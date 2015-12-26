(function () {
    'use strict';

    var config = require('./config');
    var q = require('q');
    var _ = require('lodash');
    var request = require('request').defaults({json: true});

    function deleteAllSubscriptions() {
        var deferred = q.defer();
        var url = 'https://api.instagram.com/v1/subscriptions?client_secret=' + config.instagram.secret + '&object=all&client_id=' + config.instagram.client;

        request.del(url, function (err) {
            if (err) {
                deferred.reject(err);
                return;
            }

            config.logger.info('Successfully unsubscribed to all instagram tags.');

            deferred.resolve({});
        });

        return deferred.promise;
    }

    function subscribeToTag(tagName) {
        if (!tagName) return q.when();

        var deferred = q.defer();

        var params = {
            client_id: config.instagram.client,
            client_secret: config.instagram.secret,
            verify_token: config.instagram.verify,
            object: 'tag', aspect: 'media', object_id: tagName,
            callback_url: config.host + ':' + config.port + '/api/instagram/photo'
        };

        request.post({url: 'https://api.instagram.com/v1/subscriptions', form: params}, function (err, response, body) {
            if (err) {
                config.logger.error(err);
                deferred.reject(err);
                return;
            }

            if (response.statusCode < 200 || response.statusCode >= 400) {
                config.logger.error('Error subscribing to tag: ' + JSON.stringify(body) + ', params:' + JSON.stringify(params));
                deferred.reject(body);
            } else {
                config.logger.info('Subscribed to tag. params: ' + JSON.stringify(params));
                deferred.resolve();
            }
        });

        return deferred.promise;
    }

    function getRecent(tag) {
        var deferred = q.defer();
        var url = 'https://api.instagram.com/v1/tags/' + tag + '/media/recent?client_id=' + config.instagram.client;

        request.get(url, function (error, response, body) {
            if (error) {
                deferred.reject(error);
                return;
            }

            var images = _.where(body.data, {type: 'image'});
            var recent = _.map(body.data, function (item) {
                return {
                    id: item.id,
                    created_time: item.created_time,
                    images: {
                        standard_resolution: item.images.standard_resolution
                    },
                    tags: item.tags
                };
            });

            deferred.resolve(recent);
        });

        return deferred.promise;
    }

    module.exports = {
        getRecent: getRecent,
        subscribeToTag: subscribeToTag,
        deleteAllSubscriptions: deleteAllSubscriptions
    };

})();