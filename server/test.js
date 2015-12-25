(function () {

    var myqueue = [];
    var isProcessing = false;

    function processQueue() {
        if (isProcessing === true) return;

        if (myqueue.length) {
            console.log('starting to process queue');
            isProcessing = true;

            item = myqueue.shift();

            item().finally(function () {
                isProcessing = false;
                processQueue();
            });
        }
    }

    function enqueue(item) {
        myqueue.push(item);
        processQueue();
    }

    module.exports = {
        enqueue: enqueue
    };

})();


//var q = require('q');
//
//function promisePrint(url) {
//    return function () {
//        var deferred = q.defer();
//
//        setTimeout(function(){
//            console.log('printing: ' + url);
//            //todo: submit print job to GCP
//            deferred.resolve();
//        }, 3000);
//
//        return deferred.promise;
//    };
//}
//
//
//var myqueue = new Queue();
//myqueue.enqueue(promisePrint('test1'));
//myqueue.enqueue(promisePrint('test2'));
//myqueue.enqueue(promisePrint('test3'));
//myqueue.enqueue(promisePrint('test4'));
//myqueue.enqueue(promisePrint('test5'));
//
