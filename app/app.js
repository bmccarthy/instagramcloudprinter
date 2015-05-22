(function () {
    'use strict';

    angular.module('app', ['mobile-angular-ui', 'ui.router'])
        .run(['$rootScope', '$state', '$location', '$stateParams', '$http', function ($rootScope, $state, $location, $stateParams, $http) {

            // It's very handy to add references to $state and $stateParams to the $rootScope
            // so that you can access them from any scope within your applications.For example,
            // <li ng-class="{ active: $state.includes('contacts.list') }"> will set the <li>
            // to active whenever 'contacts.list' or one of its decendents is active.
            $rootScope.$state = $state;
            $rootScope.$stateParams = $stateParams;

            $rootScope.$on('$stateChangeStart', function () {
                $rootScope.loading = true;
            });

            $rootScope.$on('$stateChangeSuccess', function () {
                console.log('change finished');
                $rootScope.loading = false;
            });
            $rootScope.$on('$stateNotFound', function () {
                console.log('change error');
                $rootScope.loading = false;
            });
            $rootScope.$on('$stateChangeError', function () {
                console.log('change error');
                $rootScope.loading = false;
            });

            $rootScope.$on('$stateChangeStart', function (event, toState, toParams) {
                var user = window.localStorage['user'];
                var requireLogin = toState.data && toState.data.requireLogin;

                if (user == null && requireLogin) {
                    event.preventDefault();

                    $http.get('/api/google/login?state=' + $location.url())
                        .success(function (resp) {
                            console.log('redirecting to google: ' + resp.url);
                            window.location.href = resp.url;
                        })
                        .error(function (err) {
                            console.log('error getting url for authentication:');
                            console.log(err);
                        });
                }
            });
        }])
        .config(['$urlRouterProvider', '$locationProvider', '$urlMatcherFactoryProvider', '$stateProvider', '$httpProvider', function ($urlRouterProvider, $locationProvider, $urlMatcherFactoryProvider, $stateProvider, $httpProvider) {

            $httpProvider.interceptors.push('sessionInjector');

            $urlMatcherFactoryProvider.strictMode(false);

            $stateProvider.state('info', {
                url: '/info/',
                template: '<p>You are not logged in yet...</p>',
                controller: ['$scope', '$state', function ($scope, $state) {
                    $state.go('app.queue');
                }]
            });

            $stateProvider.state('googleCallback', {
                url: '/google/callback/',
                template: '<p>Logging into google...</p>',
                controller: ['$location', '$http', '$state', function ($location, $http, $state) {
                    if ($location.search().error) {
                        alert($location.search().error);
                        return;
                    }

                    if (!$location.search().code) {
                        alert('No code found');
                        return;
                    }

                    $http.post('/api/google/callback', $location.search()).then(function (resp) {
                        window.localStorage['user'] = JSON.stringify(resp.data.user);
                        window.localStorage['token'] = resp.data.token;

                        if (resp.data.state) {
                            $location.url(resp.data.state);
                        } else {
                            $state.go('app.queue');
                        }
                    });
                }]
            });

            $stateProvider.state('app', {
                url: '/',
                abstract: true,
                template: '<div data-ui-view></div>',
                resolve: {
                    user: function () {
                        var user = window.localStorage['user'];
                        if (user == null) {
                            return user;
                        }

                        return JSON.parse(user);
                    },
                    token: function () {
                        return window.localStorage['token'];
                    }
                },
                data: {
                    requireLogin: true
                }
            });

            $stateProvider.state('app.queue', {
                url: 'queue/',
                templateUrl: 'queue/queue.html',
                controller: 'QueueCtrl',
                resolve: {
                    jobs: ['$http', '$q', function ($http, $q) {
                        var deferred = $q.defer();

                        $http.get('/api/google/printJobs?showQueued=true').success(function (jobs) {
                            deferred.resolve(jobs);
                        });

                        return deferred.promise;
                    }]
                }
            });

            $stateProvider.state('app.queue.detail', {
                url: 'detail/:id/',
                views: {
                    '@app': {
                        templateUrl: 'detail/detail.html',
                        controller: 'DetailCtrl'
                    },
                    'header@': {
                        templateUrl: 'detail/detail.header.html'
                    }
                }
            });

            $stateProvider.state('app.history', {
                url: 'history/',
                templateUrl: 'history/history.html',
                controller: 'HistoryCtrl',
                resolve: {
                    jobs: ['$http', '$q', function ($http, $q) {
                        var deferred = $q.defer();

                        $http.get('/api/google/printJobs?showQueued=false').success(function (jobs) {
                            deferred.resolve(jobs);
                        });

                        return deferred.promise;
                    }]
                }
            });

            $stateProvider.state('app.history.detail', {
                url: 'detail/:id/',
                views: {
                    '@app': {
                        templateUrl: 'detail/detail.html',
                        controller: 'DetailCtrl'
                    },
                    'header@': {
                        templateUrl: 'detail/detail.header.html'
                    }
                }
            });

            $stateProvider.state('app.settings', {
                url: 'settings/',
                templateUrl: 'settings/settings.html',
                controller: 'SettingsCtrl',
                resolve: {
                    printers: ['$http', '$q', function ($http, $q) {
                        var deferred = $q.defer();

                        $http.get('/api/google/printers').success(function (printers) {
                            deferred.resolve(printers.printers);
                        });

                        return deferred.promise;
                    }]
                }
            });

            // add trailing slashes to all routes before attempting to match against routes. https://github.com/angular-ui/ui-router/wiki/Frequently-Asked-Questions#how-to-make-a-trailing-slash-optional-for-all-routes
            $urlRouterProvider.rule(function ($injector, $location) {
                var path = $location.url();

                // check to see if the path already has a slash where it should be
                if (path[path.length - 1] === '/' || path.indexOf('/?') > -1) {
                    return;
                }

                if (path.indexOf('?') > -1) {
                    return path.replace('?', '/?');
                }

                return path + '/';
            });

            $urlRouterProvider.otherwise('/info/');

            $locationProvider.html5Mode(true);
        }]);

    angular.module('app').constant('moment', moment);

    angular.module('app').factory('sessionInjector', [function () {
        return {
            request: function (config) {
                var token = window.localStorage['token'];

                if (token != null && config.url.indexOf('/') === 0) {
                    config.headers.Authorization = 'Bearer ' + token;
                }

                return config;
            }
        };
    }]);
})();
