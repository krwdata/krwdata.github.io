/* ===========================================================================
   common.js — the handful of things every chart on this site needs.
   Charts are built once and then *updated*; nothing is torn down and redrawn,
   because the transition between two states is the part worth watching.
   =========================================================================== */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DUR = reduced ? 0 : 620;

  /* Create (or reuse) an SVG sized to its container. Returns the inner group
     and the usable width/height inside the margins. */
  function frame(el, margin) {
    var m = Object.assign({ top: 18, right: 20, bottom: 30, left: 44 }, margin || {});
    var box = el.getBoundingClientRect();
    var w = Math.max(220, box.width);
    var h = Math.max(140, box.height || 300);

    var svg = d3.select(el).select('svg');
    if (svg.empty()) {
      svg = d3.select(el).append('svg');
      svg.append('g').attr('class', 'plot');
    }
    svg.attr('viewBox', '0 0 ' + w + ' ' + h)
       .attr('preserveAspectRatio', 'xMidYMid meet')
       .style('width', '100%')
       .style('height', '100%');
    var g = svg.select('g.plot').attr('transform', 'translate(' + m.left + ',' + m.top + ')');

    return {
      svg: svg, g: g, m: m, w: w, h: h,
      iw: Math.max(10, w - m.left - m.right),
      ih: Math.max(10, h - m.top - m.bottom)
    };
  }

  /* NYT-style annotation: a thin leader from the datum to a short bold label.
     Returns the group so callers can fade it in or out. */
  function annotate(g, o) {
    var cls = 'annot' + (o.key ? ' annot-' + o.key : '');
    var sel = g.selectAll('g.' + (o.key ? 'annot-' + o.key : 'annot')).data([o]);
    var enter = sel.enter().append('g').attr('class', cls);
    enter.append('line').attr('class', 'annot-line');
    enter.append('circle').attr('r', 3.5).attr('fill', 'var(--ember)');
    enter.append('text').attr('class', 'annot-label');
    enter.append('text').attr('class', 'annot-sub');
    var node = enter.merge(sel);

    var lx = o.x + o.dx, ly = o.y + o.dy;
    var anchor = o.dx < 0 ? 'end' : 'start';
    node.select('line')
      .attr('x1', o.x).attr('y1', o.y).attr('x2', lx).attr('y2', ly);
    node.select('circle').attr('cx', o.x).attr('cy', o.y);
    node.select('text.annot-label')
      .attr('x', lx + (o.dx < 0 ? -6 : 6)).attr('y', ly)
      .attr('text-anchor', anchor).attr('dy', '0.32em').text(o.label);
    node.select('text.annot-sub')
      .attr('x', lx + (o.dx < 0 ? -6 : 6)).attr('y', ly + 16)
      .attr('text-anchor', anchor).attr('dy', '0.32em').text(o.sub || '');
    return node;
  }

  /* Fade a selection in or out without layout thrash.
     The transition is *named* on purpose: an unnamed one would cancel any
     other transition running on the same elements (a line drawing itself in,
     dots moving to new positions) and leave them frozen part-way. */
  function show(sel, on, dur) {
    sel.transition('fade').duration(dur === undefined ? DUR : dur)
       .style('opacity', on ? 1 : 0)
       .style('pointer-events', on ? null : 'none');
    return sel;
  }

  /* A line that draws itself on first appearance. */
  function drawIn(path, dur) {
    if (reduced) { path.style('stroke-dasharray', null).style('stroke-dashoffset', null); return path; }
    var node = path.node();
    if (!node || !node.getTotalLength) return path;
    var len = node.getTotalLength();
    path.style('stroke-dasharray', len + ' ' + len)
        .style('stroke-dashoffset', len)
        .transition().duration(dur || 1000).ease(d3.easeCubicOut)
        .style('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).style('stroke-dasharray', null); });
    return path;
  }

  var fmt = {
    int: d3.format(','),
    pct1: d3.format('.1f'),
    pct2: d3.format('.2f'),
    sign: d3.format('+.1f'),
    compact: function (n) {
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
      return String(Math.round(n));
    },
    clock: function (mins) {
      var h = Math.floor(mins / 60), m = Math.round(mins % 60);
      return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    }
  };

  /* Chart series colours. One ember highlight, the rest desaturated — the
     palette does the ranking work so the reader doesn't have to. */
  var PALETTE = ['#D95E16', '#8E9BA6', '#6E6863', '#A8877A', '#56606B', '#8B7E5E'];

  function loadJSON(paths) {
    return Promise.all(paths.map(function (p) {
      return fetch(p).then(function (r) {
        if (!r.ok) throw new Error(p + ' → HTTP ' + r.status);
        return r.json();
      });
    }));
  }

  /* Charts need data; opening index.html straight off disk blocks fetch. Say so
     plainly instead of leaving an empty box. */
  function loadFail(el, err) {
    console.error(err);
    var isFile = location.protocol === 'file:';
    d3.select(el).html(
      '<div style="padding:22px;font-size:13.5px;line-height:1.6;color:#8A837C">' +
      (isFile
        ? '<strong>Charts need a local server.</strong><br>Browsers block ' +
          '<code>fetch()</code> on <code>file://</code>. Run <code>python3 -m http.server</code> ' +
          'in the repo root and open <code>localhost:8000</code>.'
        : 'Could not load chart data: ' + err.message) +
      '</div>');
  }

  window.CH = {
    frame: frame, annotate: annotate, show: show, drawIn: drawIn,
    fmt: fmt, PALETTE: PALETTE, DUR: DUR, reduced: reduced,
    loadJSON: loadJSON, loadFail: loadFail
  };
})();
