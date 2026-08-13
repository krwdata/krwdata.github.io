/* ===========================================================================
   woodridge.js — charts for the Woodridge error-trend + churn case study.

   Four graphics live in the sticky column. Steps show one at a time and push
   state into it; the interesting one is `rates`, where the same lines morph
   from the broken model to the corrected one while the y axis collapses from
   1200% to single digits. Animating both at once is the whole point: it is
   what the fix actually felt like.
   =========================================================================== */
(function () {
  'use strict';

  var B = document.documentElement.getAttribute('data-base') || '';
  var CATS = ['RTD', 'IGNITOR', 'HIGH_TEMP', 'FAN', 'AUGER'];
  /* Slots 1,2,3,4,6 of the categorical palette. The temperature sensor keeps
     slot 1 because it is the series the story is about; the others are still
     given real hues rather than five greys, because the legend maps colour to
     category and five greys cannot do that. Focus is expressed through opacity
     and stroke weight instead. */
  var COLOR = {
    RTD: '#E0700A', IGNITOR: '#4A93D6', HIGH_TEMP: '#D3468F',
    FAN: '#B08E18', AUGER: '#22A8AE'
  };
  var LABEL = {
    RTD: 'Temp sensor (RTD)', IGNITOR: 'Igniter', HIGH_TEMP: 'High temp',
    FAN: 'Fan', AUGER: 'Auger'
  };

  var D = {};              // loaded data
  var rates, anchor, funnel, attribution;

  /* ======================================================================
     1. RATES — weekly % of cooks affected, broken vs corrected
     ====================================================================== */
  function makeRates(el) {
    var f = CH.frame(el, { top: 22, right: 92, bottom: 32, left: 52 });
    var x = d3.scaleLinear().range([0, f.iw]);
    var y = d3.scaleLinear().range([f.ih, 0]);

    var gridG = f.g.append('g').attr('class', 'grid');
    var xAxisG = f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')');
    var yAxisG = f.g.append('g').attr('class', 'axis');
    var hundredG = f.g.append('g').attr('class', 'hundred').style('opacity', 0);
    hundredG.append('line').attr('stroke', 'var(--bad)').attr('stroke-dasharray', '4 3');
    hundredG.append('text').attr('class', 'annot-sub').style('fill', 'var(--bad)')
      .attr('dy', -5).text('100% — a rate cannot exceed this');

    var interG = f.g.append('g').attr('class', 'intervention').style('opacity', 0);
    interG.append('line').attr('stroke', 'var(--ash-dim)').attr('stroke-dasharray', '3 3');
    interG.append('text').attr('class', 'chart-sub').attr('dy', -6)
      .attr('text-anchor', 'middle').text('COMPONENT REVISION');

    var linesG = f.g.append('g');
    var labelsG = f.g.append('g');
    var annotG = f.g.append('g');

    var line = d3.line()
      .x(function (d) { return x(d.week); })
      .y(function (d) { return y(d.rate); })
      .curve(d3.curveMonotoneX);

    // Series keyed by category, each holding both versions of the values.
    var series = CATS.map(function (c) {
      return {
        key: c,
        broken: D.broken.filter(function (r) { return r.category === c; })
                        .map(function (r) { return { week: r.week, rate: r.rate }; }),
        fixed: D.trends.filter(function (r) { return r.category === c; })
                       .map(function (r) { return { week: r.week, rate: r.rate }; })
      };
    });

    x.domain([0, d3.max(D.trends, function (r) { return r.week; })]);

    var paths = linesG.selectAll('path').data(series).enter().append('path')
      .attr('class', 'series-line')
      .attr('stroke', function (d) { return COLOR[d.key]; })
      .attr('stroke-width', function (d) { return d.key === 'RTD' ? 2.4 : 1.6; });

    // Only the focused series gets an in-chart label; the rest are identified
    // by the legend above. Five labels at the right edge always collide.
    var endLabels = labelsG.selectAll('text').data(series).enter().append('text')
      .attr('class', 'annot-sub')
      .attr('x', f.iw + 8).attr('dy', '0.32em')
      .style('fill', function (d) { return COLOR[d.key]; })
      .style('font-size', '10.5px').style('opacity', 0)
      .text(function (d) { return LABEL[d.key]; });

    var legendEl = el.closest('figure').querySelector('[data-legend]');
    if (legendEl) {
      legendEl.innerHTML = CATS.map(function (c) {
        return '<span class="legend-item" data-k="' + c + '">' +
               '<span class="legend-swatch" style="background:' + COLOR[c] + '"></span>' +
               LABEL[c] + '</span>';
      }).join('');
    }

    var state = { mode: 'fixed', t: 1, focus: null, zoom: false };

    function values(s) {
      // t = 0 broken, 1 corrected. Interpolating point by point is what makes
      // the chart *snap* rather than cut.
      if (state.t >= 1) return s.fixed;
      if (state.t <= 0) return s.broken;
      return s.fixed.map(function (p, i) {
        var b = s.broken[i] ? s.broken[i].rate : p.rate;
        return { week: p.week, rate: b + (p.rate - b) * state.t };
      });
    }

    function redraw() {
      paths.attr('d', function (d) { return line(values(d)); });
      endLabels.attr('y', function (d) {
        var v = values(d);
        return y(v[v.length - 1].rate);
      });
      yAxisG.call(d3.axisLeft(y).ticks(5).tickFormat(function (v) { return v + '%'; }));
      gridG.call(d3.axisLeft(y).ticks(5).tickSize(-f.iw).tickFormat(''));
      gridG.select('.domain').remove();
      hundredG.select('line').attr('x1', 0).attr('x2', f.iw).attr('y1', y(100)).attr('y2', y(100));
      hundredG.select('text').attr('x', f.iw).attr('y', y(100)).attr('text-anchor', 'end');
    }

    function axes() {
      xAxisG.call(d3.axisBottom(x).ticks(6).tickFormat(function (w) { return 'wk ' + w; }));
      var iw = D.meta.intervention_week;
      interG.select('line').attr('x1', x(iw)).attr('x2', x(iw)).attr('y1', 0).attr('y2', f.ih);
      interG.select('text').attr('x', x(iw)).attr('y', 0);
    }
    axes();

    function update(s) {
      var dur = CH.reduced ? 0 : 950;
      var tFrom = state.t;
      var yFrom = y.domain().slice();
      var xFrom = x.domain().slice();

      // Replace rather than merge: a step that omits `focus` means no focus.
      state.t = s.t === undefined ? state.t : s.t;
      state.focus = s.focus || null;
      state.annot = s.annot || null;
      state.xzoom = s.xzoom || null;

      var yTo = state.t >= 1
        ? [0, d3.max(D.trends, function (r) { return r.rate; }) * 1.18]
        : [0, 1250];
      var xTo = state.xzoom || [0, d3.max(D.trends, function (r) { return r.week; })];

      var iy = d3.interpolate(yFrom, yTo);
      var ix = d3.interpolate(xFrom, xTo);
      var it = d3.interpolate(tFrom, state.t);

      f.g.transition().duration(dur).ease(d3.easeCubicInOut)
        .tween('rates', function () {
          return function (k) {
            y.domain(iy(k));
            x.domain(ix(k));
            state.t = it(k);
            redraw();
            axes();
          };
        });

      CH.show(hundredG, state.t < 0.5, dur);
      CH.show(interG, state.focus === 'RTD', dur);

      paths.transition().duration(dur)
        .attr('opacity', function (d) {
          if (!state.focus) return 1;
          return d.key === state.focus ? 1 : 0.16;
        })
        .attr('stroke-width', function (d) {
          return d.key === state.focus ? 2.8 : (d.key === 'RTD' ? 2.2 : 1.5);
        });
      endLabels.transition().duration(dur)
        .style('opacity', function (d) { return d.key === state.focus ? 1 : 0; });
      if (legendEl) {
        d3.select(legendEl).selectAll('.legend-item')
          .style('opacity', function () {
            var k = this.getAttribute('data-k');
            return !state.focus || k === state.focus ? 1 : 0.35;
          });
      }

      // Annotations are positioned once the scales have finished moving,
      // otherwise the leader line points at where the data used to be.
      annotG.selectAll('*').remove();
      if (state.annot) {
        var a = state.annot;
        window.setTimeout(function () {
          if (state.annot !== a) return;
          var v = series.filter(function (s2) { return s2.key === a.cat; })[0];
          var pt = values(v)[a.week];
          if (!pt) return;
          CH.annotate(annotG, {
            key: 'a', x: x(pt.week), y: y(pt.rate),
            dx: a.dx, dy: a.dy, label: a.label, sub: a.sub
          }).style('opacity', 0).transition().duration(360).style('opacity', 1);
        }, dur);
      }
    }

    redraw();
    return { update: update, resize: function () {} };
  }

  /* ======================================================================
     2. ANCHOR — one week boundary, ten cooks, two clocks
     ====================================================================== */
  function makeAnchor(el) {
    var f = CH.frame(el, { top: 30, right: 22, bottom: 34, left: 22 });
    var rows = D.anchor.rows;
    var boundary = new Date(D.anchor.boundary);

    // Note the unary + on both ends: `Date + number` concatenates strings in
    // JavaScript, which silently poisons the whole scale.
    var pad = 1000 * 60 * 60 * 2;
    var ext = [
      +d3.min(rows, function (r) { return new Date(r.start); }) - pad,
      +d3.max(rows, function (r) { return new Date(r.alert); }) + pad
    ];
    var x = d3.scaleTime().domain(ext).range([0, f.iw]);
    var yb = d3.scaleBand().domain(rows.map(function (r) { return r.cook; }))
      .range([0, f.ih]).padding(0.42);

    f.g.append('g').attr('class', 'axis')
      .attr('transform', 'translate(0,' + f.ih + ')')
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat('%a %H:%M')));

    // The week boundary itself.
    var bg = f.g.append('g');
    bg.append('rect').attr('x', 0).attr('y', -10).attr('width', x(boundary))
      .attr('height', f.ih + 10).attr('fill', 'var(--accent-mark)').attr('opacity', 0.05);
    bg.append('line').attr('x1', x(boundary)).attr('x2', x(boundary))
      .attr('y1', -14).attr('y2', f.ih).attr('stroke', 'var(--ink)').attr('stroke-width', 1.5);
    bg.append('text').attr('class', 'chart-sub').attr('x', x(boundary) - 6).attr('y', -18)
      .attr('text-anchor', 'end').text('WEEK N');
    bg.append('text').attr('class', 'chart-sub').attr('x', x(boundary) + 6).attr('y', -18)
      .text('WEEK N+1');

    var g = f.g.selectAll('g.cook').data(rows).enter().append('g')
      .attr('class', 'cook')
      .attr('transform', function (d) { return 'translate(0,' + yb(d.cook) + ')'; });

    g.append('rect').attr('class', 'bar')
      .attr('x', function (d) { return x(new Date(d.start)); })
      .attr('width', function (d) { return Math.max(3, x(new Date(d.end)) - x(new Date(d.start))); })
      .attr('height', yb.bandwidth()).attr('rx', 2)
      .attr('fill', 'var(--neutral)').attr('opacity', 0.5);

    // Where the denominator counts the cook: its start.
    g.append('circle').attr('class', 'start-dot')
      .attr('cx', function (d) { return x(new Date(d.start)); })
      .attr('cy', yb.bandwidth() / 2).attr('r', 4)
      .attr('fill', 'var(--ink)').style('opacity', 0);

    // Where the numerator counted it: the alert.
    g.append('circle').attr('class', 'alert-dot')
      .attr('cx', function (d) { return x(new Date(d.alert)); })
      .attr('cy', yb.bandwidth() / 2).attr('r', 4.5)
      .attr('fill', 'var(--accent-mark)').style('opacity', 0);

    g.append('line').attr('class', 'link')
      .attr('x1', function (d) { return x(new Date(d.start)); })
      .attr('x2', function (d) { return x(new Date(d.alert)); })
      .attr('y1', yb.bandwidth() / 2).attr('y2', yb.bandwidth() / 2)
      .attr('stroke', 'var(--accent-mark)').attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 2').style('opacity', 0);

    var note = f.g.append('text').attr('class', 'annot-sub')
      .attr('x', 0).attr('y', f.ih + 30).style('opacity', 0);

    function update(s) {
      var dur = CH.reduced ? 0 : 500;
      var mode = s.mode || 'cooks';
      CH.show(g.selectAll('.start-dot'), mode !== 'cooks', dur);
      CH.show(g.selectAll('.alert-dot'), mode === 'alerts' || mode === 'split', dur);
      CH.show(g.selectAll('.link'), mode === 'split', dur);

      g.select('.bar').transition().duration(dur)
        .attr('fill', function (d) {
          if (mode === 'split' && d.straddles) return 'var(--accent-mark)';
          return 'var(--neutral)';
        })
        .attr('opacity', function (d) {
          if (mode === 'split') return d.straddles ? 0.28 : 0.35;
          return 0.5;
        });

      var n = rows.filter(function (r) { return r.straddles; }).length;
      note.text(mode === 'split'
        ? n + ' of these ' + rows.length + ' cooks land in different weeks depending on which clock you read'
        : '');
      CH.show(note, mode === 'split', dur);
    }

    return { update: update };
  }

  /* ======================================================================
     3. FUNNEL — fleet → active → churned → attributed
     ====================================================================== */
  function makeFunnel(el) {
    var f = CH.frame(el, { top: 20, right: 26, bottom: 20, left: 26 });
    var rows = D.churn.funnel;
    var x = d3.scaleLinear().domain([0, rows[0].value]).range([0, f.iw]);
    var y = d3.scaleBand().domain(rows.map(function (r) { return r.stage; }))
      .range([0, f.ih]).padding(0.45);

    var g = f.g.selectAll('g').data(rows).enter().append('g')
      .attr('transform', function (d) { return 'translate(0,' + y(d.stage) + ')'; });

    g.append('rect').attr('height', y.bandwidth()).attr('rx', 2)
      .attr('width', 0)
      .attr('fill', function (d, i) { return i === rows.length - 1 ? 'var(--accent-mark)' : 'var(--neutral)'; })
      .attr('opacity', function (d, i) { return i === rows.length - 1 ? 1 : 0.32; });

    g.append('text').attr('class', 'annot-label').attr('x', 0).attr('y', -8)
      .style('font-size', '12.5px')
      .text(function (d) { return d.stage; });

    g.append('text').attr('class', 'annot-sub').attr('x', 0)
      .attr('y', y.bandwidth() / 2).attr('dy', '0.32em').attr('dx', 8)
      .style('font-weight', '700')
      .text(function (d) { return CH.fmt.int(d.value); });

    g.append('text').attr('class', 'annot-sub').attr('text-anchor', 'end')
      .attr('x', f.iw).attr('y', -8).style('font-size', '11px')
      .text(function (d) { return d.detail; })
      .style('opacity', 0);

    function update(s) {
      var upto = s.upto === undefined ? rows.length : s.upto;
      g.select('rect').transition().duration(CH.reduced ? 0 : 800).delay(function (d, i) { return i * 130; })
        .attr('width', function (d, i) { return i < upto ? Math.max(2, x(d.value)) : 0; });
      g.selectAll('text').transition().duration(400).delay(function (d, i) { return i * 90; })
        .style('opacity', function (d, i) { return 1; });
      g.filter(function (d, i) { return i >= upto; }).selectAll('text')
        .transition().duration(300).style('opacity', 0.2);
    }
    return { update: update };
  }

  /* ======================================================================
     4. ATTRIBUTION — which component sends a grill quiet
     ====================================================================== */
  function makeAttribution(el) {
    var f = CH.frame(el, { top: 22, right: 60, bottom: 30, left: 118 });
    var rows = D.churn.attribution;
    var x = d3.scaleLinear().domain([0, d3.max(rows, function (r) { return r.devices; }) * 1.08])
      .range([0, f.iw]);
    var y = d3.scaleBand().domain(rows.map(function (r) { return r.label; }))
      .range([0, f.ih]).padding(0.32);

    f.g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).tickSize(0))
      .select('.domain').remove();
    f.g.append('g').attr('class', 'axis')
      .attr('transform', 'translate(0,' + f.ih + ')')
      .call(d3.axisBottom(x).ticks(5).tickFormat(CH.fmt.compact));

    var g = f.g.selectAll('g.row').data(rows).enter().append('g').attr('class', 'row');
    g.append('rect')
      .attr('y', function (d) { return y(d.label); })
      .attr('height', y.bandwidth()).attr('rx', 2).attr('width', 0)
      .attr('fill', function (d, i) { return i < 2 ? 'var(--accent-mark)' : 'var(--neutral)'; })
      .attr('opacity', function (d, i) { return i < 2 ? 1 : 0.45; });
    g.append('text').attr('class', 'annot-sub')
      .attr('y', function (d) { return y(d.label) + y.bandwidth() / 2; })
      .attr('dy', '0.32em').attr('x', 0).style('opacity', 0)
      .text(function (d) { return CH.fmt.int(d.devices) + '  ·  ' + d.share + '%'; });

    function update(s) {
      var dur = CH.reduced ? 0 : 780;
      g.select('rect').transition().duration(dur).delay(function (d, i) { return i * 90; })
        .attr('width', function (d) { return x(d.devices); });
      g.select('text').transition().duration(dur).delay(function (d, i) { return i * 90 + 220; })
        .attr('x', function (d) { return x(d.devices) + 8; })
        .style('opacity', 1);
    }
    return { update: update };
  }

  /* ======================================================================
     wiring
     ====================================================================== */
  /* Scoped to one scrolly: the page has two, and they own different graphics. */
  function showViz(root, which) {
    d3.select(root).selectAll('[data-viz]').each(function () {
      var on = this.getAttribute('data-viz') === which;
      d3.select(this).style('opacity', on ? 1 : 0)
        .attr('aria-hidden', on ? null : 'true');
    });
  }

  function caption(root, which, text) {
    d3.select(root).select('[data-viz="' + which + '"] .graphic-foot').text(text || '');
  }

  // One entry per step, in document order.
  var TRENDS_STEPS = [
    { viz: 'rates', state: { t: 0, focus: null }, cap: 'First version of the model. Five hardware error categories, weekly.' },
    { viz: 'rates', state: { t: 0, focus: null, xzoom: [0, 16] }, cap: 'The worst weeks are the launch weeks — a denominator of a few dozen cooks.' },
    { viz: 'anchor', state: { mode: 'cooks' }, cap: 'Ten cooks either side of one week boundary.' },
    { viz: 'anchor', state: { mode: 'alerts' }, cap: 'Black dot: when the cook started. Orange dot: when the alert fired.' },
    { viz: 'anchor', state: { mode: 'split' }, cap: 'Highlighted cooks are counted in one week by the denominator and the next by the numerator.' },
    { viz: 'rates', state: { t: 1, focus: null }, cap: 'Same query, one anchor. Note the axis.' },
    {
      viz: 'rates', state: {
        t: 1, focus: 'RTD',
        annot: { cat: 'RTD', week: 58, dx: 40, dy: -46, label: 'Component revision', sub: 'ships into production' }
      }, cap: 'The temperature sensor series is the only one that moves.'
    }
  ];

  var CHURN_STEPS = [
    { viz: 'funnel', state: { upto: 1 }, cap: 'Every connected device in the family.' },
    { viz: 'funnel', state: { upto: 2 }, cap: 'Active = five or more lifetime cooks.' },
    { viz: 'funnel', state: { upto: 3 }, cap: 'Churned = active, then silent for eight weeks or more.' },
    { viz: 'funnel', state: { upto: 4 }, cap: 'Attributed = a qualifying hardware error inside the last five cooks.' },
    { viz: 'attribution', state: {}, cap: 'Devices whose silence follows a hardware error, by component.' },
    { viz: 'attribution', state: {}, cap: 'Two components account for two thirds of it.' }
  ];

  function boot() {
    CH.loadJSON([
      B + 'data/woodridge/trends.json',
      B + 'data/woodridge/trends_broken.json',
      B + 'data/woodridge/week_anchor.json',
      B + 'data/woodridge/churn.json'
    ]).then(function (res) {
      D.trends = res[0].rows;
      D.meta = res[0].meta;
      D.broken = res[1].rows;
      D.anchor = res[2];
      D.churn = res[3];

      rates = makeRates(document.querySelector('[data-viz="rates"] .graphic-body'));
      anchor = makeAnchor(document.querySelector('[data-viz="anchor"] .graphic-body'));
      funnel = makeFunnel(document.querySelector('[data-viz="funnel"] .graphic-body'));
      attribution = makeAttribution(document.querySelector('[data-viz="attribution"] .graphic-body'));

      var VIZ = { rates: rates, anchor: anchor, funnel: funnel, attribution: attribution };

      function run(rootSel, steps) {
        var root = document.querySelector(rootSel);
        return function (i) {
          var s = steps[Math.max(0, Math.min(steps.length - 1, i))];
          showViz(root, s.viz);
          VIZ[s.viz].update(s.state);
          caption(root, s.viz, s.cap);
        };
      }

      Scrolly.init('#scrolly-trends', run('#scrolly-trends', TRENDS_STEPS));
      Scrolly.init('#scrolly-churn', run('#scrolly-churn', CHURN_STEPS));
    }).catch(function (err) {
      CH.loadFail(document.querySelector('.scrolly-graphic'), err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
