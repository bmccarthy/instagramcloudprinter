(function () {
    'use strict';

    var myqueue = [];
    var isProcessing = false;

    function processQueue() {
        if (isProcessing === true) return;

        if (myqueue.length) {
            isProcessing = true;

            var item = myqueue.shift();

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
