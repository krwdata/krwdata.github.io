/* ===========================================================================
   scorecard.js — charts for the Scorecard API case study.
   Three graphics: the time cost of the manual path, the architecture that
   replaced it, and the thermal trace the API returns.
   =========================================================================== */
(function () {
  'use strict';

  var B = document.documentElement.getAttribute('data-base') || '';
  var D = {};

  /* ======================================================================
     1. TIMING — 30 minutes of human time, then 5
     ====================================================================== */
  function makeTiming(el) {
    var f = CH.frame(el, { top: 34, right: 30, bottom: 34, left: 96 });
    var t = D.timing;

    var perTest = t.manual.seconds_per_test_per_grill;
    var manualTotal = perTest * t.manual.grills * t.manual.tests;   // seconds
    var apiTotal = t.api.seconds_per_session;

    var rows = [
      { key: 'manual', label: 'By hand', total: manualTotal, steps: t.manual.steps },
      { key: 'api', label: 'Via the API', total: apiTotal, steps: null }
    ];

    var x = d3.scaleLinear().domain([0, manualTotal]).range([0, f.iw]);
    var y = d3.scaleBand().domain(['manual', 'api']).range([0, f.ih * 0.48]).padding(0.40);

    f.g.append('g').attr('class', 'axis')
      .attr('transform', 'translate(0,' + (f.ih * 0.48) + ')')
      .call(d3.axisBottom(x)
        .tickValues(d3.range(0, manualTotal + 1, 300))
        .tickFormat(function (v) { return (v / 60) + ' min'; }));

    f.g.selectAll('text.rowlab').data(rows).enter().append('text')
      .attr('class', 'annot-label rowlab')
      .attr('x', -12).attr('text-anchor', 'end')
      .attr('y', function (d) { return y(d.key) + y.bandwidth() / 2; })
      .attr('dy', '0.32em').style('font-size', '13px')
      .text(function (d) { return d.label; });

    // The manual bar is built from its steps so the reader can see where the
    // three minutes per test actually went.
    var stack = [];
    var acc = 0;
    t.manual.steps.forEach(function (s, i) {
      stack.push({ i: i, label: s.label, x0: acc, x1: acc + s.seconds });
      acc += s.seconds;
    });

    var manualG = f.g.append('g');
    var segs = manualG.selectAll('rect').data(stack).enter().append('rect')
      .attr('y', y('manual')).attr('height', y.bandwidth())
      .attr('x', function (d) { return x(d.x0); })
      .attr('width', 0)
      .attr('fill', 'var(--neutral)')
      .attr('opacity', function (d, i) { return 0.9 - i * 0.11; })
      .attr('stroke', 'var(--paper)').attr('stroke-width', 1);

    var manualTail = f.g.append('rect')
      .attr('y', y('manual')).attr('height', y.bandwidth())
      .attr('x', x(perTest)).attr('width', 0)
      .attr('fill', 'var(--neutral)').attr('opacity', 0.3);

    var apiBar = f.g.append('rect')
      .attr('y', y('api')).attr('height', y.bandwidth())
      .attr('x', 0).attr('width', 0)
      .attr('fill', 'var(--accent-mark)');

    var manualLab = f.g.append('text').attr('class', 'annot-label')
      .attr('y', y('manual') + y.bandwidth() / 2).attr('dy', '0.32em').style('opacity', 0);
    var apiLab = f.g.append('text').attr('class', 'annot-label')
      .attr('y', y('api') + y.bandwidth() / 2).attr('dy', '0.32em').style('opacity', 0);

    // Step list under the bars — the receipts for the top bar.
    var listY = f.ih * 0.48 + 58;
    var list = f.g.selectAll('g.step-row').data(stack).enter().append('g')
      .attr('class', 'step-row')
      .attr('transform', function (d, i) { return 'translate(0,' + (listY + i * 20) + ')'; })
      .style('opacity', 0);
    list.append('rect').attr('width', 9).attr('height', 9).attr('y', -8)
      .attr('fill', 'var(--neutral)')
      .attr('opacity', function (d, i) { return 0.9 - i * 0.11; });
    list.append('text').attr('class', 'annot-sub').attr('x', 16).style('font-size', '12px')
      .text(function (d) { return d.label; });
    list.append('text').attr('class', 'annot-sub').attr('x', f.iw).attr('text-anchor', 'end')
      .style('font-size', '12px').style('font-variant-numeric', 'tabular-nums')
      .text(function (d) { return (d.x1 - d.x0) + 's'; });

    function update(s) {
      var dur = CH.reduced ? 0 : 700;
      var mode = s.mode;

      segs.transition().duration(dur).delay(function (d, i) { return i * 80; })
        .attr('width', function (d) { return mode === 'none' ? 0 : x(d.x1) - x(d.x0); });

      CH.show(list, mode === 'steps', dur);

      manualTail.transition().duration(dur).delay(mode === 'full' || mode === 'both' ? 400 : 0)
        .attr('width', (mode === 'full' || mode === 'both') ? x(manualTotal) - x(perTest) : 0);

      apiBar.transition().duration(dur).delay(mode === 'both' ? 500 : 0)
        .attr('width', mode === 'both' ? Math.max(3, x(apiTotal)) : 0);

      /* Put the label after the bar if it fits, inside the bar's end if it does
         not. The manual bar reaches the full width on the comparison step, so
         a fixed x(total) + 10 started 10px PAST the plot and ran 204px outside
         the card — the text has nowhere to go in a 30px margin. Measuring is
         the only way to know: the string changes per step and the box is
         fluid. */
      function place(sel, atValue, txt) {
        sel.text(txt);
        var w = 0;
        try { w = sel.node().getComputedTextLength(); } catch (e) { w = txt.length * 7; }
        var after = x(atValue) + 10;
        if (after + w <= f.iw + f.m.right - 6) {
          sel.attr('x', after).attr('text-anchor', 'start');
        } else {
          // Inside, right-aligned against the bar's end.
          sel.attr('x', x(atValue) - 10).attr('text-anchor', 'end');
        }
      }

      place(manualLab,
        mode === 'steps' ? perTest : manualTotal,
        mode === 'steps' ? '~3 min per test, per grill'
                         : '~30 min per session (3 grills × 3 tests)');
      CH.show(manualLab, mode !== 'none', dur);

      place(apiLab, apiTotal, '~5 min — and no waiting between grills');
      CH.show(apiLab, mode === 'both', dur);
    }

    return { update: update };
  }

  /* ======================================================================
     2. ARCH — the path a test takes, redrawn
     ====================================================================== */
  function makeArch(el) {
    var f = CH.frame(el, { top: 16, right: 12, bottom: 16, left: 12 });

    // Normalised layout: [x, y] in 0..1, resolved against the frame.
    var NODES = [
      { id: 'tc', label: 'Thermocouples', sub: 'grate + grill', p: [0.10, 0.16], group: 0 },
      { id: 'daq', label: 'DAQ', sub: 'temperature capture', p: [0.10, 0.50], group: 0 },
      { id: 'seq', label: 'Sequencer', sub: 'drives the test profile', p: [0.10, 0.84], group: 0 },
      { id: 'curl', label: 'curl', sub: 'fired at test completion', p: [0.40, 0.50], group: 1 },
      { id: 'api', label: 'Plumber API', sub: 'in Docker, on Linux', p: [0.66, 0.50], group: 2 },
      { id: 'plot', label: 'Scored plot', sub: 'PNG', p: [0.93, 0.16], group: 3 },
      { id: 'table', label: 'Graded table', sub: 'PNG', p: [0.93, 0.50], group: 3 },
      { id: 'html', label: 'Interactive', sub: 'plotly HTML', p: [0.93, 0.84], group: 3 }
    ];
    var LINKS = [
      ['tc', 'daq'], ['seq', 'daq'], ['daq', 'curl'], ['seq', 'curl'],
      ['curl', 'api'], ['api', 'plot'], ['api', 'table'], ['api', 'html']
    ];

    var byId = {};
    NODES.forEach(function (n) {
      n.x = n.p[0] * f.iw;
      n.y = n.p[1] * f.ih;
      byId[n.id] = n;
    });

    var W = Math.min(150, f.iw * 0.21), H = 46;

    var defs = f.svg.append('defs');
    defs.append('marker').attr('id', 'arrow').attr('viewBox', '0 -5 10 10')
      .attr('refX', 9).attr('refY', 0).attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto').append('path').attr('d', 'M0,-4L9,0L0,4')
      .attr('fill', 'var(--ash-dim)');

    var linkG = f.g.append('g');
    var links = linkG.selectAll('path').data(LINKS).enter().append('path')
      .attr('fill', 'none').attr('stroke', 'var(--ash-dim)').attr('stroke-width', 1.2)
      .attr('marker-end', 'url(#arrow)')
      .attr('d', function (d) {
        var a = byId[d[0]], b = byId[d[1]];
        var x1 = a.x + W / 2, y1 = a.y, x2 = b.x - W / 2, y2 = b.y;
        if (Math.abs(a.p[0] - b.p[0]) < 0.01) { x1 = a.x; y1 = a.y + (b.y > a.y ? H / 2 : -H / 2); x2 = b.x; y2 = b.y + (b.y > a.y ? -H / 2 : H / 2); }
        var mx = (x1 + x2) / 2;
        return 'M' + x1 + ',' + y1 + 'C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
      })
      .style('opacity', 0);

    var nodeG = f.g.append('g');
    var nodes = nodeG.selectAll('g').data(NODES).enter().append('g')
      .attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; })
      .style('opacity', 0);
    nodes.append('rect')
      .attr('x', -W / 2).attr('y', -H / 2).attr('width', W).attr('height', H).attr('rx', 2)
      .attr('fill', function (d) { return d.group === 2 ? 'var(--accent-mark)' : 'var(--paper)'; })
      .attr('stroke', function (d) { return d.group === 2 ? 'var(--accent-mark)' : 'var(--rule-lite)'; })
      .attr('stroke-width', 1.4);
    nodes.append('text').attr('class', 'annot-label')
      .attr('text-anchor', 'middle').attr('y', -3).style('font-size', '12px')
      .style('fill', function (d) { return d.group === 2 ? '#fff' : 'var(--ink)'; })
      .text(function (d) { return d.label; });
    nodes.append('text').attr('class', 'annot-sub')
      .attr('text-anchor', 'middle').attr('y', 13).style('font-size', '10.5px')
      .style('fill', function (d) { return d.group === 2 ? 'rgba(255,255,255,.9)' : '#8A837C'; })
      .text(function (d) { return d.sub; });

    function update(s) {
      var upto = s.upto === undefined ? 3 : s.upto;
      var dur = CH.reduced ? 0 : 480;
      nodes.transition().duration(dur).delay(function (d) { return d.group * 140; })
        .style('opacity', function (d) { return d.group <= upto ? 1 : 0.08; });
      links.transition().duration(dur).delay(function (d) { return byId[d[1]].group * 140; })
        .style('opacity', function (d) { return byId[d[1]].group <= upto ? 1 : 0; });
    }

    return { update: update };
  }

  /* ======================================================================
     3. TRACE — what the scorecard actually looks at
     ====================================================================== */
  function makeTrace(el) {
    var f = CH.frame(el, { top: 22, right: 54, bottom: 32, left: 46 });
    var rows = D.trace.rows, segs = D.trace.segments, grades = D.grades;

    var x = d3.scaleLinear().range([0, f.iw]);
    var y = d3.scaleLinear().range([f.ih, 0]);
    var full = [0, d3.max(rows, function (r) { return r.t; })];
    x.domain(full);
    y.domain([50, d3.max(rows, function (r) { return Math.max(r.grill, r.grate); }) * 1.04]);

    var gridG = f.g.append('g').attr('class', 'grid');
    var xAxisG = f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')');
    var yAxisG = f.g.append('g').attr('class', 'axis');

    var setLine = d3.line().x(function (d) { return x(d.t); }).y(function (d) { return y(d.set); }).curve(d3.curveStepAfter);
    var grillLine = d3.line().x(function (d) { return x(d.t); }).y(function (d) { return y(d.grill); });
    var grateLine = d3.line().x(function (d) { return x(d.t); }).y(function (d) { return y(d.grate); });

    /* Every path holds the WHOLE run, and the close-up step narrows x to
       [40, 66]. Everything outside that window maps past the plot and keeps
       drawing — and `.graphic-body svg` is `overflow: visible` on purpose, so
       end labels and annotations can sit outside the axes, which means nothing
       stops it. The lines ran across the caption and out of the card into the
       step column. Clip the series only; labels and grades stay free.
       A little vertical slack so a 2.1px stroke is not shaved at the extremes. */
    var clipId = 'sc-trace-clip';
    f.svg.append('defs').append('clipPath').attr('id', clipId)
      .append('rect').attr('x', 0).attr('y', -8)
      .attr('width', f.iw).attr('height', f.ih + 16);
    var linesG = f.g.append('g').attr('clip-path', 'url(#' + clipId + ')');

    var pSet = linesG.append('path').datum(rows).attr('class', 'series-line')
      .attr('stroke', 'var(--ink)').attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '5 3').style('opacity', 0);
    var pGrill = linesG.append('path').datum(rows).attr('class', 'series-line')
      .attr('stroke', 'var(--neutral)').attr('stroke-width', 1.5).style('opacity', 0);
    var pGrate = linesG.append('path').datum(rows).attr('class', 'series-line')
      .attr('stroke', 'var(--series-1)').attr('stroke-width', 2.1).style('opacity', 0);

    var gradeG = f.g.append('g').style('opacity', 0);
    var gradeMarks = gradeG.selectAll('g').data(grades).enter().append('g');
    gradeMarks.append('rect').attr('width', 22).attr('height', 20).attr('rx', 2)
      // Status colours, not series colours — and the letter itself is the
      // label, so the grade never depends on colour alone.
      .attr('fill', function (d) {
        return d.grade === 'A' ? 'var(--good)' : d.grade === 'B' ? 'var(--warn)' : 'var(--bad)';
      });
    gradeMarks.append('text').attr('class', 'annot-label').style('fill', '#fff')
      .attr('x', 11).attr('y', 14).attr('text-anchor', 'middle').style('font-size', '12px')
      .text(function (d) { return d.grade; });

    var annotG = f.g.append('g');

    var legendEl = el.closest('figure').querySelector('[data-legend]');
    if (legendEl) {
      legendEl.innerHTML =
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--series-1)"></span>Grate (cooking surface)</span>' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--neutral)"></span>Grill (controller probe)</span>' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--ink)"></span>Set point</span>';
    }

    function axes() {
      xAxisG.call(d3.axisBottom(x).ticks(7).tickFormat(function (v) { return v + 'm'; }));
      yAxisG.call(d3.axisLeft(y).ticks(6).tickFormat(function (v) { return v + '°'; }));
      gridG.call(d3.axisLeft(y).ticks(6).tickSize(-f.iw).tickFormat(''));
      gridG.select('.domain').remove();
    }
    axes();

    function redraw() {
      pSet.attr('d', setLine);
      pGrill.attr('d', grillLine);
      pGrate.attr('d', grateLine);
      gradeMarks.attr('transform', function (d, i) {
        var seg = segs[i];
        return 'translate(' + (x((seg.start_min + seg.end_min) / 2) - 11) + ',' + (y(d.set) - 34) + ')';
      });
    }
    redraw();

    var shown = {};
    function update(s) {
      var dur = CH.reduced ? 0 : 800;
      var xTo = s.zoom || full;
      var i = d3.interpolate(x.domain(), xTo);
      f.g.transition().duration(dur).ease(d3.easeCubicInOut).tween('x', function () {
        return function (k) { x.domain(i(k)); redraw(); axes(); };
      });

      CH.show(pSet, !!s.set, dur);
      CH.show(pGrate, !!s.grate, dur);
      CH.show(pGrill, !!s.grill, dur);
      CH.show(gradeG, !!s.grades, dur);

      if (s.grate && !shown.grate) { shown.grate = true; CH.drawIn(pGrate, 1400); }
      if (s.grill && !shown.grill) { shown.grill = true; CH.drawIn(pGrill, 1400); }

      annotG.selectAll('*').remove();
      if (s.annot) {
        var a = s.annot;
        window.setTimeout(function () {
          var pt = rows.reduce(function (best, r) {
            return Math.abs(r.t - a.t) < Math.abs(best.t - a.t) ? r : best;
          }, rows[0]);
          CH.annotate(annotG, {
            key: 'a', x: x(pt.t), y: y(a.series === 'grill' ? pt.grill : pt.grate),
            dx: a.dx, dy: a.dy, label: a.label, sub: a.sub
          }).style('opacity', 0).transition().duration(340).style('opacity', 1);
        }, dur);
      }
    }

    return { update: update };
  }

  /* ======================================================================
     grades table, rendered into the prose
     ====================================================================== */
  function renderGradesTable() {
    var host = document.querySelector('[data-grades-table]');
    if (!host) return;
    var rows = D.grades.map(function (g) {
      var cls = g.grade === 'A' ? 'good' : g.grade === 'B' ? '' : 'warn';
      return '<tr>' +
        '<td>' + g.set + '°F</td>' +
        '<td>' + g.grate_avg.toFixed(1) + '</td>' +
        '<td>' + (g.error > 0 ? '+' : '') + g.error.toFixed(1) + '</td>' +
        '<td>±' + g.stability_sd.toFixed(1) + '</td>' +
        '<td>' + (g.rise_min === null ? '—' : g.rise_min + ' min') + '</td>' +
        '<td class="grade ' + cls + '">' + g.grade + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th>Set point</th><th>Grate avg</th><th>Error</th><th>Stability</th><th>Time to ±10°</th><th>Grade</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ======================================================================
     HEAT MAP — the third output. A 3 x 5 thermocouple grid across the cooking
     surface, stepped through the whole profile.

     The real report prints one panel per set point with the temperature
     written in every cell. Here it is a single grid that animates through the
     staircase instead, and the numbers are gone on purpose: fifteen numbers
     changing six times is a table pretending to be an animation, and nobody
     reads it. What the plot is actually for is the SHAPE — cool on the right,
     and a spread that widens as the grill gets hotter — and shape is what
     survives when you take the digits away.

     Colour is a fixed ±25°F window centred on THAT GRID'S OWN MEAN, and both
     halves of that matter.

     Centred on the mean, not the set point, because this plot answers "is the
     grate even", not "did it hit the number". Accuracy already has two homes
     on this page — the trace and the grades table — and this grill runs about
     20°F under at the top of its range, so centring on the set point painted
     the entire 500°F grid blue. That reads as "the grill is cold" and buries
     the gradient, which is the one thing the map is for.

     Fixed window, not per-grid, because re-normalising each step would make
     every set point look equally uneven and hide the finding. At ±25°F a grid
     spanning 8°F sits almost white and one spanning 41°F reaches both ends of
     the ramp, so the spread grows in front of you as it climbs.
     ====================================================================== */
  function makeHeatmap(el) {
    var f = CH.frame(el, { top: 16, right: 18, bottom: 46, left: 18 });
    var meta = D.heat.meta, grids = D.heat.grids;
    var nR = meta.rows, nC = meta.cols;

    var legendH = 30, footH = 26;
    var gridH = f.ih - legendH - footH;
    var gap = 5;
    var cw = (f.iw - gap * (nC - 1)) / nC;
    var ch = (gridH - gap * (nR - 1)) / nR;

    var gridG = f.g.append('g');
    var cells = gridG.selectAll('rect').data(grids[0].cells).enter().append('rect')
      .attr('x', function (d) { return d.c * (cw + gap); })
      .attr('y', function (d) { return d.r * (ch + gap); })
      .attr('width', cw).attr('height', ch).attr('rx', 2)
      .attr('fill', '#EEE')
      .attr('stroke', 'var(--rule-lite)').attr('stroke-width', 0.5);

    // Blue = below set point, red = above. interpolateRdBu runs red->blue, so
    // it is inverted here.
    function scaleFor(mean) {
      return d3.scaleDiverging(function (t) { return d3.interpolateRdBu(1 - t); })
        .domain([mean - 25, mean, mean + 25]);
    }

    f.g.append('text').attr('class', 'chart-sub')
      .attr('x', f.iw / 2).attr('y', gridH + 17).attr('text-anchor', 'middle')
      .text('FRONT OF GRILL');

    // Readout: the only numbers left, and they are the two that matter.
    var readSet = f.g.append('text').attr('class', 'annot-label')
      .attr('x', 0).attr('y', f.ih - 6).style('font-size', '15px');
    var readDelta = f.g.append('text').attr('class', 'annot-sub')
      .attr('x', f.iw).attr('y', f.ih - 6).attr('text-anchor', 'end')
      .style('font-size', '12.5px');

    // A ramp so "blue is cooler" needs no caption.
    var lw = 120, lx = f.iw / 2 - lw / 2, ly = f.ih - 18;
    var gradId = 'sc-heat-ramp';
    var grad = f.svg.append('defs').append('linearGradient')
      .attr('id', gradId).attr('x1', '0%').attr('x2', '100%');
    [0, .25, .5, .75, 1].forEach(function (t) {
      grad.append('stop').attr('offset', (t * 100) + '%')
        .attr('stop-color', d3.interpolateRdBu(1 - t));
    });
    f.g.append('rect').attr('x', lx).attr('y', ly).attr('width', lw).attr('height', 6)
      .attr('rx', 3).attr('fill', 'url(#' + gradId + ')');
    f.g.append('text').attr('class', 'chart-sub').attr('x', lx - 8).attr('y', ly + 6)
      .attr('text-anchor', 'end').style('font-size', '9px').text('COOLER');
    f.g.append('text').attr('class', 'chart-sub').attr('x', lx + lw + 8).attr('y', ly + 6)
      .style('font-size', '9px').text('HOTTER');

    var timer = null, idx = 0;

    function paint(i, dur) {
      var g = grids[i], sc = scaleFor(g.avg);
      var byKey = {};
      g.cells.forEach(function (d) { byKey[d.r + ':' + d.c] = d.t; });
      cells.transition().duration(dur).ease(d3.easeCubicInOut)
        .attr('fill', function (d) { return sc(byKey[d.r + ':' + d.c]); });
      readSet.text(g.set + '°F set point');
      readDelta.text(g.delta + '°F across the grate');
    }

    function stop() { if (timer) { timer.stop(); timer = null; } }

    function update(s) {
      var dur = CH.reduced ? 0 : 520;
      if (s.play && !CH.reduced) {
        stop();
        idx = 0; paint(0, 260);
        var last = 0;
        timer = d3.interval(function () {
          idx += 1;
          if (idx >= grids.length) { stop(); return; }
          paint(idx, dur);
        }, 900);
      } else {
        stop();
        idx = s.at === undefined ? grids.length - 1 : s.at;
        paint(idx, dur);
      }
    }

    return { update: update };
  }

  /* ====================================================================== */
  function showViz(root, which) {
    d3.select(root).selectAll('[data-viz]').each(function () {
      var on = this.getAttribute('data-viz') === which;
      d3.select(this).style('opacity', on ? 1 : 0).attr('aria-hidden', on ? null : 'true');
    });
  }

  var STEPS = [
    { viz: 'timing', state: { mode: 'steps' }, cap: 'Human time per test, per grill, on the manual path.' },
    { viz: 'timing', state: { mode: 'both' }, cap: 'Same session, both paths.' },
    { viz: 'arch', state: { upto: 0 }, cap: 'The rig: already automated, right up to the point where the data lands.' },
    { viz: 'arch', state: { upto: 2 }, cap: 'The sequencer already knows when the test ended. Let it make the request.' },
    { viz: 'arch', state: { upto: 3 }, cap: 'Three outputs come back, ready to attach.' },
    { viz: 'trace', state: { set: true }, cap: 'The commanded profile: a staircase through the usable range.' },
    { viz: 'trace', state: { set: true, grate: true, grill: true }, cap: 'Two channels: the cooking surface and the controller probe.' },
    { viz: 'trace', state: { set: true, grate: true, grill: true, zoom: [40, 66], annot: { t: 44, series: 'grill', dx: 46, dy: -40, label: 'Overshoot', sub: 'then settle — the auger cycling' } }, cap: 'One step, up close.' },
    { viz: 'trace', state: { set: true, grate: true, grill: true, grades: true }, cap: 'A grade per set point, from accuracy and stability.' },
    { viz: 'heat', state: { play: true }, cap: 'The third output: the whole grate, stepped through the profile.' },
    { viz: 'heat', state: { at: 5 }, cap: 'At the top of the range the two ends of the grate are 40°F apart.' }
  ];

  function boot() {
    CH.loadJSON([
      B + 'data/scorecard/trace.json',
      B + 'data/scorecard/grades.json',
      B + 'data/scorecard/timing.json',
      B + 'data/scorecard/heatmap.json'
    ]).then(function (res) {
      D.trace = res[0];
      D.grades = res[1].rows;
      D.timing = res[2];
      D.heat = res[3];

      var VIZ = {
        heat: makeHeatmap(document.querySelector('[data-viz="heat"] .graphic-body')),
        timing: makeTiming(document.querySelector('[data-viz="timing"] .graphic-body')),
        arch: makeArch(document.querySelector('[data-viz="arch"] .graphic-body')),
        trace: makeTrace(document.querySelector('[data-viz="trace"] .graphic-body'))
      };
      renderGradesTable();

      var root = document.querySelector('#scrolly-api');
      Scrolly.init('#scrolly-api', function (i) {
        var s = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))];
        showViz(root, s.viz);
        VIZ[s.viz].update(s.state);
        d3.select(root).select('[data-viz="' + s.viz + '"] .graphic-foot').text(s.cap);
      });
    }).catch(function (err) {
      CH.loadFail(document.querySelector('.scrolly-graphic'), err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
