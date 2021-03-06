var util = require('util'),
    _ = require('underscore'),
    jsdom = require('jsdom-papandreou'),
    domtohtml = require('jsdom-papandreou/lib/jsdom/browser/domtohtml'),
    extendWithGettersAndSetters = require('../util/extendWithGettersAndSetters'),
    errors = require('../errors'),
    relations = require('../relations'),
    Asset = require('./Asset'),
    Text = require('./Text');

function Html(config) {
    Text.call(this, config);
}

util.inherits(Html, Text);

var isSensitiveByTagName = {
    pre: true,
    textarea: true,
    script: true,
    style: true
};

var isBlockLevelByTagName = {};

[
    '#document', 'html', 'body', 'head',
    'title', 'meta', 'link', 'style', 'script',
    'address', 'blockquote', 'div', 'dl', 'fieldset', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'noscript', 'ol', 'p', 'pre', 'table', 'ul',
    'dd', 'dt', 'li', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'
].forEach(function (blockLevelTagName) {
    isBlockLevelByTagName[blockLevelTagName] = true;
});

function extractEncodingFromText(text) {
    var metaCharset;
    (text.match(/<meta[^>]+>/ig) || []).forEach(function (metaTagString) {
        if (/\bhttp-equiv=([\"\']|)\s*Content-Type\s*\1/i.test(metaTagString)) {
            var matchContent = metaTagString.match(/\bcontent=([\"\']|)\s*text\/html;\s*charset=([\w\-]*)\s*\1/i);
            if (matchContent) {
                metaCharset = matchContent[2];
            }
        } else {
            var matchSimpleCharset = metaTagString.match(/\bcharset=([\"\']|)\s*([\w\-]*)\s*\1/i);
            if (matchSimpleCharset) {
                metaCharset = matchSimpleCharset[2];
            }
        }
    });
    return metaCharset; // Will be undefined if not found
}

extendWithGettersAndSetters(Html.prototype, {
    contentType: 'text/html',

    supportedExtensions: ['.html', '.template', '.xhtml', '.shtml'],

    isPretty: false,

    get encoding() {
        if (!this._encoding) {
            // An explicit encoding (Content-Type header, data: url charset, assetConfig) takes precedence, but if absent we should
            // look for a <meta http-equiv='Content-Type' ...> tag with a charset before falling back to the defaultEncoding (utf-8)
            if ('_text' in this) {
                this._encoding = extractEncodingFromText(this._text) || this.defaultEncoding;
            } else if (this._rawSrc) {
                this._encoding = extractEncodingFromText(this._rawSrc.toString('binary', 0, Math.min(1024, this._rawSrc.length))) || this.defaultEncoding;
            } else {
                this._encoding = this.defaultEncoding;
            }
        }
        return this._encoding;
    },

    set encoding(encoding) {
        // An intended side effect of getting this.parseTree before deleting this._rawSrc is that we're sure
        // that the raw source has been decoded into this._text before the original encoding is thrown away.
        var parseTree = this.parseTree;
        if (parseTree.head) {
            var existingMetaElements = parseTree.head.getElementsByTagName('meta'),
                contentTypeMetaElement;
            for (var i = 0 ; i < existingMetaElements.length ; i += 1) {
                var metaElement = existingMetaElements[i];
                if (metaElement.hasAttribute('charset') || /^content-type$/i.test(metaElement.getAttribute('http-equiv'))) {
                    contentTypeMetaElement = metaElement;
                    break;
                }
            }
            if (!contentTypeMetaElement) {
                contentTypeMetaElement = parseTree.createElement('meta');
                parseTree.head.insertBefore(contentTypeMetaElement, parseTree.head.firstChild);
                this.markDirty();
            }
            if (contentTypeMetaElement.hasAttribute('http-equiv')) {
                if ((contentTypeMetaElement.getAttribute('content') || '').toLowerCase() !== 'text/html; charset=' + encoding) {
                    contentTypeMetaElement.setAttribute('content', 'text/html; charset=' + encoding);
                    this.markDirty();
                }
            } else {
                // Simple <meta charset="...">
                if (contentTypeMetaElement.getAttribute('charset') !== encoding) {
                    contentTypeMetaElement.setAttribute('charset', encoding);
                    this.markDirty();
                }
            }
        }
        if (encoding !== this.encoding) {
            this._encoding = encoding;
            this.markDirty();
        }
    },

    get text() {
        if (!('_text' in this)) {
            if (this._parseTree) {
                this._text = (this._parseTree.doctype ? this._parseTree.doctype + "\n" : "") + domtohtml.domToHtml(this._parseTree, !this.isPretty);
            } else {
                this._text = this._getTextFromRawSrc();
            }
        }
        return this._text;
    },

    get parseTree() {
        if (!this._parseTree) {
            try {
                this._parseTree = jsdom.jsdom(this.text, undefined, {
                    features: {
                        ProcessExternalResources: [],
                        FetchExternalResources: [],
                        QuerySelector: true
                    }
                });
            } catch (e) {
                var err = new errors.ParseError({message: 'Parse error in ' + (this.url || 'inline Html' + (this.nonInlineAncestor ? ' in ' + this.nonInlineAncestor.url : '')) + '\n' + e.message, asset: this});
                if (this.assetGraph) {
                    this.assetGraph.emit('error', err);
                } else {
                    throw err;
                }
            }
            // Jsdom (or its Html parser) doesn't strip the newline after the <!DOCTYPE> for some reason.
            // Issue reported here: https://github.com/tmpvar/jsdom/issues/160
            if (this._parseTree.firstChild && this._parseTree.firstChild.nodeName === '#text' && this._parseTree.firstChild.nodeValue === "\n") {
                this._parseTree.removeChild(this._parseTree.firstChild);
            }
        }
        return this._parseTree;
    },

    set parseTree(parseTree) {
        this.unload();
        this._parseTree = parseTree;
        this.markDirty();
    },

    _isRelationUrl: function (url) {
        return url && !/^mailto:|^\s*$|^#/i.test(url);
    },

    findOutgoingRelationsInParseTree: function () {
        var outgoingRelations = [];
        if (this.parseTree.documentElement && this.parseTree.documentElement.hasAttribute('manifest')) {
            outgoingRelations.push(new relations.HtmlCacheManifest({
                from: this,
                to: {
                    url: this.parseTree.documentElement.getAttribute('manifest')
                },
                node: this.parseTree.documentElement
            }));
        }
        var queue = [this.parseTree];
        while (queue.length) {
            var node = queue.shift();
            if (node.childNodes) {
                for (var i = node.childNodes.length - 1 ; i >= 0 ; i -= 1) {
                    queue.unshift(node.childNodes[i]);
                }
            }
            if (node.nodeType === node.ELEMENT_NODE) {
                var nodeName = node.nodeName.toLowerCase();
                if (nodeName === 'script') {
                    var type = node.getAttribute('type');

                    if (!type || type === 'text/javascript' || type === 'text/coffeescript') {
                        var src = node.getAttribute('src');
                        if (src) {
                            if (this._isRelationUrl(src)) {
                                outgoingRelations.push(new relations.HtmlScript({
                                    from: this,
                                    to: {
                                        url: src
                                    },
                                    node: node
                                }));
                            }
                        } else {
                            var inlineAsset = new (require(type === 'text/coffeescript' ? './CoffeeScript' : './JavaScript'))({
                                text: node.firstChild ? node.firstChild.nodeValue : ''
                            });

                            outgoingRelations.push(new relations.HtmlScript({
                                from: this,
                                to: inlineAsset,
                                node: node
                            }));

                            // Hack: If transforms.registerRequireJsConfig has run, make sure that we register the
                            // require.js paths in the inline script before resolving the a data-main attribute
                            // further down in the document.
                            if (inlineAsset.type === 'JavaScript' && this.assetGraph && this.assetGraph.requireJsConfig) {
                                this.assetGraph.requireJsConfig.registerConfigInJavaScript(inlineAsset, this);
                            }
                        }
                        if (node.hasAttribute('data-main')) {
                            var url = node.getAttribute('data-main') + '.js';
                            if (this.assetGraph && this.assetGraph.requireJsConfig) {
                                url = this.assetGraph.requireJsConfig.resolveUrl(url);
                            }

                            outgoingRelations.push(new relations.HtmlRequireJsMain({
                                from: this,
                                to: {
                                    url: url
                                },
                                node: node
                            }));
                        }
                    } else if (type === 'text/html') {
                        var text = (node.firstChild && node.firstChild.nodeValue) || '';
                        outgoingRelations.push(new relations.HtmlInlineScriptTemplate({
                            from: this,
                            to: new Html({
                                isExternalizable: false,
                                text: text
                            }),
                            node: node
                        }));
                    }
                } else if (nodeName === 'style') {
                    outgoingRelations.push(new relations.HtmlStyle({
                        from: this,
                        to: new (require('./Css'))({
                            text: node.firstChild ? node.firstChild.nodeValue : ''
                        }),
                        node: node
                    }));
                } else if (nodeName === 'link') {
                    if (node.hasAttribute('rel')) {
                        var rel = node.getAttribute('rel');
                        if (/(?:^| )stylesheet(?:\/less)?(?:$| )/i.test(rel) && this._isRelationUrl(node.getAttribute('href'))) {
                            outgoingRelations.push(new relations.HtmlStyle({
                                from: this,
                                to: {
                                    url: node.getAttribute('href')
                                },
                                node: node
                            }));
                        } else if (/(?:^| )(?:apple-touch-icon(?:-precomposed)?|icon)(?:$| )/i.test(rel)) { // Also catches rel="shortcut icon"
                            if (this._isRelationUrl(node.getAttribute('href'))) {
                                outgoingRelations.push(new relations.HtmlShortcutIcon({
                                    from: this,
                                    to: {
                                        url: node.getAttribute('href')
                                    },
                                    node: node
                                }));
                            }
                        } else if (/(?:^| )apple-touch-startup-image(?:$| )/i.test(rel)) {
                            if (this._isRelationUrl(node.getAttribute('href'))) {
                                outgoingRelations.push(new relations.HtmlAppleTouchStartupImage({
                                    from: this,
                                    to: {
                                        url: node.getAttribute('href')
                                    },
                                    node: node
                                }));
                            }
                        } else if (/(?:^| )alternate(?:$| )/i.test(rel)) {
                            if (this._isRelationUrl(node.getAttribute('href'))) {
                                var assetConfig = {
                                    url: node.getAttribute('href')
                                };
                                if (node.hasAttribute('type')) {
                                    assetConfig.contentType = node.getAttribute('type');
                                }
                                outgoingRelations.push(new relations.HtmlAlternateLink({
                                    from: this,
                                    to: assetConfig,
                                    node: node
                                }));
                            }
                        }
                    }
                } else if (nodeName === 'img') {
                    var srcAttributeValue = node.getAttribute('src'),
                        srcSetAttributeValue = node.getAttribute('srcset');
                    if (srcAttributeValue && this._isRelationUrl(srcAttributeValue)) {
                        outgoingRelations.push(new relations.HtmlImage({
                            from: this,
                            to: {
                                url: srcAttributeValue
                            },
                            node: node
                        }));
                    }
                    if (srcSetAttributeValue && this._isRelationUrl(srcSetAttributeValue)) {
                        outgoingRelations.push(new relations.HtmlImageSrcSet({
                            from: this,
                            to: new (require('./ImageSrcSet'))({
                                text: srcSetAttributeValue
                            }),
                            node: node
                        }));
                    }
                } else if (nodeName === 'a') {
                    var href = node.getAttribute('href');
                    if (this._isRelationUrl(href)) {
                        outgoingRelations.push(new relations.HtmlAnchor({
                            from: this,
                            to: {
                                url: href
                            },
                            node: node
                        }));
                    }
                } else if (nodeName === 'iframe') {
                    if (this._isRelationUrl(node.getAttribute('src'))) {
                        outgoingRelations.push(new relations.HtmlIFrame({
                            from: this,
                            to: {
                                url: node.getAttribute('src')
                            },
                            node: node
                        }));
                    }
                    if (node.hasAttribute('srcdoc')) {
                        outgoingRelations.push(new relations.HtmlIFrameSrcDoc({
                            from: this,
                            to: new Html({
                                text: node.getAttribute('srcdoc')
                            }),
                            node: node
                        }));
                    }
                } else if (nodeName === 'frame') {
                    if (this._isRelationUrl(node.getAttribute('src'))) {
                        outgoingRelations.push(new relations.HtmlFrame({
                            from: this,
                            to: {
                                url: node.getAttribute('src')
                            },
                            node: node
                        }));
                    }
                } else if (nodeName === 'esi:include') {
                    if (this._isRelationUrl(node.getAttribute('src'))) {
                        outgoingRelations.push(new relations.HtmlEdgeSideInclude({
                            from: this,
                            to: {
                                url: node.getAttribute('src')
                            },
                            node: node
                        }));
                    }
                } else if (nodeName === 'video') {
                    if (node.hasAttribute('src')) {
                        if (this._isRelationUrl(node.getAttribute('src'))) {
                            outgoingRelations.push(new relations[nodeName === 'video' ? 'HtmlVideo' : 'HtmlAudio']({
                                from: this,
                                to: {
                                    url: node.getAttribute('src')
                                },
                                node: node
                            }));
                        }
                    }
                    if (node.hasAttribute('poster') && this._isRelationUrl(node.getAttribute('poster'))) {
                        outgoingRelations.push(new relations.HtmlVideoPoster({
                            from: this,
                            to: {
                                url: node.getAttribute('poster')
                            },
                            node: node
                        }));
                    }
                } else if (nodeName === 'audio') {
                    if (this._isRelationUrl(node.getAttribute('src'))) {
                        outgoingRelations.push(new relations.HtmlAudio({
                            from: this,
                            to: {
                                url: node.getAttribute('src')
                            },
                            node: node
                        }));
                    }
                } else if (/^(?:source|track)$/.test(nodeName) && node.parentNode && /^(?:video|audio)$/i.test(node.parentNode.nodeName)) {
                    if (this._isRelationUrl(node.getAttribute('src'))) {
                        outgoingRelations.push(new relations[node.parentNode.nodeName.toLowerCase() === 'video' ? 'HtmlVideo' : 'HtmlAudio']({
                            from: this,
                            to: {
                                url: node.getAttribute('src')
                            },
                            node: node
                        }));
                    }
                } else if (nodeName === 'object') {
                    if (this._isRelationUrl(node.getAttribute('data'))) {
                        outgoingRelations.push(new relations.HtmlObject({
                            from: this,
                            to: {
                                url: node.getAttribute('data')
                            },
                            node: node,
                            attributeName: 'data'
                        }));
                    }
                } else if (nodeName === 'param' && /^(?:src|movie)$/i.test(node.getAttribute('name')) && node.parentNode && node.parentNode.nodeName.toLowerCase() === 'object') {
                    if (this._isRelationUrl(node.getAttribute('value'))) {
                        outgoingRelations.push(new relations.HtmlObject({
                            from: this,
                            to: {
                                url: node.getAttribute('value')
                            },
                            node: node,
                            attributeName: 'value'
                        }));
                    }
                } else if (nodeName === 'applet') {
                    ['archive', 'codebase'].forEach(function (attributeName) {
                        // Note: Only supports one url in the archive attribute. The Html 4.01 spec says it can be a comma-separated list.
                        if (this._isRelationUrl(node.getAttribute(attributeName))) {
                            outgoingRelations.push(new relations.HtmlApplet({
                                from: this,
                                to: {
                                    url: node.getAttribute(attributeName)
                                },
                                node: node,
                                attributeName: attributeName
                            }));
                        }
                    });
                } else if (nodeName === 'embed') {
                    if (this._isRelationUrl(node.getAttribute('src'))) {
                        outgoingRelations.push(new relations.HtmlEmbed({
                            from: this,
                            to: {
                                url: node.getAttribute('src')
                            },
                            node: node
                        }));
                    }
                }
                if (node.hasAttribute('style')) {
                    outgoingRelations.push(new relations.HtmlStyleAttribute({
                        from: this,
                        to: new (require('./Css'))({
                            isExternalizable: false,
                            text: 'bogusselector {' + node.getAttribute('style') + '}'
                        }),
                        node: node
                    }));
                }
                if (node.hasAttribute('data-bind')) {
                    outgoingRelations.push(new relations.HtmlDataBindAttribute({
                        from: this,
                        to: new (require('./JavaScript'))({
                            isExternalizable: false,
                            quoteChar: "'", // Prefer single quotes for consistency with HtmlDataBindAttribute
                            text: '({' + node.getAttribute('data-bind') + '});'
                        }),
                        node: node
                    }));
                }
            } else if (node.nodeType === node.COMMENT_NODE) {
                // <!--[if !IE]> --> ... <!-- <![endif]-->
                // <!--[if IE gte 8]><!--> ... <!--<![endif]--> (evaluated by certain IE versions and all non-IE browsers)
                var matchNonInternetExplorerConditionalComment = node.nodeValue.match(/^\[if\s*([^\]]*)\]>\s*(?:<!)?$/);
                if (matchNonInternetExplorerConditionalComment) {
                    var queueIndex = 0,
                        foundEndMarker = false;
                    while (queueIndex < queue.length) {
                        var cursor = queue[queueIndex];
                        if (cursor.nodeType === cursor.COMMENT_NODE && /^\s*<!\[endif\]\s*$/.test(cursor.nodeValue)) {
                            var div = this.parseTree.createElement('div');
                            queue.splice(0, queueIndex).forEach(function (node) {
                                div.appendChild(node.cloneNode(true));
                            });
                            outgoingRelations.push(new relations.HtmlConditionalComment({
                                from: this,
                                to: new Html({
                                    isExternalizable: false,
                                    text: div.innerHTML
                                }),
                                isInverted: true,
                                condition: matchNonInternetExplorerConditionalComment[1],
                                node: node,
                                endNode: queue.shift()
                            }));
                            foundEndMarker = true;
                            break;
                        }
                        queueIndex += 1;
                    }
                    if (!foundEndMarker) {
                        var warning = new errors.SyntaxError({message: "assets.Html: Skipped conditional comment because no end marker was found: " + node.nodeValue, asset: this});
                        if (this.assetGraph) {
                            this.assetGraph.emit('warn', warning);
                        } else {
                            console.warn(this.toString() + ': ' + warning.message);
                        }
                    }
                } else {
                    // <!--[if IE 6]> .... <![endif]-->
                    var matchConditionalComment = node.nodeValue.match(/^\[if\s*([^\]]*)\]\>([\s\S]*)<!\[endif\]$/);
                    if (matchConditionalComment) {
                        outgoingRelations.push(new relations.HtmlConditionalComment({
                            from: this,
                            to: new Html({
                                text: matchConditionalComment[2]
                            }),
                            node: node,
                            condition: matchConditionalComment[1]
                        }));
                    } else {
                        var matchKnockoutContainerless = node.nodeValue.match(/^\s*ko\s+([\s\S]+)$/);
                        if (matchKnockoutContainerless) {
                            outgoingRelations.push(new relations.HtmlKnockoutContainerless({
                                from: this,
                                to: new (require('./JavaScript'))({
                                    isExternalizable: false,
                                    quoteChar: "'", // Prefer single quotes when serializing to avoid excessive &quot;
                                    text: '({' + matchKnockoutContainerless[1] + '});'
                                }),
                                node: node
                            }));
                        }
                    }
                }
            }
        }
        return outgoingRelations;
    },

    /*
     * Leaves conditional comments, Knockout.js containerless bindings, and SSIs alone even if removeComments is true.
     */
    _reformatParseTree: function (removeWhiteSpace, removeComments) {
        (function processNode(node, isWithinSensitiveTag, canRemoveLeadingWhiteSpace, canRemoveTrailingWhiteSpace) {
            var isInBlockLevelContext = isBlockLevelByTagName[node.nodeName.toLowerCase()] || false;
            isWithinSensitiveTag = isWithinSensitiveTag || isSensitiveByTagName[node.nodeName.toLowerCase()] || false;
            for (var i = 0 ; i < node.childNodes.length ; i += 1) {
                var childNode = node.childNodes[i];

                if (childNode.nodeType === childNode.ELEMENT_NODE) {
                    canRemoveLeadingWhiteSpace = processNode(childNode,
                                                             isWithinSensitiveTag,
                                                             canRemoveLeadingWhiteSpace,
                                                             childNode.nextSibling ? childNode.nextSibling.nodeType === childNode.TEXT_NODE && /^[ \t\n\r]/.test(childNode.nextSibling.nodeValue) : canRemoveTrailingWhiteSpace
                                                             );
                } else if (childNode.nodeType === childNode.COMMENT_NODE) {
                    if (/^\s*\/?ko\s/.test(childNode.nodeValue)) {
                        // Knockout.js containerless binding start or end marker. Remove superfluous whitespace if removeWhiteSpace is true:
                        if (removeWhiteSpace) {
                            childNode.nodeValue = childNode.nodeValue.replace(/^\s+|\s+$/g, '');
                        }
                    } else if (removeComments && !/^#|^\[if|^<!\[endif\]/.test(childNode.nodeValue)) {
                        // Non-SSI, non-conditional comment
                        node.removeChild(childNode);
                        i -= 1;
                    }
                } else if (childNode.nodeType === childNode.TEXT_NODE) {
                    var childNodeValue = childNode.nodeValue;
                    if (childNode.previousSibling && childNode.previousSibling.nodeType === childNode.TEXT_NODE) {
                        // Collapse with neighbouring text node:
                        childNodeValue = childNode.previousSibling.nodeValue + childNodeValue;
                        node.removeChild(childNode.previousSibling);
                        i -= 1;
                    }
                    if (removeWhiteSpace && !isWithinSensitiveTag) {
                        if (canRemoveLeadingWhiteSpace) {
                            childNodeValue = childNodeValue.replace(/^[ \n\r\t]+/, '');
                        }
                        if (canRemoveTrailingWhiteSpace && (!childNode.nextSibling || childNode.nextSibling.nodeType === childNode.ELEMENT_NODE && isBlockLevelByTagName[childNode.nextSibling.nodeName.toLowerCase()])) {
                            childNodeValue = childNodeValue.replace(/[ \n\r\t]+$/, '');
                        }
                        childNodeValue = childNodeValue.replace(/[ \n\r\t]{2,}/g, ' ');
                    }
                    if (childNodeValue) {
                        canRemoveLeadingWhiteSpace = /[ \n\r\t]$/.test(childNodeValue);
                        childNode.nodeValue = childNodeValue;
                    } else {
                        node.removeChild(childNode);
                        i -= 1;
                    }
                }
            }
            if (node.childNodes.length === 0 && !isInBlockLevelContext) {
                // Whitespace after an empty tag in non-block level context should be preserved
                return false;
            } else {
                return canRemoveLeadingWhiteSpace;
            }
        }(this.parseTree, false, true, true));
    },

    minify: function () {
        this._reformatParseTree(true, true);
        this.isPretty = false;
        this.markDirty();
        return this;
    },

    prettyPrint: function () {
        this._reformatParseTree(true, false);
        this.isPretty = true;
        this.markDirty();
        return this;
    }
});

// Grrr...
Html.prototype.__defineSetter__('text', Text.prototype.__lookupSetter__('text'));

module.exports = Html;
