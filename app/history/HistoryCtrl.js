(function () {
    'use strict';

    angular.module('app').controller('HistoryCtrl', ['$scope', 'jobs', function ($scope, jobs) {
        $scope.items = jobs;
    }]);
})();
