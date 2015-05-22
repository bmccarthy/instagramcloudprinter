(function () {
    'use strict';

    angular.module('app').controller('SettingsCtrl', ['$scope', '$http', '$state', 'user', 'printers', function ($scope, $http, $state, user, printers) {
        $scope.cancelAll = function () {
            // TODO make request to google print API to cancel all print jobs
        };

        $scope.reset = function () {
            // TODO make request to NEW web server running on raspberry pi to restart the raspberry pi
        };

        $scope.settingsChanged = function () {
            $http.post('/api/google/settings', $scope.settings).success(function (user) {
                window.localStorage['user'] = JSON.stringify(user);
            });
        };

        $scope.printers = printers;
        $scope.settings = {
            isOn: user.isOn,
            tag: user.tag,
            printerId: user.printerId
        };

        $scope.logout = function () {
            window.localStorage.clear();
            $state.go('info');
        };
    }]);

})();
