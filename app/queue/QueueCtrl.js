(function () {
    'use strict';

    angular.module('app').controller('QueueCtrl', ['$scope', '$http', 'jobs', function ($scope, $http, jobs) {
        var offset = 0;

        $scope.items = jobs;

        $scope.loadMore = function () {
            offset += 10;
            loadItems();
        };

        $scope.refresh = function () {
            offset = 0;
            $scope.items = [];
            loadItems();
        };

        function loadItems() {
            $http.get('/api/google/printJobs?showQueued=true&offset=' + offset).success(function (jobs) {
                $scope.items = $scope.items.concat(jobs);
            });
        }
    }]);
})();
