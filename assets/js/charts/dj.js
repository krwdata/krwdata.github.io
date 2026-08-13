/* ===========================================================================
   dj.js — charts for "Anatomy of a DJ set".
   Real data: 6,265 plays parsed out of Serato's binary session files.
   Three graphics: the Camelot wheel, one night's energy arc, and the
   population-level view of how the transitions actually break down.
   =========================================================================== */
(function () {
  'use strict';

  var B = document.documentElement.getAttribute('data-base') || '';
  var D = {};

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

  function camelotPos(c) {
    if (!c) return null;
    var n = parseInt(c, 10);
    var letter = c.slice(-1);
    return { n: n, letter: letter, angle: (n - 1) / 12 * Math.PI * 2 - Math.PI / 2 };
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
    var wedgeG = g.append('g');
    var chordG = g.append('g');
    var labelG = g.append('g');

    var maxTracks = d3.max(D.stats.wheel, function (w) { return w.tracks; });
    var opacity = d3.scaleSqrt().domain([0, maxTracks]).range([0.06, 0.92]);

    var arc = d3.arc().padAngle(0.012).cornerRadius(1);

    var wedges = wedgeG.selectAll('path').data(D.stats.wheel).enter().append('path')
      .attr('d', function (d) {
        var p = camelotPos(d.camelot);
        var r = rings[p.letter];
        return arc({
          innerRadius: r[0], outerRadius: r[1],
          startAngle: p.angle + Math.PI / 2 - Math.PI / 12,
          endAngle: p.angle + Math.PI / 2 + Math.PI / 12
        });
      })
      // Outer ring is major, inner ring minor — colour says the same thing the
      // geometry does, which is what makes the wheel readable at a glance.
      .attr('fill', function (d) {
        return d.camelot.slice(-1) === 'B' ? 'var(--series-1)' : 'var(--series-3)';
      })
      .attr('fill-opacity', function (d) { return opacity(d.tracks); })
      .attr('stroke', 'var(--paper)').attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mousemove', function (evt, d) {
        Tip.show('<span class="tip-k">' + d.camelot + ' · ' +
          (d.camelot.slice(-1) === 'A' ? 'minor' : 'major') + '</span>' +
          d.tracks + ' tracks in the library', evt);
      })
      .on('mouseleave', function () { Tip.hide(); });

    // Number labels sit outside the outer ring.
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

    function update(s) {
      var dur = CH.reduced ? 0 : 600;
      centre.text(s.centre || '');

      var chords = [];
      if (s.chords) {
        D.featured.transitions.forEach(function (t) {
          if (!t.from || !t.to || t.from === t.to) return;
          if (s.only && t.move !== s.only) return;
          var a = pointFor(t.from), b = pointFor(t.to);
          if (a && b) chords.push({ a: a, b: b, move: t.move });
        });
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
        .style('opacity', function (d) { return d.move === 'clash' ? 0.28 : 0.7; });

      wedges.transition().duration(dur)
        .attr('fill-opacity', function (d) {
          return s.chords ? opacity(d.tracks) * 0.45 : opacity(d.tracks);
        });
    }

    return { update: update };
  }

  /* ======================================================================
     2. ARC — one night, tempo by the clock
     ====================================================================== */
  function makeArc(el) {
    var f = CH.frame(el, { top: 24, right: 26, bottom: 40, left: 48 });
    var tracks = D.featured.tracks.filter(function (t) { return t.bpm; });
    var meta = D.featured.meta;

    // Convert minutes-into-the-set into a wall clock, because "23:59" is the
    // whole point of this particular night.
    var startParts = meta.start.split(':');
    var t0 = new Date(meta.date + 'T00:00:00');
    t0.setHours(+startParts[0], +startParts[1], 0, 0);
    tracks.forEach(function (t) { t.clock = new Date(t0.getTime() + t.t * 60000); });

    var x = d3.scaleTime().domain(d3.extent(tracks, function (t) { return t.clock; })).range([0, f.iw]);
    var y = d3.scaleLinear().domain([
      d3.min(tracks, function (t) { return t.bpm; }) - 6,
      d3.max(tracks, function (t) { return t.bpm; }) + 6
    ]).range([f.ih, 0]);

    f.g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-f.iw).tickFormat(''))
      .select('.domain').remove();
    f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')')
      .call(d3.axisBottom(x).ticks(7).tickFormat(d3.timeFormat('%H:%M')));
    f.g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5));
    f.g.append('text').attr('class', 'chart-sub')
      .attr('transform', 'rotate(-90)').attr('y', -36).attr('text-anchor', 'end').text('BPM');

    // A rolling mean reads as "the energy of the room" better than raw
    // track-to-track jitter does. A median was the first attempt and produced
    // a staircase: with a nine-track window over a set this tempo-tight, the
    // middle value simply stops changing for stretches.
    var W = 4;
    var smooth = tracks.map(function (t, i) {
      var win = tracks.slice(Math.max(0, i - W), i + W + 1);
      return { clock: t.clock, bpm: d3.mean(win, function (v) { return v.bpm; }) };
    });

    var line = d3.line().x(function (d) { return x(d.clock); }).y(function (d) { return y(d.bpm); })
      .curve(d3.curveMonotoneX);
    var trend = f.g.append('path').datum(smooth).attr('class', 'series-line')
      .attr('stroke', 'var(--series-1)').attr('stroke-width', 2.4).attr('d', line).style('opacity', 0);

    var dots = f.g.append('g').selectAll('circle').data(tracks).enter().append('circle')
      .attr('cx', function (d) { return x(d.clock); })
      .attr('cy', function (d) { return y(d.bpm); })
      .attr('r', 3).attr('fill', 'var(--neutral)').attr('opacity', 0)
      .style('cursor', 'pointer')
      .on('mousemove', function (evt, d) {
        Tip.show('<span class="tip-k">' + d3.timeFormat('%H:%M')(d.clock) +
          (d.camelot ? ' · ' + d.camelot : '') + ' · ' + d.bpm + ' bpm</span>' +
          '<strong>' + d.title + '</strong><br>' + d.artist, evt);
      })
      .on('mouseleave', function () { Tip.hide(); });

    var annotG = f.g.append('g');
    var drawn = false;

    function update(s) {
      var dur = CH.reduced ? 0 : 600;
      CH.show(trend, !!s.trend, dur);
      if (s.trend && !drawn) { drawn = true; CH.drawIn(trend, 1500); }

      dots.transition().duration(dur)
        .attr('fill', function (d) {
          return s.mark && d.title.toLowerCase().indexOf(s.mark.toLowerCase()) === 0
            ? 'var(--accent-mark)' : 'var(--neutral)';
        })
        .attr('r', function (d) {
          return s.mark && d.title.toLowerCase().indexOf(s.mark.toLowerCase()) === 0 ? 6 : 3;
        })
        .attr('opacity', function (d) { return s.trend ? 0.55 : 0.8; });

      annotG.selectAll('*').remove();
      if (s.mark) {
        var hit = tracks.filter(function (d) {
          return d.title.toLowerCase().indexOf(s.mark.toLowerCase()) === 0;
        })[0];
        if (hit) {
          window.setTimeout(function () {
            CH.annotate(annotG, {
              key: 'm', x: x(hit.clock), y: y(hit.bpm),
              dx: s.dx || -50, dy: s.dy || -46,
              label: s.label || hit.title,
              sub: s.sub || (d3.timeFormat('%H:%M')(hit.clock) + ' · ' + hit.artist)
            }).style('opacity', 0).transition().duration(340).style('opacity', 1);
          }, dur * 0.5);
        }
      }
    }

    return { update: update };
  }

  /* ======================================================================
     3. MOVES — every transition across every set
     ====================================================================== */
  function makeMoves(el) {
    var f = CH.frame(el, { top: 26, right: 66, bottom: 40, left: 176 });
    var moves = D.stats.moves.slice().sort(function (a, b) { return b.count - a.count; });

    var x = d3.scaleLinear().domain([0, d3.max(moves, function (m) { return m.share; }) * 1.1]).range([0, f.iw]);
    var y = d3.scaleBand().domain(moves.map(function (m) { return m.move; }))
      .range([0, f.ih * 0.8]).padding(0.34);

    var axisG = f.g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).tickSize(0).tickFormat(function (k) { return MOVE_LABEL[k] || k; }));
    axisG.select('.domain').remove();
    f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + (f.ih * 0.8) + ')')
      .call(d3.axisBottom(x).ticks(5).tickFormat(function (v) { return v + '%'; }));

    var g = f.g.selectAll('g.mrow').data(moves).enter().append('g').attr('class', 'mrow');
    g.append('rect')
      .attr('y', function (d) { return y(d.move); }).attr('height', y.bandwidth())
      .attr('rx', 2).attr('width', 0)
      .attr('fill', function (d) { return MOVE_COLOR[d.move]; });
    g.append('text').attr('class', 'annot-sub')
      .attr('y', function (d) { return y(d.move) + y.bandwidth() / 2; })
      .attr('dy', '0.32em').style('opacity', 0)
      .text(function (d) { return d.share + '%  ·  ' + CH.fmt.int(d.count); });

    var note = f.g.append('text').attr('class', 'annot-sub')
      .attr('x', 0).attr('y', f.ih * 0.8 + 62).style('opacity', 0).style('font-size', '13px');

    function update(s) {
      var dur = CH.reduced ? 0 : 750;
      g.select('rect').transition().duration(dur).delay(function (d, i) { return i * 80; })
        .attr('width', function (d) { return x(d.share); });
      g.select('text').transition().duration(dur).delay(function (d, i) { return i * 80 + 200; })
        .attr('x', function (d) { return x(d.share) + 8; }).style('opacity', 1);
      note.text(s.note || '');
      CH.show(note, !!s.note, dur);
    }
    return { update: update };
  }

  /* ======================================================================
     stat strip + track list
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
      lastdate: t.last_date,
      setdate: D.featured.meta.date,
      settracks: D.featured.summary.tracks,
      setmins: Math.round(D.featured.meta.minutes),
      setrun: D.featured.summary.longest_harmonic_run
    };
    Object.keys(map).forEach(function (k) {
      [].forEach.call(document.querySelectorAll('[data-dj="' + k + '"]'), function (n) {
        n.textContent = map[k];
      });
    });
  }

  function renderSetlist() {
    var host = document.querySelector('[data-setlist]');
    if (!host) return;
    var tracks = D.featured.tracks;
    var t0 = new Date(D.featured.meta.date + 'T00:00:00');
    var sp = D.featured.meta.start.split(':');
    t0.setHours(+sp[0], +sp[1], 0, 0);
    host.innerHTML = '<table class="data-table setlist"><thead><tr>' +
      '<th>Time</th><th>Track</th><th>BPM</th><th>Key</th></tr></thead><tbody>' +
      tracks.map(function (t) {
        var clock = new Date(t0.getTime() + t.t * 60000);
        return '<tr><td>' + d3.timeFormat('%H:%M')(clock) + '</td>' +
          '<td class="ttl"><strong>' + t.title + '</strong><span>' + t.artist + '</span></td>' +
          '<td>' + (t.bpm || '—') + '</td>' +
          '<td>' + (t.camelot || '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ====================================================================== */
  function showViz(root, which) {
    d3.select(root).selectAll('[data-viz]').each(function () {
      var on = this.getAttribute('data-viz') === which;
      d3.select(this).style('opacity', on ? 1 : 0).attr('aria-hidden', on ? null : 'true');
    });
  }

  var STEPS = [
    { viz: 'wheel', state: { centre: 'the library' }, cap: 'Every track I have played, placed by musical key. Darker = more tracks.' },
    { viz: 'arc', state: {}, cap: 'One night: New Year\'s Eve. Each dot is a track, placed by tempo.' },
    { viz: 'arc', state: { trend: true }, cap: 'Rolling median tempo — the shape of the room.' },
    {
      viz: 'arc', state: {
        trend: true, mark: 'auld lang syne', dx: -60, dy: -54,
        label: 'Auld Lang Syne', sub: '23:59 — the data knows what night it is'
      }, cap: 'Midnight, without anyone having to label it.'
    },
    {
      viz: 'arc', state: {
        trend: true, mark: 'graduation', dx: -70, dy: -40,
        label: 'The closer', sub: '01:47 — Graduation (Friends Forever)'
      }, cap: 'And the last track of the night.'
    },
    { viz: 'wheel', state: { chords: true, centre: 'one night' }, cap: 'Every transition in that set, drawn across the wheel.' },
    { viz: 'wheel', state: { chords: true, only: 'adjacent', centre: 'neighbours' }, cap: 'Only the moves to a neighbouring key.' },
    { viz: 'moves', state: {}, cap: 'All 144 sets, every transition classified.' },
    {
      viz: 'moves', state: { note: 'Tempo tells the same story: I hold within ±6 BPM most of the time, and jump when I want the room to notice.' },
      cap: 'The honest read of my own mixing.'
    }
  ];

  function boot() {
    CH.loadJSON([
      B + 'data/dj/stats.json',
      B + 'data/dj/featured.json'
    ]).then(function (res) {
      D.stats = res[0];
      D.featured = res[1];

      renderStats();
      renderSetlist();

      var VIZ = {
        wheel: makeWheel(document.querySelector('[data-viz="wheel"] .graphic-body')),
        arc: makeArc(document.querySelector('[data-viz="arc"] .graphic-body')),
        moves: makeMoves(document.querySelector('[data-viz="moves"] .graphic-body'))
      };

      var root = document.querySelector('#scrolly-dj');
      Scrolly.init('#scrolly-dj', function (i) {
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
