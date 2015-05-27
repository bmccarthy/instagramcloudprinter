(function () {
    'use strict';

    angular.module('app').controller('DetailCtrl', ['$scope', '$stateParams', '$http', function ($scope, $stateParams, $http) {
        $http.get('/api/google/printJob?id=' + $stateParams.id).success(function (item) {
            $scope.item = item;
        });

        $scope.printOriginal = function () {
            $http.post('/api/google/print', {id: $scope.item.id, original: true});
        };

        $scope.print = function () {
            $http.post('/api/google/print', {id: $scope.item.id});
        };

        $scope.cancel = function () {
        };

        $scope.doNotPrint = function () {
        };
    }]);

})();
