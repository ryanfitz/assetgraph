/*global require, exports*/
var util = require('util'),
    _ = require('underscore'),
    error = require('../error'),
    Base = require('./Base').Base;

function HTMLAlternateLink(config) {
    Base.call(this, config);
}

util.inherits(HTMLAlternateLink, Base);

_.extend(HTMLAlternateLink.prototype, {
    _setRawUrlString: function (url) {
        this.node.href = url;
    },

    createNode: function (document) {
        var node = document.createElement('link');
        node.rel = 'alternate';
        // FIXME: Set type attribute the target asset's mime type?
        return node;
    }
});

exports.HTMLAlternateLink = HTMLAlternateLink;