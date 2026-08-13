/* ===========================================================================
   dashboard.js — the live previews on the landing page.
   Each panel gets a small chart drawn from the same data as its case study, so
   the tile is a real preview and not a decoration. They animate once, when the
   panel first scrolls into view.
   =========================================================================== */
(function () {
  'use strict';

  var B = document.documentElement.getAttribute('data-base') || '';
  var reduced = CH.reduced;

  /* Run a draw function the first time its panel is visible. */
  function whenVisible(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { io.unobserve(e.target); fn(); }
      });
    }, { threshold: 0.25 });
    io.observe(el);
  }

  function mini(el, margin) {
    return CH.frame(el, Object.assign({ top: 8, right: 8, bottom: 8, left: 8 }, margin || {}));
  }

  /* --- Scorecard: the set-point staircase and what the grate actually did -- */
  function scorecard(el) {
    CH.loadJSON([B + 'data/scorecard/trace.json']).then(function (r) {
      var rows = r[0].rows;
      var f = mini(el);
      var x = d3.scaleLinear().domain(d3.extent(rows, function (d) { return d.t; })).range([0, f.iw]);
      var y = d3.scaleLinear()
        .domain([40, d3.max(rows, function (d) { return d.grill; }) * 1.05]).range([f.ih, 0]);

      f.g.append('path').datum(rows)
        .attr('class', 'series-line').attr('stroke', 'var(--ash-dim)')
        .attr('stroke-width', 1).attr('stroke-dasharray', '3 2')
        .attr('d', d3.line().x(function (d) { return x(d.t); })
          .y(function (d) { return y(d.set); }).curve(d3.curveStepAfter));

      var p = f.g.append('path').datum(rows)
        .attr('class', 'series-line').attr('stroke', 'var(--ember)').attr('stroke-width', 1.8)
        .attr('d', d3.line().x(function (d) { return x(d.t); })
          .y(function (d) { return y(d.grate); }));
      whenVisible(el, function () { CH.drawIn(p, 1600); });
    }).catch(function () { el.remove(); });
  }

  /* --- Woodridge: five weekly series, one of which moves ------------------ */
  function woodridge(el) {
    CH.loadJSON([B + 'data/woodridge/trends.json']).then(function (r) {
      var rows = r[0].rows, meta = r[0].meta;
      var f = mini(el, { right: 10 });
      var cats = ['FAN', 'AUGER', 'HIGH_TEMP', 'IGNITOR', 'RTD'];
      var x = d3.scaleLinear().domain(d3.extent(rows, function (d) { return d.week; })).range([0, f.iw]);
      var y = d3.scaleLinear().domain([0, d3.max(rows, function (d) { return d.rate; })]).range([f.ih, 0]);
      var line = d3.line().x(function (d) { return x(d.week); })
        .y(function (d) { return y(d.rate); }).curve(d3.curveMonotoneX);

      // Intervention marker — the whole story of the panel in one dashed line.
      f.g.append('line')
        .attr('x1', x(meta.intervention_week)).attr('x2', x(meta.intervention_week))
        .attr('y1', 0).attr('y2', f.ih)
        .attr('stroke', 'var(--rule)').attr('stroke-dasharray', '2 3');

      var paths = cats.map(function (c) {
        var data = rows.filter(function (d) { return d.category === c; });
        return f.g.append('path').datum(data).attr('class', 'series-line')
          .attr('stroke', c === 'RTD' ? 'var(--ember)' : 'var(--ash-dim)')
          .attr('stroke-width', c === 'RTD' ? 1.9 : 1)
          .attr('opacity', c === 'RTD' ? 1 : 0.45)
          .attr('d', line);
      });
      whenVisible(el, function () {
        paths.forEach(function (p, i) { CH.drawIn(p, 1200 + i * 120); });
      });
    }).catch(function () { el.remove(); });
  }

  /* --- Segmentation: the device cloud, six colours ------------------------ */
  function segmentation(el) {
    CH.loadJSON([B + 'data/segmentation/devices.json', B + 'data/segmentation/segments.json'])
      .then(function (r) {
        var rows = r[0].rows, segs = r[1].rows;
        var color = {};
        segs.forEach(function (s, i) { color[s.key] = CH.PALETTE[i % CH.PALETTE.length]; });

        var f = mini(el);
        var x = d3.scaleLinear().domain(d3.extent(rows, function (d) { return d.dur; })).range([2, f.iw - 2]);
        var y = d3.scaleLinear().domain(d3.extent(rows, function (d) { return d.temp; })).range([f.ih - 2, 2]);

        var dots = f.g.selectAll('circle').data(rows).enter().append('circle')
          .attr('cx', function (d) { return x(d.dur); })
          .attr('cy', function (d) { return y(d.temp); })
          .attr('r', 0)
          .attr('fill', function (d) { return color[d.segment]; })
          .attr('opacity', 0.62);

        whenVisible(el, function () {
          if (reduced) { dots.attr('r', 1.7); return; }
          dots.transition().duration(700)
            .delay(function (d, i) { return (i % 60) * 8; })
            .attr('r', 1.7);
        });
      }).catch(function () { el.remove(); });
  }

  /* --- DJ: the Camelot wheel, at tile size -------------------------------- */
  function dj(el) {
    CH.loadJSON([B + 'data/dj/stats.json']).then(function (r) {
      var wheel = r[0].wheel;
      var f = mini(el);
      var R = Math.min(f.iw, f.ih) / 2 - 2;
      var g = f.g.append('g').attr('transform', 'translate(' + f.iw / 2 + ',' + f.ih / 2 + ')');
      var rings = { B: [R * 0.66, R], A: [R * 0.32, R * 0.66] };
      var op = d3.scaleSqrt().domain([0, d3.max(wheel, function (d) { return d.tracks; })]).range([0.08, 1]);
      var arc = d3.arc().padAngle(0.02).cornerRadius(1);

      var w = g.selectAll('path').data(wheel).enter().append('path')
        .attr('d', function (d) {
          var n = parseInt(d.camelot, 10), letter = d.camelot.slice(-1);
          var a = (n - 1) / 12 * Math.PI * 2;
          var rr = rings[letter];
          return arc({
            innerRadius: rr[0], outerRadius: rr[1],
            startAngle: a - Math.PI / 12, endAngle: a + Math.PI / 12
          });
        })
        .attr('fill', 'var(--ember)')
        .attr('fill-opacity', 0)
        .attr('stroke', 'var(--panel)').attr('stroke-width', 0.8);

      whenVisible(el, function () {
        w.transition().duration(reduced ? 0 : 900)
          .delay(function (d, i) { return reduced ? 0 : i * 22; })
          .attr('fill-opacity', function (d) { return op(d.tracks); });
      });
    }).catch(function () { el.remove(); });
  }

  /* --- fill the DJ scope chips from the real parsed numbers --------------- */
  function djChips() {
    CH.loadJSON([B + 'data/dj/stats.json']).then(function (r) {
      var t = r[0].totals;
      var map = {
        tracks: CH.fmt.int(t.unique_tracks) + ' tracks',
        sets: t.sets + ' sets',
        hours: Math.round(t.hours) + ' hours'
      };
      Object.keys(map).forEach(function (k) {
        var n = document.querySelector('[data-djchip="' + k + '"]');
        if (n) n.textContent = map[k];
      });
    }).catch(function () {});
  }

  function boot() {
    var map = {
      scorecard: scorecard, woodridge: woodridge,
      segmentation: segmentation, dj: dj
    };
    Object.keys(map).forEach(function (k) {
      var el = document.querySelector('[data-mini="' + k + '"]');
      if (el) map[k](el);
    });
    djChips();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
