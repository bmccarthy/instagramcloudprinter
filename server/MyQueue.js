(function () {

    var myqueue = [];
    var isProcessing = false;

    function processQueue() {
        if (isProcessing === true) return;

        if (myqueue.length) {
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
