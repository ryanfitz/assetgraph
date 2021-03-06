/*global require, module, process*/
module.exports = function memoizeAsyncAccessor(name, computer) {
    return function (cb) {
        var that = this;
        if (name in that) {
            var value = that[name];
            process.nextTick(function () {
                cb(null, value);
            });
        } else {
            var waitingQueuePropertyName = '_' + name + '_queue';
            if (waitingQueuePropertyName in that) {
                that[waitingQueuePropertyName].push(cb);
            } else {
                that[waitingQueuePropertyName] = [cb];
                computer.call(that, function (err, result) {
                    if (!err) {
                        that[name] = result;
                    }
                    that[waitingQueuePropertyName].forEach(function (waitingCallback) {
                        waitingCallback(err, result);
                    });
                    delete that[waitingQueuePropertyName];
                });
            }
        }
    };
};
