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
    enter.append('circle').attr('r', 3.5).attr('fill', 'var(--accent-mark)');
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

  /* Chart series colours: the six categorical slots, in fixed order, mirroring
     --series-1..6 in theme.css. Validated with the palette checker for the
     lightness band, chroma floor, adjacent-pair separation under protanopia
     and deuteranopia, and contrast — against the light paper AND the dark
     panel, so one palette serves both surfaces.

     Note the cap: adjacent-pair separation is the right gate for lines and
     bars, where only neighbours touch. A scatter needs ALL pairs separable and
     six series cannot clear that at any ordering — the segmentation cloud
     leans on its legend, its per-segment focus steps and the profile table
     underneath to carry identity, rather than on colour alone. */
  /* READ FROM CSS, not duplicated here. `--series-1..6` in theme.css is the one
     definition; this used to be a second hand-maintained copy of the same six
     hexes with nothing keeping them in sync. Reading them at boot means a
     re-theme touches one file, and the theme lab can drive the charts.
     The literals below are only a fallback for a stylesheet that failed to
     load — they are the values as of 2026-08-15. */
  var FALLBACK = ['#E0700A', '#4A93D6', '#D3468F', '#B08E18', '#B03A70', '#22A8AE'];
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  var PALETTE = FALLBACK.map(function (hex, i) {
    return cssVar('--series-' + (i + 1), hex);
  });

  /* Not a slot: the fill for anything deliberately recessive. */
  var NEUTRAL = cssVar('--neutral', '#6B7684');

  /* --- the Camelot ring ---------------------------------------------------
     Twelve hues, one per Camelot number, because that is the convention every
     DJ already reads: Mixed In Key invented the colour coding and it is how a
     key gets recognised at a glance. They have never published the values and
     Serato uses its own, so this is the convention *computed* rather than
     eyedropped off a screenshot.

     How: hue starts at 52.5° — the OKLCH hue of the brand orange #E0700A, so
     slot 1 is family with the rest of the site — and steps a clean 30° twelve
     times. Lightness is pinned at L = 0.62 for all twelve and chroma is taken
     to 90% of whatever that hue can reach in sRGB at that lightness. Pinning L
     is what keeps the ring from reading as a lumpy rainbow: every wedge carries
     the same visual weight, so opacity is free to mean track count and nothing
     else. At L = 0.62 all twelve clear 3:1 against --offwhite (3.01–3.74) and
     --panel (3.90–4.84), which is the gate for a filled shape.

     THE DOCUMENTED EXCEPTION to rule 4 in the handoff: twelve hues 30° apart
     cannot clear adjacent-pair separation under CVD, and these do not — 8/9
     collapses to ΔOklab 0.005 under deuteranopia. That is acceptable *here and
     only here* because hue is fully redundant with angular position: the wedge
     for 9A is at nine o'clock whether or not you can see that it is blue, and
     the numbers are printed outside the ring. Colour is a second encoding of
     something the geometry already says. Do not lift this array out to carry
     categories on any other chart. */
  var CAMELOT = [
    '#C76923', '#A87F24', '#888D24', '#29A125', '#299B7F', '#29979F',
    '#2891BF', '#467FF3', '#8E65F3', '#CB2EE0', '#E42C93', '#EF2E41'
  ];

  /* '9A' / '9B' -> the hue for 9. A and B share a hue on purpose: that is what
     "relative major/minor" means, and the inner/outer ring already says which
     is which. */
  function camelotColor(c) {
    var n = parseInt(c, 10);
    return (n >= 1 && n <= 12) ? CAMELOT[n - 1] : NEUTRAL;
  }

  /* Scatter one dot per track inside each key's slot on a Camelot wheel.
     Lives here because the case study and the dashboard tile both draw this
     wheel, and the tile is only a useful preview if it uses the SAME encoding —
     a differently-encoded cousin teaches the reader the wrong thing first.
     Two implementations would drift; this one cannot.

     `wheel` is [{camelot, tracks}], `rings` is {A:[r0,r1], B:[r0,r1]}.
     Returns [{key, ki, x, y}] in the wheel's own centred coordinates. */
  function camelotDots(wheel, rings, opts) {
    var o = opts || {};
    var padA = o.padA === undefined ? 0.12 : o.padA;   // share of the wedge angle
    var padR = o.padR === undefined ? 3.5 : o.padR;    // clearance at ring edges
    var out = [];

    /* Seeded, so the scatter is identical on every load. Math.random() would
       make the wheel shimmer between visits and stop it being a stable object
       you can point at in conversation. mulberry32. */
    function rng(seed) {
      var a = seed >>> 0;
      return function () {
        a += 0x6D2B79F5;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    wheel.forEach(function (d, ki) {
      var n = parseInt(d.camelot, 10);
      var ring = rings[d.camelot.slice(-1)];
      if (!ring || !(n >= 1 && n <= 12)) return;
      var angle = (n - 1) / 12 * Math.PI * 2 - Math.PI / 2;
      var r0 = ring[0] + padR, r1 = ring[1] - padR;
      var half = (Math.PI / 12) * (1 - padA);
      var rand = rng(9973 + ki * 7919);
      for (var i = 0; i < d.tracks; i++) {
        var a = angle - half + rand() * half * 2;
        /* sqrt keeps the scatter uniform per unit AREA. A linear radius would
           crowd dots against the ring's inner edge, and the outer ring would
           look sparser than the inner one at equal counts — an artefact of the
           geometry rather than anything in the data. */
        var rr = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0));
        out.push({ key: d.camelot, ki: ki,
                   x: Math.cos(a) * rr, y: Math.sin(a) * rr });
      }
    });
    return out;
  }

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
    fmt: fmt, PALETTE: PALETTE, NEUTRAL: NEUTRAL, DUR: DUR, reduced: reduced,
    CAMELOT: CAMELOT, camelotColor: camelotColor, camelotDots: camelotDots,
    loadJSON: loadJSON, loadFail: loadFail
  };
})();
