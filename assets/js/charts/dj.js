/* ===========================================================================
   dj.js — charts for "Anatomy of a DJ set".
   Real data: 6,265 plays parsed out of Serato's binary session files.

   The page is in three movements and this file serves all of them:

     1. #night  — a scrolly through ONE night (NYE 2023). Wheel + tempo arc.
     2. #ab     — the A/B panel. Two static cards, one per night, side by side,
                  plus the readout that scores them.
     3. #pop    — every transition across all 144 sets.

   Overlaying both nights on one chart was the first attempt and it was the
   wrong call: two dot clouds and two rolling means in one box is four series
   fighting over 460 pixels, and the reader has to do the separation the chart
   should have done. Two cards on a shared pair of scales says the same thing
   and asks nothing. `makeArc` is therefore written once and instantiated three
   times — the scrolly's copy and the two cards — over module-level DOMAINS, so
   the cards are directly comparable by construction rather than by accident.
   =========================================================================== */
(function () {
  'use strict';

  var B = document.documentElement.getAttribute('data-base') || '';
  var D = {};
  var DOMAIN = {};

  var MOVE_LABEL = {
    same: 'Same key',
    adjacent: 'Neighbour on the wheel',
    relative: 'Relative major / minor',
    energy: 'Two steps up (energy lift)',
    clash: 'Off the wheel'
  };
  /* The four compatible moves take categorical slots; "off the wheel" is the
     residual bucket, so it takes the neutral rather than a fifth identity. */
  var MOVE_COLOR = {
    same: '#E0700A', adjacent: '#D3468F', relative: '#B03A70',
    energy: '#B08E18', clash: '#6B7684'
  };

  /* One colour per arm of the test. Slots 1 and 2 of the categorical palette,
     already validated as an adjacent pair under both CVD simulations — and each
     arm is also labelled A / B in text, so the colour is a convenience rather
     than the thing carrying the identity. */
  var ARM_COLOR = ['#E0700A', '#4A93D6'];
  var ARM_LETTER = ['A', 'B'];

  function camelotPos(c) {
    if (!c) return null;
    var n = parseInt(c, 10);
    var letter = c.slice(-1);
    return { n: n, letter: letter, angle: (n - 1) / 12 * Math.PI * 2 - Math.PI / 2 };
  }

  /* Minutes-from-midnight back to a wall clock, for axis ticks and tooltips.
     -148 -> "21:32", +27 -> "00:27".
     Floor, not round: a clock truncates. 23:57:41 is m = -2.32, and rounding
     that to -2 would print 23:58 — one minute later than the timestamp, and
     one minute off the figure the prose beside it quotes. */
  function clockOf(m) {
    var mins = ((Math.floor(m) % 1440) + 1440) % 1440;
    var h = Math.floor(mins / 60), mm = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /* Run fn the first time el is on screen. Static charts should still arrive
     rather than simply be there — the movement is what says "this was
     measured".

     `threshold` matters more than it looks for anything inside .scrolly-graphic,
     because that column is STICKY: it is on screen from the moment the section
     starts, while the reader is still on the section lede. At 0.2 the animation
     fires and finishes before they have arrived. Pass something high for those
     so the chart is genuinely in front of the reader before it moves. */
  function whenVisible(el, fn, threshold) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { io.unobserve(e.target); fn(); }
      });
    }, { threshold: threshold === undefined ? 0.2 : threshold });
    io.observe(el);
  }

  /* ======================================================================
     1. WHEEL — the collection, then one night's moves across it
     ====================================================================== */
  function makeWheel(el) {
    var f = CH.frame(el, { top: 10, right: 10, bottom: 10, left: 10 });
    var cx = f.iw / 2, cy = f.ih / 2;
    var R = Math.min(f.iw, f.ih) / 2 - 12;
    var rings = { B: [R * 0.70, R], A: [R * 0.40, R * 0.70] };

    var g = f.g.append('g').attr('transform', 'translate(' + cx + ',' + cy + ')');
    var bandG = g.append('g');       // the empty segment — hue, faint. The axis.
    var dotG = g.append('g');        // one dot per track. This is the value.
    var chordG = g.append('g');
    var labelG = g.append('g');

    var maxTracks = d3.max(D.stats.wheel, function (w) { return w.tracks; });

    /* Track count is DENSITY — one semi-transparent dot per track in the library.
       Two encodings came before this one and both failed at the same end of the
       range. Opacity-as-count asks the eye to compare twelve different hues for
       darkness, which people are bad at and CVD makes impossible. Length-as-count
       is honest and readable at the top, but the library spans 310 tracks in 9A
       against 8 in 3B — a 39:1 ratio — so the quiet keys drew a two-pixel stub
       and read as empty. A key I have played eight times is not nothing, and the
       chart said it was.

       Dots fix the bottom of the range for free: eight tracks is eight countable
       marks. The cost is at the top, where the busiest keys saturate into a mass
       and stop being rankable against each other — so DOT_R and DOT_ALPHA are
       tuned to leave headroom rather than go solid, and the tooltip carries the
       exact number. That trade is the right way round for this chart: the
       question it answers is "where does my library live", which is about
       clusters, not about whether 9A beats 8A.

       Dot radius is a FRACTION OF THE WHEEL, never a fixed number. What the eye
       reads is ink coverage — dots × dot area ÷ ring area — and ring area goes
       with R², so a constant radius makes a big wheel look washed out and a
       small one look clogged. The first version was a flat 1.5 units, which at
       the case study's R = 243 gave 8.6% coverage against the dashboard tile's
       48% at R = 58: the same data, five and a half times less ink, and it
       showed. */
    var DOT_R = Math.max(1.2, R * 0.0118);
    var DOT_ALPHA = 0.38;
    var PAD_A = 0.12;                // fraction of the wedge angle kept clear
    var PAD_R = 3.5;                 // clearance at the ring's inner/outer edge

    var arc = d3.arc().padAngle(0.012).cornerRadius(1);

    function wedgePath(d, frac) {
      var p = camelotPos(d.camelot);
      var r = rings[p.letter];
      return arc({
        innerRadius: r[0],
        outerRadius: r[0] + (r[1] - r[0]) * frac,
        startAngle: p.angle + Math.PI / 2 - Math.PI / 12,
        endAngle: p.angle + Math.PI / 2 + Math.PI / 12
      });
    }

    function tip(evt, d) {
      Tip.show('<span class="tip-k">' + d.camelot + ' · ' +
        (d.camelot.slice(-1) === 'A' ? 'minor' : 'major') + '</span>' +
        '<strong>' + d.tracks + '</strong> tracks in the library' +
        (maxTracks ? '<br>' + Math.round(100 * d.tracks / maxTracks) +
          '% of my most-played key' : ''), evt);
    }

    /* The empty segment doubles as the hit target, so hovering anywhere in a
       key's slot works — not just where a dot happens to have landed. */
    var bands = bandG.selectAll('path').data(D.stats.wheel).enter().append('path')
      .attr('d', function (d) { return wedgePath(d, 1); })
      // One hue per Camelot number, the way every DJ already reads the wheel.
      // A and B share the hue — that is what a relative major/minor pair is —
      // and the outer/inner ring is what tells them apart.
      .attr('fill', function (d) { return CH.camelotColor(d.camelot); })
      .attr('fill-opacity', 0.14)
      .attr('stroke', 'var(--paper)').attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mousemove', tip)
      .on('mouseleave', function () { Tip.hide(); });

    var dotData = CH.camelotDots(D.stats.wheel, rings, { padA: PAD_A, padR: PAD_R });

    var dots = dotG.selectAll('circle').data(dotData).enter().append('circle')
      .attr('cx', function (d) { return d.x; })
      .attr('cy', function (d) { return d.y; })
      .attr('r', 0)
      .attr('fill', function (d) { return CH.camelotColor(d.key); })
      .attr('fill-opacity', DOT_ALPHA)
      .style('pointer-events', 'none');      // the band underneath owns the mouse

    /* Deferred to first visibility, NOT called from update().
       Scrolly.init runs activate(0) at wire-up so the graphic is never blank,
       which meant update() fired on page load and the dots bloomed to their
       full size while the wheel was still far below the fold. The animation
       ran perfectly and nobody ever saw it. */
    var bloomed = false;
    function bloom() {
      if (bloomed) return;
      bloomed = true;
      if (CH.reduced) { dots.attr('r', DOT_R); return; }
      // Staggered by KEY rather than by dot: 2,246 individually-delayed
      // transitions is a lot of scheduling for an effect nobody can resolve.
      dots.transition().duration(700).ease(d3.easeCubicOut)
        .delay(function (d) { return d.ki * 42; })
        .attr('r', DOT_R);
    }

    // Number labels sit outside the outer ring. Deliberately not tinted to
    // their hue: at 10px, half the ring would fail text contrast on paper.
    labelG.selectAll('text').data(d3.range(1, 13)).enter().append('text')
      .attr('class', 'chart-sub')
      .attr('x', function (n) { return Math.cos((n - 1) / 12 * Math.PI * 2 - Math.PI / 2) * (R + 8); })
      .attr('y', function (n) { return Math.sin((n - 1) / 12 * Math.PI * 2 - Math.PI / 2) * (R + 8); })
      .attr('text-anchor', 'middle').attr('dy', '0.32em')
      .style('fill', '#8A837C')
      .text(function (n) { return n; });

    var centre = g.append('text').attr('class', 'annot-sub')
      .attr('text-anchor', 'middle').attr('dy', '0.32em')
      .style('font-size', '11px').style('fill', '#8A837C');

    function pointFor(c) {
      var p = camelotPos(c);
      if (!p) return null;
      var r = rings[p.letter];
      var mid = (r[0] + r[1]) / 2;
      return [Math.cos(p.angle) * mid, Math.sin(p.angle) * mid];
    }

    /* s.chords: draw the featured night's transitions
       s.set:    which night (default 0 — the one #night walks through)
       s.only:   restrict to a single move type */
    function update(s) {
      var dur = CH.reduced ? 0 : 600;
      centre.text(s.centre || '');

      var chords = [];
      if (s.chords) {
        var night = D.compare.sets[s.set || 0];
        if (night) {
          night.transitions.forEach(function (t) {
            if (!t.from || !t.to || t.from === t.to) return;
            if (s.only && t.move !== s.only) return;
            var a = pointFor(t.from), b = pointFor(t.to);
            if (a && b) chords.push({ a: a, b: b, move: t.move });
          });
        }
      }

      var sel = chordG.selectAll('path').data(chords);
      sel.exit().transition().duration(dur).style('opacity', 0).remove();
      sel.enter().append('path')
        .attr('fill', 'none').attr('stroke-width', 1.1).style('opacity', 0)
        .merge(sel)
        .attr('d', function (d) {
          // Bow every chord toward the centre so parallel moves stay legible.
          return 'M' + d.a[0] + ',' + d.a[1] + 'Q0,0 ' + d.b[0] + ',' + d.b[1];
        })
        .attr('stroke', function (d) { return MOVE_COLOR[d.move]; })
        .transition().duration(dur)
        .style('opacity', function (d) { return d.move === 'clash' ? 0.28 : 0.72; });

      // Recede the library behind the chords without moving a single dot —
      // the positions are the measurement, so only the ink weight changes.
      dots.transition('recede').duration(dur)
        .attr('fill-opacity', chords.length ? DOT_ALPHA * 0.34 : DOT_ALPHA);
      bands.transition('recede').duration(dur)
        .attr('fill-opacity', chords.length ? 0.06 : 0.14);
    }

    /* Deliberately NOT wired here. The graphic column is sticky, so it is 88%
       on screen while the reader is still on the section lede — any threshold
       fires early. boot() hangs this off the first STEP CARD instead, which is
       in the scrolling column and therefore only arrives when the reader does. */
    return { update: update, reveal: bloom };
  }

  /* ======================================================================
     2. ARC — one night, tempo against a clock anchored at midnight.
     Written once, instantiated three times: the scrolly's copy and one per
     A/B card. Every instance shares DOMAIN, so the two cards are comparable
     by construction — the single most important property of the panel.
     ====================================================================== */
  function makeArc(el, si, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var night = D.compare.sets[si];
    var colour = ARM_COLOR[si];

    var f = CH.frame(el, compact
      ? { top: 14, right: 14, bottom: 28, left: 36 }
      : { top: 26, right: 30, bottom: 40, left: 48 });

    var x = d3.scaleLinear().domain(DOMAIN.m).range([0, f.iw]);
    var y = d3.scaleLinear().domain(DOMAIN.bpm).range([f.ih, 0]);

    f.g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(compact ? 4 : 5).tickSize(-f.iw).tickFormat(''))
      .select('.domain').remove();
    f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')')
      .call(d3.axisBottom(x).ticks(compact ? 4 : 8).tickFormat(clockOf));
    f.g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).ticks(compact ? 4 : 5));
    if (!compact) {
      f.g.append('text').attr('class', 'chart-sub')
        .attr('transform', 'rotate(-90)').attr('y', -36)
        .attr('text-anchor', 'end').text('BPM');
    }

    /* Midnight. The one x position both nights genuinely share, and the reason
       this axis is measured from it rather than from either set's start. */
    var midG = f.g.append('g').style('opacity', 0);
    midG.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', -4).attr('y2', f.ih)
      .attr('stroke', 'var(--ink)').attr('stroke-width', 1.2).attr('stroke-dasharray', '4 3');
    midG.append('text').attr('class', 'chart-sub').attr('x', x(0)).attr('y', -6)
      .attr('text-anchor', 'middle').style('fill', 'var(--ink)')
      .style('font-size', compact ? '8.5px' : '10px')
      .text(compact ? '00:00' : 'MIDNIGHT');

    // A rolling mean reads as "the energy of the room" better than raw
    // track-to-track jitter does. A median was the first attempt and produced
    // a staircase: with a nine-track window over a set this tempo-tight, the
    // middle value simply stops changing for stretches.
    var W = 4;
    var tracks = night.tracks.filter(function (t) { return t.bpm; });
    var smooth = tracks.map(function (t, i) {
      var win = tracks.slice(Math.max(0, i - W), i + W + 1);
      return { m: t.m, bpm: d3.mean(win, function (v) { return v.bpm; }) };
    });

    var line = d3.line().x(function (d) { return x(d.m); }).y(function (d) { return y(d.bpm); })
      .curve(d3.curveMonotoneX);

    var trend = f.g.append('path').datum(smooth).attr('class', 'series-line')
      .attr('stroke', colour).attr('stroke-width', compact ? 2 : 2.4)
      .attr('d', line).style('opacity', 0);

    var dots = f.g.append('g').selectAll('circle').data(tracks).enter().append('circle')
      .attr('cx', function (d) { return x(d.m); })
      .attr('cy', function (d) { return y(d.bpm); })
      .attr('r', compact ? 2.4 : 3).attr('fill', colour).attr('opacity', 0)
      .style('cursor', 'pointer')
      .on('mousemove', function (evt, d) {
        Tip.show('<span class="tip-k">' + ARM_LETTER[si] + ' · NYE ' + night.year +
          ' · ' + clockOf(d.m) + (d.camelot ? ' · ' + d.camelot : '') +
          ' · ' + d.bpm + ' bpm</span>' +
          '<strong>' + d.title + '</strong><br>' + d.artist, evt);
      })
      .on('mouseleave', function () { Tip.hide(); });

    var annotG = f.g.append('g');
    /* Annotations are placed on a delay so the leader line does not point at
       where the data used to be. That means a fast scroll can leave a pending
       timeout from the step you just left, which fires *after* the next step has
       already cleared the layer and puts the old label back. Every update takes
       a ticket; a timeout that is no longer holding the current one does
       nothing. `woodridge.js` guards the same hazard by comparing state.annot. */
    var annotGen = 0;
    var drawn = false;

    /* s.trend:    draw the rolling mean
       s.midnight: reveal the midnight rule
       s.annot:    [{at:'last_of_year'|'first_of_year', dx, dy, label, sub}] */
    function update(s) {
      s = s || {};
      var dur = CH.reduced ? 0 : 600;

      CH.show(midG, !!s.midnight, dur);
      CH.show(trend, !!s.trend, dur);
      if (s.trend && !drawn) { drawn = true; CH.drawIn(trend, compact ? 1200 : 1500); }

      dots.transition('emph').duration(dur)
        .delay(function (d, i) { return CH.reduced ? 0 : (i % 24) * 12; })
        .attr('opacity', s.trend ? 0.5 : 0.8);

      var gen = ++annotGen;
      annotG.selectAll('*').remove();
      (s.annot || []).forEach(function (a, i) {
        var hit = night.midnight[a.at];
        if (!hit || !hit.bpm) return;
        window.setTimeout(function () {
          if (gen !== annotGen) return;        // a later step already took over
          CH.annotate(annotG, {
            key: 'a' + i, x: x(hit.m), y: y(hit.bpm),
            dx: a.dx, dy: a.dy,
            label: a.label || hit.title,
            sub: a.sub || (clockOf(hit.m) + ' · ' + hit.artist)
          }).style('opacity', 0).transition().duration(340).style('opacity', 1);
        }, dur * 0.5);
      });
    }

    return { update: update };
  }

  /* ======================================================================
     3. READOUT — the A/B scoreboard, one row per metric.
     Each row carries its own scale. A shared axis would be a lie: minutes,
     BPM and percentages do not belong on one ruler, and the question a row
     answers is "which way did this move and by how much", not "how does
     length compare to tempo discipline".
     ====================================================================== */
  function makeReadout(el) {
    var f = CH.frame(el, { top: 20, right: 74, bottom: 22, left: 150 });
    var metrics = D.compare.metrics;
    var years = D.compare.meta.years;

    var y = d3.scaleBand().domain(metrics.map(function (m) { return m.key; }))
      .range([0, f.ih]).padding(0.46);

    var axisG = f.g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).tickSize(0).tickFormat(function (k) {
        var m = metrics.filter(function (v) { return v.key === k; })[0];
        return m.short || m.label;
      }));
    axisG.select('.domain').remove();

    // Per-row scale: zero at the left, a little headroom past the larger value.
    function rowX(m) {
      var hi = d3.max(m.values) || 1;
      return d3.scaleLinear().domain([0, hi * 1.06]).range([0, f.iw]);
    }

    var rows = f.g.selectAll('g.srow').data(metrics).enter().append('g')
      .attr('class', 'srow').attr('transform', function (m) {
        return 'translate(0,' + (y(m.key) + y.bandwidth() / 2) + ')';
      });

    // The track the two dots sit on, so a short bar still reads as a position.
    rows.append('line')
      .attr('x1', 0).attr('y1', 0).attr('y2', 0)
      .attr('x2', function (m) { return rowX(m)(d3.max(m.values)); })
      .attr('stroke', 'var(--rule-lite)').attr('stroke-width', 1);

    // The move between A and B.
    var jump = rows.append('line')
      .attr('y1', 0).attr('y2', 0)
      .attr('x1', function (m) { return rowX(m)(m.values[0]); })
      .attr('x2', function (m) { return rowX(m)(m.values[0]); })
      .attr('stroke', 'var(--neutral)').attr('stroke-width', 2.4)
      .attr('stroke-linecap', 'round').attr('opacity', 0.45);

    var dots = rows.selectAll('circle')
      .data(function (m) {
        return m.values.map(function (v, i) { return { m: m, v: v, i: i }; });
      })
      .enter().append('circle')
      .attr('cy', 0)
      .attr('cx', function (d) { return rowX(d.m)(d.m.values[0]); })
      .attr('r', 5.5)
      .attr('fill', function (d) { return ARM_COLOR[d.i]; })
      .attr('stroke', 'var(--paper)').attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mousemove', function (evt, d) {
        // The full label, since the axis only had room for the short one.
        Tip.show('<span class="tip-k">' + ARM_LETTER[d.i] + ' · NYE ' + years[d.i] +
          '</span>' + d.m.label + ': <strong>' + d.v + d.m.unit + '</strong>', evt);
      })
      .on('mouseleave', function () { Tip.hide(); });

    // The delta. Only marked good/bad where the metric has a direction — a
    // shorter night is not a worse one, and leaving the wheel is a choice.
    var delta = rows.append('text').attr('class', 'annot-sub')
      .attr('x', f.iw + 12).attr('dy', '0.32em')
      .style('font-size', '12.5px').style('font-weight', 600).style('opacity', 0)
      .style('fill', function (m) {
        if (!m.better) return '#6A646D';
        var good = (m.better === 'up') === (m.values[1] > m.values[0]);
        return good ? 'var(--good)' : 'var(--bad)';
      })
      .text(function (m) {
        var diff = Math.round((m.values[1] - m.values[0]) * 10) / 10;
        return (diff > 0 ? '+' : '') + diff + m.unit;
      });

    /* Every row starts collapsed at A and opens to B. The animation IS the
       result: what you watch is how far each measure moved. */
    function reveal() {
      var dur = CH.reduced ? 0 : 900;
      var stagger = function (d, i) { return CH.reduced ? 0 : i * 110; };

      jump.transition().duration(dur).delay(stagger).ease(d3.easeCubicOut)
        .attr('x2', function (m) { return rowX(m)(m.values[1]); });
      dots.transition().duration(dur)
        .delay(function (d) { return stagger(d, metrics.indexOf(d.m)); })
        .ease(d3.easeCubicOut)
        .attr('cx', function (d) { return rowX(d.m)(d.v); });
      delta.transition().duration(dur)
        .delay(function (m, i) { return stagger(m, i) + dur * 0.55; })
        .style('opacity', 1);
    }

    return { reveal: reveal };
  }

  /* ======================================================================
     4. MOVES — every transition across every set
     ====================================================================== */
  function makeMoves(el) {
    var f = CH.frame(el, { top: 22, right: 74, bottom: 38, left: 176 });
    var moves = D.stats.moves.slice().sort(function (a, b) { return b.count - a.count; });

    var x = d3.scaleLinear().domain([0, d3.max(moves, function (m) { return m.share; }) * 1.1]).range([0, f.iw]);
    var y = d3.scaleBand().domain(moves.map(function (m) { return m.move; }))
      .range([0, f.ih]).padding(0.34);

    var axisG = f.g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).tickSize(0).tickFormat(function (k) { return MOVE_LABEL[k] || k; }));
    axisG.select('.domain').remove();
    f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')')
      .call(d3.axisBottom(x).ticks(5).tickFormat(function (v) { return v + '%'; }));

    var g = f.g.selectAll('g.mrow').data(moves).enter().append('g').attr('class', 'mrow');
    g.append('rect')
      .attr('y', function (d) { return y(d.move); }).attr('height', y.bandwidth())
      .attr('rx', 2).attr('width', 0)
      .attr('fill', function (d) { return MOVE_COLOR[d.move]; })
      .style('cursor', 'pointer')
      .on('mousemove', function (evt, d) {
        Tip.show('<span class="tip-k">' + (MOVE_LABEL[d.move] || d.move) + '</span>' +
          '<strong>' + d.share + '%</strong> of all transitions<br>' +
          CH.fmt.int(d.count) + ' of ' + CH.fmt.int(D.stats.bpm_discipline.transitions), evt);
      })
      .on('mouseleave', function () { Tip.hide(); });
    g.append('text').attr('class', 'annot-sub')
      .attr('y', function (d) { return y(d.move) + y.bandwidth() / 2; })
      .attr('dy', '0.32em').style('opacity', 0)
      .text(function (d) { return d.share + '%  ·  ' + CH.fmt.int(d.count); });

    function reveal() {
      var dur = CH.reduced ? 0 : 900;
      g.select('rect').transition().duration(dur).delay(function (d, i) { return i * 90; })
        .attr('width', function (d) { return x(d.share); });
      g.select('text').transition().duration(dur).delay(function (d, i) { return i * 90 + 240; })
        .attr('x', function (d) { return x(d.share) + 8; }).style('opacity', 1);
    }

    return { reveal: reveal };
  }

  /* ======================================================================
     numbers in prose + the two setlists
     ====================================================================== */
  function renderStats() {
    var t = D.stats.totals, disc = D.stats.bpm_discipline;
    var map = {
      plays: CH.fmt.int(t.plays),
      tracks: CH.fmt.int(t.unique_tracks),
      sets: CH.fmt.int(t.sets),
      hours: CH.fmt.int(Math.round(t.hours)),
      keycov: Math.round(t.key_coverage * 100) + '%',
      streamed: Math.round(t.streamed_share * 100) + '%',
      transitions: CH.fmt.int(disc.transitions),
      within2: disc.within_2_pct + '%',
      within6: disc.within_6_pct + '%',
      firstdate: t.first_date,
      lastdate: t.last_date
    };

    /* Per-arm keys, so the prose can name either night without a single number
       being typed into the markup: data-dj="s2jump" is whatever the parser last
       measured for arm B. */
    D.compare.sets.forEach(function (n, i) {
      var p = 's' + (i + 1), sm = n.summary;
      map[p + 'arm'] = ARM_LETTER[i];
      map[p + 'year'] = n.year;
      map[p + 'date'] = n.date;
      map[p + 'start'] = n.start;
      map[p + 'end'] = n.end;
      map[p + 'tracks'] = sm.tracks;
      map[p + 'mins'] = Math.round(sm.minutes);
      map[p + 'hours'] = (sm.minutes / 60).toFixed(1);
      map[p + 'jump'] = sm.median_jump;
      map[p + 'w2'] = sm.within_2_pct + '%';
      map[p + 'w6'] = sm.within_6_pct + '%';
      map[p + 'clash'] = sm.clash_pct + '%';
      map[p + 'compat'] = sm.compatible_pct + '%';
      map[p + 'keycov'] = Math.round(sm.key_coverage * 100) + '%';
      map[p + 'run'] = sm.longest_harmonic_run;
      map[p + 'bpm'] = sm.bpm_median;
      map[p + 'dev'] = n.device;
      /* Transition counts, split by which measure they can actually support.
         The A/B caveat quotes the tempo-delta count specifically, because that
         is what a rank-sum test on tempo change would have to run on — and a
         transition is only in it if BOTH tracks carried a BPM. Quoting the raw
         transition count there would overstate the sample of the test I am
         explaining that I did not run. */
      map[p + 'trans'] = n.transitions.length;
      map[p + 'transbpm'] = n.transitions.filter(function (t) {
        return t.bpm_delta !== null && t.bpm_delta !== undefined;
      }).length;
      map[p + 'transkey'] = n.transitions.filter(function (t) {
        return t.move;
      }).length;
      if (n.midnight.first_of_year) {
        map[p + 'first'] = n.midnight.first_of_year.title;
        map[p + 'firstartist'] = n.midnight.first_of_year.artist;
        map[p + 'firsttime'] = clockOf(n.midnight.first_of_year.m);
      }
      if (n.midnight.last_of_year) {
        map[p + 'last'] = n.midnight.last_of_year.title;
        map[p + 'lastartist'] = n.midnight.last_of_year.artist;
        map[p + 'lasttime'] = clockOf(n.midnight.last_of_year.m);
      }
    });

    Object.keys(map).forEach(function (k) {
      [].forEach.call(document.querySelectorAll('[data-dj="' + k + '"]'), function (n) {
        n.textContent = map[k];
      });
    });
  }

  function setlistTable(night) {
    return '<table class="data-table setlist"><thead><tr>' +
      '<th>Time</th><th>Track</th><th>BPM</th><th>Key</th></tr></thead><tbody>' +
      night.tracks.map(function (t) {
        return '<tr><td>' + clockOf(t.m) + '</td>' +
          '<td class="ttl"><strong>' + t.title + '</strong><span>' + t.artist + '</span></td>' +
          '<td>' + (t.bpm || '—') + '</td>' +
          '<td>' + (t.camelot || '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* Two 90-row tables stacked would bury the page, so they share one slot with
     a switch. Both are in the DOM either way — a find-in-page for a track title
     should work on the night you are not looking at. */
  function renderSetlists() {
    var host = document.querySelector('[data-setlist]');
    if (!host) return;
    var nights = D.compare.sets;

    host.innerHTML =
      '<div class="setlist-switch" role="tablist" aria-label="Choose a night">' +
        nights.map(function (n, i) {
          return '<button role="tab" data-year="' + i + '"' +
            ' aria-selected="' + (i === 0) + '"' +
            ' style="--sw:' + ARM_COLOR[i] + '">' + ARM_LETTER[i] + ' · NYE ' + n.year +
            ' <span class="ash">· ' + n.n + ' tracks</span></button>';
        }).join('') +
      '</div>' +
      nights.map(function (n, i) {
        return '<div class="setlist-panel" data-panel="' + i + '"' +
          ' role="tabpanel" id="setlist-panel-' + i + '"' +
          ' aria-labelledby="setlist-tab-' + i + '"' +
          (i === 0 ? '' : ' hidden') + '>' + setlistTable(n) + '</div>';
      }).join('');

    var btns = [].slice.call(host.querySelectorAll('[data-year]'));
    btns.forEach(function (b, i) {
      b.id = 'setlist-tab-' + i;
      b.setAttribute('aria-controls', 'setlist-panel-' + i);
      b.addEventListener('click', function () {
        var pick = b.getAttribute('data-year');
        btns.forEach(function (o) { o.setAttribute('aria-selected', o === b); });
        [].forEach.call(host.querySelectorAll('[data-panel]'), function (p) {
          p.hidden = p.getAttribute('data-panel') !== pick;
        });
      });
    });
  }

  /* ====================================================================== */
  function showViz(root, which) {
    d3.select(root).selectAll('[data-viz]').each(function () {
      var on = this.getAttribute('data-viz') === which;
      d3.select(this).style('opacity', on ? 1 : 0).attr('aria-hidden', on ? null : 'true');
    });
  }

  /* The #night scrolly walks ONE night. The comparison is not here — it is the
     static A/B panel below, where both arms can be on screen at once. */
  var STEPS = [
    { viz: 'wheel', state: { centre: 'the library' },
      cap: 'One dot per track in the library, placed by musical key. Where I live shows up as density.' },

    { viz: 'arc', state: { midnight: true },
      cap: 'New Year\'s Eve 2023. Each dot is a track, placed by tempo against the clock.' },

    { viz: 'arc', state: { midnight: true, trend: true },
      cap: 'Rolling mean tempo — the shape of the room.' },

    { viz: 'arc', state: {
        midnight: true, trend: true,
        annot: [{ at: 'last_of_year', dx: -62, dy: -52,
                  label: 'Auld Lang Syne', sub: '23:57 — the data knows what night it is' }]
      }, cap: 'Midnight, without anyone having to label it.' },

    { viz: 'wheel', state: { chords: true, set: 0, centre: 'one night' },
      cap: 'Every transition in that set, drawn across the wheel.' },

    { viz: 'wheel', state: { chords: true, set: 0, only: 'adjacent', centre: 'neighbours' },
      cap: 'Only the moves to a neighbouring key. My longest unbroken run was three.' }
  ];

  function boot() {
    CH.loadJSON([
      B + 'data/dj/stats.json',
      B + 'data/dj/compare.json'
    ]).then(function (res) {
      D.stats = res[0];
      D.compare = res[1];

      /* Shared domains, computed once. This is what makes the two A/B cards
         comparable — if each card scaled to its own night, arm B would look
         like it held a wider tempo band than it did. */
      var allBpm = [];
      D.compare.sets.forEach(function (n) {
        n.tracks.forEach(function (t) { if (t.bpm) allBpm.push(t.bpm); });
      });
      DOMAIN.m = D.compare.meta.m_domain;
      DOMAIN.bpm = [d3.min(allBpm) - 6, d3.max(allBpm) + 6];

      renderStats();
      renderSetlists();

      /* --- the #night scrolly ------------------------------------------- */
      var root = document.querySelector('#scrolly-dj');
      if (root) {
        var VIZ = {
          wheel: makeWheel(root.querySelector('[data-viz="wheel"] .graphic-body')),
          arc: makeArc(root.querySelector('[data-viz="arc"] .graphic-body'), 0)
        };

        /* The wheel's dots bloom when the reader reaches the first STEP CARD —
           not when the chart is technically on screen, and not at wire-up.
           Two things conspire against the obvious version: Scrolly runs
           activate(0) immediately so the graphic is never blank, and the graphic
           column is sticky, so it is ~88% visible while the reader is still on
           the section lede. Observing a step card is the only signal that
           actually means "they are here". */
        var firstStep = root.querySelector('.step');
        if (firstStep) whenVisible(firstStep, VIZ.wheel.reveal, 0.9);

        Scrolly.init('#scrolly-dj', function (i) {
          var s = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))];
          showViz(root, s.viz);
          VIZ[s.viz].update(s.state);
          d3.select(root).select('[data-viz="' + s.viz + '"] .graphic-foot').text(s.cap);
        });
      }

      /* --- the A/B panel ------------------------------------------------ */
      [].forEach.call(document.querySelectorAll('[data-ab-chart]'), function (el) {
        var si = +el.getAttribute('data-ab-chart');
        var inst = makeArc(el, si, { compact: true });
        whenVisible(el, function () { inst.update({ trend: true, midnight: true }); });
      });

      var readoutEl = document.querySelector('[data-ab-readout]');
      if (readoutEl) {
        var readout = makeReadout(readoutEl);
        whenVisible(readoutEl, readout.reveal);
      }

      /* --- population view ---------------------------------------------- */
      var movesEl = document.querySelector('[data-moves]');
      if (movesEl) {
        var moves = makeMoves(movesEl);
        whenVisible(movesEl, moves.reveal);
      }
    }).catch(function (err) {
      CH.loadFail(document.querySelector('.scrolly-graphic') || document.body, err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
