(function (factory) {
    if (typeof define === 'function' && define.amd) {
        define(['taucharts'], function (tauPlugins) {
            return factory(tauPlugins);
        });
    } else if (typeof module === 'object' && module.exports) {
        var tauPlugins = require('taucharts');
        module.exports = factory(tauPlugins);
    } else {
        factory(this.tauCharts);
    }
})(function (tauCharts) {

    var d3 = tauCharts.api.d3;
    var utils = tauCharts.api.utils;
    var pluginsSDK = tauCharts.api.pluginsSDK;
    var TARGET_SVG_CLASS = 'graphical-report__tooltip-target';
    var TARGET_STUCK_CLASS = 'graphical-report__tooltip-target-stuck';

    var tpl = function (text) {
        return utils.template(text, {interpolate: /\{\{([\s\S]+?)\}\}/g});
    };

    function GroupTooltip(xSettings) {

        var settings = utils.defaults(
            xSettings || {},
            {
                // add default settings here
                fields: null,
                formatters: {},
                dockToData: false,
                recordsLimit: 8,
                aggregationGroupFields: [],
                onRevealAggregation: function (filters, row) {
                    console.log(
                        'Setup [onRevealAggregation] callback and filter original data by the following criteria: ',
                        JSON.stringify(filters, null, 2));
                }
            });

        var plugin = {

            init: function (chart) {

                this._chart = chart;
                this._metaInfo = {};
                this._skipInfo = {};
                this._chart.getSpec().unit.guide.highlightMultiple = true;

                // NOTE: for compatibility with old Tooltip implementation.
                Object.assign(this, utils.omit(settings, 'fields', 'getFields'));

                this._tooltip = this._chart.addBalloon(
                    {
                        spacing: 24,
                        auto: true,
                        effectClass: 'fade'
                    });

                var revealAggregationBtn = ((settings.aggregationGroupFields.length > 0) ?
                        (this.templateRevealAggregation) :
                        ('')
                );

                var template = tpl(this.template);
                var tooltipNode = this.getTooltipNode();

                this._tooltip
                    .content(template({
                        revealTemplate: '',//revealAggregationBtn,
                        excludeTemplate: ''//this.templateExclude
                    }));

                tooltipNode
                    .addEventListener('click', function (e) {

                        var target = e.target;

                        while (target !== e.currentTarget && target !== null) {
                            if (target.classList.contains('i-role-exclude')) {
                                this._exclude(target.dataset.id);
                                this.setState({
                                    highlight: null,
                                    isStuck: false
                                });
                            }

                            if (target.classList.contains('i-role-reveal')) {
                                this._reveal();
                                this.setState({
                                    highlight: null,
                                    isStuck: false
                                });
                            }

                            target = target.parentNode;
                        }

                    }.bind(this), false);

                this._scrollHandler = function (e) {
                    if (e.target.matches('.graphical-report__tooltip__table-wrapper')) {
                        return;
                    }
                    this.setState({
                        highlight: null,
                        isStuck: false
                    });
                }.bind(this);
                window.addEventListener('scroll', this._scrollHandler, true);

                this._outerClickHandler = function (e) {
                    var tooltipRect = this.getTooltipNode().getBoundingClientRect();
                    if ((e.clientX < tooltipRect.left) ||
                        (e.clientX > tooltipRect.right) ||
                        (e.clientY < tooltipRect.top) ||
                        (e.clientY > tooltipRect.bottom)
                    ) {
                        this.setState({
                            highlight: null,
                            isStuck: false
                        });
                    }
                }.bind(this);

                // Handle initial state
                this.setState(this.state);

                this.afterInit(tooltipNode);
            },

            getTooltipNode: function () {
                return this._tooltip.getElement();
            },

            state: {
                highlight: null,
                isStuck: false
            },

            setState: function (newState) {
                var prev = this.state;
                var state = this.state = Object.assign({}, prev, newState);
                prev.highlight = prev.highlight || {data: null, groupDim: null, cursor: null, unit: null};
                state.highlight = state.highlight || {data: null, groupDim: null, cursor: null, unit: null};

                // If stuck, treat that data has not changed
                if (state.isStuck && prev.highlight.data) {
                    state.highlight = prev.highlight;
                }

                // Show/hide tooltip
                if (state.highlight.data !== prev.highlight.data) {
                    if (state.highlight.data) {
                        this.hideTooltip();
                        this.showTooltip(
                            state.highlight.data,
                            state.highlight.cursor,
                            state.highlight.groupDim
                        );
                        this._setTargetSvgClass(true);
                        requestAnimationFrame(function () {
                            this._setTargetSvgClass(true);
                        }.bind(this));
                    } else if (!state.isStuck && prev.highlight.data && !state.highlight.data) {
                        this._removeFocus();
                        this.hideTooltip();
                        this._setTargetSvgClass(false);
                    }
                }

                // Update tooltip position
                if (state.highlight.data && (
                    !prev.highlight.cursor ||
                    state.highlight.cursor.x !== prev.highlight.cursor.x ||
                    state.highlight.cursor.y !== prev.highlight.cursor.y
                )) {
                    this._tooltip.position(state.highlight.cursor.x, state.highlight.cursor.y);
                }

                // Stick/unstick tooltip
                var tooltipNode = this.getTooltipNode();
                if (state.isStuck !== prev.isStuck) {
                    if (state.isStuck) {
                        window.addEventListener('click', this._outerClickHandler, true);
                        tooltipNode.classList.add('stuck');
                        this._setTargetStuckClass(true);
                        this._tooltip.updateSize();
                    } else {
                        window.removeEventListener('click', this._outerClickHandler, true);
                        tooltipNode.classList.remove('stuck');
                        // NOTE: Prevent showing tooltip immediately
                        // after pointer events appear.
                        requestAnimationFrame(function () {
                            this._setTargetStuckClass(false);
                        }.bind(this));
                    }
                }
            },

            showTooltip: function (data, cursor, groupByField) {

                var content = this.getTooltipNode().querySelectorAll('.i-role-content')[0];
                if (content) {
                    var fields = (
                        settings.fields
                        ||
                        ((typeof settings.getFields === 'function') && settings.getFields(this._chart))
                        ||
                        Object.keys(data[0])
                    );
                    content.innerHTML = this.render(data, fields, groupByField);
                }

                this._tooltip
                    .position(cursor.x, cursor.y)
                    .place('bottom-right')
                    .show()
                    .updateSize();
            },

            hideTooltip: function (e) {
                window.removeEventListener('click', this._outerClickHandler, true);
                this._tooltip.hide();
            },

            destroy: function () {
                window.removeEventListener('scroll', this._scrollHandler, true);
                this._setTargetSvgClass(false);
                this.setState({
                    highlight: null,
                    isStuck: false
                });
                this._tooltip.destroy();
            },

            _subscribeToHover: function () {

                var elementsToMatch = [
                    'ELEMENT.LINE',
                    'ELEMENT.AREA',
                    'ELEMENT.PATH',
                    'ELEMENT.INTERVAL',
                    'ELEMENT.INTERVAL.STACKED',
                    'ELEMENT.POINT'
                ];

                this._chart
                    .select(function (node) {
                        return (elementsToMatch.indexOf(node.config.type) >= 0);
                    })
                    .forEach(function (node) {

                        node.on('data-hover', function (sender, e) {
                            var bodyRect = document.body.getBoundingClientRect();
                            this.setState({
                                highlight: (e.data ? {
                                    data: e.data,
                                    groupDim: e.groupDim,
                                    cursor: {
                                        x: (e.event.clientX - bodyRect.left),
                                        y: (e.event.clientY - bodyRect.top)
                                    },
                                    unit: sender
                                } : null)
                            });
                        }.bind(this));

                        node.on('data-click', function (sender, e) {
                            var bodyRect = document.body.getBoundingClientRect();
                            this.setState(e.data ? {
                                highlight: {
                                    data: e.data,
                                    groupDim: e.groupDim,
                                    cursor: {
                                        x: (e.event.clientX - bodyRect.left),
                                        y: (e.event.clientY - bodyRect.top)
                                    },
                                    unit: sender
                                },
                                isStuck: true
                            } : {
                                    highlight: null,
                                    isStuck: null
                                });
                        }.bind(this));
                    }, this);
            },

            afterInit: function (tooltipNode) {
                // for override
            },

            render: function (_data, _fields, groupByField) {
                var self = this;
                var fields = _fields.filter(function (f) {
                    return (f !== groupByField);
                });
                var model = self.state.highlight.unit.screenModel;
                var isLimited = (_data.length > settings.recordsLimit);
                var data = _data.slice(0).sort(function (a, b) {
                    var dx = (model.x(a) - model.x(b));
                    if (dx === 0) {
                        return (model.y(a) - model.y(b));
                    }
                    return dx;
                });

                return [
                    (groupByField ? self.groupByTemplate({
                        field: self._getLabel(groupByField),
                        value: self._getFormat(groupByField)(data[0][groupByField])
                    }) : ''),
                    self.tableTemplate({
                        headers: fields.map(function (f) {
                            return self.headerCellTemplate({
                                field: self._getLabel(f)
                            });
                        }).join(''),
                        rows: data.map(function (d, i) {
                            return self.rowTemplate({
                                rowId: model.id(d),
                                color: model.color(d),
                                colorClass: model.class(d),
                                limitedClass: (i < settings.recordsLimit ? '' :
                                    'graphical-report__tooltip__table__row-limited'
                                ),
                                cells: fields.map(function (f) {
                                    return self.cellTemplate({
                                        value: self._getFormat(f)(d[f]),
                                        numericClass: (typeof d[f] !== 'number' ? '' :
                                            'graphical-report__tooltip__table__cell-numeric'
                                        )
                                    });
                                }).join('')
                            });
                        }).join('')
                    }),
                    isLimited ? self.limitTemplate({
                        text: '...'
                    }) : '',
                ].join('');
            },

            _getFormat: function (k) {
                var meta = this._metaInfo[k] || {
                    format: function (x) {
                        return x;
                    }
                };
                return meta.format;
            },

            _getLabel: function (k) {
                var meta = this._metaInfo[k] || { label: k };
                return meta.label;
            },

            _removeFocus: function () {
                var filter = function () {
                    return null;
                };
                this._chart
                    .select(function () {
                        return true;
                    }).forEach(function (unit) {
                        unit.fire('highlight', filter);
                        unit.fire('highlight-data-points', filter);
                    });
            },

            _reveal: function () {
                var aggregatedRow = this.state.highlight.data;
                var groupFields = (settings.aggregationGroupFields || []);
                var descFilters = groupFields.reduce(function (memo, k) {
                    if (aggregatedRow.hasOwnProperty(k)) {
                        memo[k] = aggregatedRow[k];
                    }
                    return memo;
                }, {});

                settings.onRevealAggregation(descFilters, aggregatedRow);
            },

            _exclude: function (targetId) {
                var model = this.state.highlight.unit.screenModel;
                var targetRow = this.state.highlight.data.find(function (row) {
                    return (String(model.id(row)) === targetId);
                });
                this._chart
                    .addFilter({
                        tag: 'exclude',
                        predicate: function (row) {
                            return (row !== targetRow);
                        }
                    });
                this._chart.refresh();
            },

            onRender: function () {

                var info = this._getFormatters();
                this._metaInfo = info.meta;
                this._skipInfo = info.skip;

                this._subscribeToHover();

                this.setState({
                    highlight: null,
                    isStuck: false
                });
            },

            _setTargetSvgClass: function (isSet) {
                d3.select(this._chart.getSVG()).classed(TARGET_SVG_CLASS, isSet);
            },

            _setTargetStuckClass: function (isSet) {
                d3.select(this._chart.getLayout().layout).classed(TARGET_STUCK_CLASS, isSet);
            },

            templateRevealAggregation: [
                '<div class="i-role-reveal graphical-report__tooltip__vertical">',
                '   <div class="graphical-report__tooltip__vertical__wrap">',
                '       Reveal',
                '   </div>',
                '</div>'
            ].join(''),

            templateExclude: [
                '<div class="i-role-exclude graphical-report__tooltip__exclude">',
                '   <div class="graphical-report__tooltip__exclude__wrap">',
                '       <span class="tau-icon-close-gray"></span>',
                '       Exclude',
                '   </div>',
                '</div>'
            ].join(''),

            template: [
                '<div class="i-role-content graphical-report__tooltip__content"></div>',
                '{{revealTemplate}}',
                '{{excludeTemplate}}'
            ].join(''),

            groupByTemplate: tpl([
                '<div class="graphical-report__tooltip__groupby">',
                '<span class="graphical-report__tooltip__groupby__field">{{field}}</span>',
                '<span class="graphical-report__tooltip__groupby__value">{{value}}</span>',
                '</div>'
            ].join('')),

            tableTemplate: tpl([
                '<div class="graphical-report__tooltip__table-wrapper-fixed">',
                '<div class="graphical-report__tooltip__table-wrapper">',
                '<div class="graphical-report__tooltip__table">',

                '<div class="graphical-report__tooltip__table__header">',

                '<div class="graphical-report__tooltip__table__row">',
                '<div',
                ' class="graphical-report__tooltip__table__header__placeholder',
                ' graphical-report__tooltip__table__cell',
                ' graphical-report__tooltip__table__col-small">&nbsp;',
                '<div class="graphical-report__tooltip__table__header__placeholder-fixed',
                ' graphical-report__tooltip__table__header__cell__value-fixed">&nbsp;</div>',
                '</div>',
                '{{headers}}',
                '</div>',

                '</div>',

                '<div class="graphical-report__tooltip__table__rows-group">',
                '{{rows}}',
                '</div>',

                '</div>',
                '</div>',
                '</div>'
            ].join('')),

            headerCellTemplate: tpl([
                '<div',
                ' class="graphical-report__tooltip__table__cell',
                ' graphical-report__tooltip__table__header__cell">',

                '<div class="graphical-report__tooltip__table__cell__value',
                ' graphical-report__tooltip__table__header__cell__value">',
                '{{field}}',

                // Note: Fix header position for scroll.
                '<div class="graphical-report__tooltip__table__cell__value',
                ' graphical-report__tooltip__table__header__cell__value',
                ' graphical-report__tooltip__table__header__cell__value-fixed">',
                '{{field}}',
                '</div>',

                '</div>',

                '</div>'
            ].join('')),

            rowTemplate: tpl([
                '<div class="graphical-report__tooltip__table__row {{limitedClass}}">',
                '<div class="graphical-report__tooltip__table__cell graphical-report__tooltip__table__col-small">',
                '<span',
                ' class="graphical-report__tooltip__table__row__color {{colorClass}}"',
                ' style="background-color: {{color}};"></span>',
                '</div>',
                '{{cells}}',
                // '<div class="graphical-report__tooltip__table__cell',
                // ' graphical-report__tooltip__table__row__actions">',
                // '<span class="graphical-report__tooltip__exclude i-role-exclude" data-id={{rowId}}>',
                // '<span class="tau-icon-close-gray"></span> Exclude',
                // '</span>',
                // '</div>',
                '</div>'
            ].join('')),

            cellTemplate: tpl([
                '<div class="graphical-report__tooltip__table__cell {{numericClass}}">',
                '<span class="graphical-report__tooltip__table__cell__value">',
                '{{value}}',
                '</span>',
                '</div>'
            ].join('')),

            limitTemplate: tpl([
                '<div class="graphical-report__tooltip__limit">',
                '{{text}}',
                '</span>'
            ].join('')),

            _getFormatters: function () {

                var info = pluginsSDK.extractFieldsFormatInfo(this._chart.getSpec());
                var skip = {};
                Object.keys(info).forEach(function (k) {

                    if (info[k].isComplexField) {
                        skip[k] = true;
                    }

                    if (info[k].parentField) {
                        delete info[k];
                    }
                });

                var toLabelValuePair = function (x) {

                    var res = {};

                    if (typeof x === 'function' || typeof x === 'string') {
                        res = {format: x};
                    } else if (utils.isObject(x)) {
                        res = utils.pick(x, 'label', 'format', 'nullAlias');
                    }

                    return res;
                };

                Object.keys(settings.formatters).forEach(function (k) {

                    var fmt = toLabelValuePair(settings.formatters[k]);

                    info[k] = Object.assign(
                        ({label: k, nullAlias: ('No ' + k)}),
                        (info[k] || {}),
                        (utils.pick(fmt, 'label', 'nullAlias')));

                    if (fmt.hasOwnProperty('format')) {
                        info[k].format = (typeof fmt.format === 'function') ?
                            (fmt.format) :
                            (tauCharts.api.tickFormat.get(fmt.format, info[k].nullAlias));
                    } else {
                        info[k].format = (info[k].hasOwnProperty('format')) ?
                            (info[k].format) :
                            (tauCharts.api.tickFormat.get(null, info[k].nullAlias));
                    }
                });

                return {
                    meta: info,
                    skip: skip
                };
            }
        };

        return plugin;
    }

    tauCharts.api.plugins.add('group-tooltip', GroupTooltip);

    return GroupTooltip;
});