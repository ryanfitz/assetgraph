var vows = require('vows'),
    assert = require('assert'),
    _ = require('underscore'),
    AssetGraph = require('../lib/AssetGraph'),
    query = AssetGraph.query;

vows.describe('flattenStaticIncludes transform').addBatch({
    'After loading test case': {
        topic: function () {
            new AssetGraph({root: __dirname + '/flattenStaticIncludes/'})
                .loadAssets('index.html')
                .populate()
                .run(this.callback);
        },
        'the graph should contain 10 JavaScript assets, including two inline ones': function (assetGraph) {
            assert.equal(assetGraph.findAssets({type: 'JavaScript'}).length, 10);
            assert.equal(assetGraph.findAssets({type: 'JavaScript', isInline: true}).length, 2);
        },
        'then run the flattenStaticIncludes transform on the Html asset': {
            topic: function (assetGraph) {
                assetGraph.flattenStaticIncludes({type: 'Html'}).run(this.callback);
            },
            'the injected <script> tags should be in the right order': function (assetGraph) {
                assert.deepEqual(_.pluck(assetGraph.findRelations({from: assetGraph.findAssets({type: 'Html'})[0]}), 'href'),
                                [
                                    'a.js',
                                    'b.js',
                                    'c.js',
                                    'd.js',
                                    undefined,
                                    'e.js',
                                    'f.js',
                                    'g.js',
                                    'h.js',
                                    undefined
                                ]);
            }
        }
    }
})['export'](module);
