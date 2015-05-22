(function () {
    'use strict';

    angular.module('app').controller('QueueCtrl', ['$scope', 'jobs', function ($scope, jobs) {
        $scope.items = jobs;
    }]);
})();
