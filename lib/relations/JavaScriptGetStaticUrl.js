/*global require, exports*/
var util = require('util'),
    _ = require('underscore'),
    extendWithGettersAndSetters = require('../util/extendWithGettersAndSetters'),
    uglifyAst = require('uglifyast'),
    Relation = require('./Relation');

function JavaScriptGetStaticUrl(config) {
    Relation.call(this, config);
}

util.inherits(JavaScriptGetStaticUrl, Relation);

extendWithGettersAndSetters(JavaScriptGetStaticUrl.prototype, {
    inline: function () {
        Relation.prototype.inline.call(this);
        var ast = this.to.toAst();
        if (!this.omitFunctionCall) {
            ast = [
                'call',
                [
                    'name',
                    'GETSTATICURL'
                ],
                [
                    ast
                ]
            ];
        }
        Array.prototype.splice.apply(this.node, [0, this.node.length].concat(ast));
        this.from.markDirty();
        return this;
    },

    attach: function (asset, position, adjacentRelation) {
        throw new Error("Not implemented");
    },

    detach: function () {
        throw new Error("Not implemented");
    }
});

module.exports = JavaScriptGetStaticUrl;
