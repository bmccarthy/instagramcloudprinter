(function () {

    var config = require('./config');
    var q = require('q');
    var _ = require('lodash');
    var request = require('request').defaults({json: true});


    function getRecent(tag) {
        var deferred = q.defer();
        var url = 'https://api.instagram.com/v1/tags/' + tag + '/media/recent?client_id=' + config.instagram.client;

        request.get(url, function (error, response, body) {
            if (error) return q.reject(error);

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

            return deferred.resolve(recent);
        });

        return deferred.promise;
    }

    module.exports = {
        getRecent: getRecent
    };

})();