/*global require, exports*/
var util = require('util'),
    _ = require('underscore'),
    Base = require('./Base').Base;

function JavaScriptConditionalBlock(config) {
    Base.call(this, config);
}

util.inherits(JavaScriptConditionalBlock, Base);

_.extend(JavaScriptConditionalBlock.prototype, {
    remove: function () {
        this.parentNode.splice(this.parentNode.indexOf(this.node), 1);
    }
});

exports.JavaScriptConditionalBlock = JavaScriptConditionalBlock;