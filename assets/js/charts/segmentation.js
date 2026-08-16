/* ===========================================================================
   segmentation.js — charts for the consumer segmentation case study.
   The scatter is the workhorse: same 1,800 devices throughout, re-projected
   onto different axis pairs and recoloured as the story narrows.
   =========================================================================== */
(function () {
  'use strict';

  var B = document.documentElement.getAttribute('data-base') || '';
  var D = {};
  var SEG_COLOR = {};
  var PAL = CH.PALETTE;

  /* ======================================================================
     1. ROLLUP — five million rows become six groups
     ====================================================================== */
  function makeRollup(el) {
    var f = CH.frame(el, { top: 26, right: 24, bottom: 24, left: 24 });
    var rows = D.rollup.stages;
    var y = d3.scaleBand().domain(rows.map(function (r) { return r.label; }))
      .range([0, f.ih]).padding(0.5);
    // Log-ish width: 5M and 6 on the same linear axis would make the last bar
    // invisible, and the point is the funnel, not the arithmetic.
    var x = d3.scaleSqrt().domain([0, rows[0].value]).range([0, f.iw]);

    var g = f.g.selectAll('g').data(rows).enter().append('g')
      .attr('transform', function (d) { return 'translate(0,' + y(d.label) + ')'; });

    g.append('rect').attr('height', y.bandwidth()).attr('rx', 2).attr('width', 0)
      .attr('fill', function (d, i) { return i === rows.length - 1 ? 'var(--accent-mark)' : 'var(--neutral)'; })
      .attr('opacity', function (d, i) { return i === rows.length - 1 ? 1 : 0.3 + i * 0.08; });

    g.append('text').attr('class', 'annot-label').attr('y', -10).style('font-size', '12.5px')
      .text(function (d) { return d.label; });
    var vals = g.append('text').attr('class', 'annot-label')
      .attr('y', y.bandwidth() / 2).attr('dy', '0.32em').attr('x', 10)
      .style('font-size', '13px').style('opacity', 0)
      .text(function (d) { return CH.fmt.int(d.value); });
    /* Each row is three stacked lines — label, bar, detail — and that needs
       about 46px of vertical step. The graphic is 42vh on a phone, so six rows
       get ~32px each and the detail line lands on top of the NEXT row's label,
       running off the card as well because it is the longest string here. Drop
       it when there is no room: the caption and the prose beside the chart say
       the same thing, and a collision reads as a bug where an absence does not. */
    if (y.step() >= 46) {
      g.append('text').attr('class', 'annot-sub').attr('y', y.bandwidth() + 16)
        .style('font-size', '11.5px').text(function (d) { return d.detail; });
    }

    function update(s) {
      var upto = s.upto === undefined ? rows.length : s.upto;
      var dur = CH.reduced ? 0 : 700;
      g.select('rect').transition().duration(dur).delay(function (d, i) { return i * 140; })
        .attr('width', function (d, i) { return i < upto ? Math.max(3, x(d.value)) : 0; });
      /* The first row's bar IS the full width — x's domain maxes at it — so
         `end + 10` starts 10px past the plot in a 24px margin and "5,000,000"
         ran outside the card. CH.barLabel measures and flips it inside.
         Anchor is set before the transition rather than tweened: the label is
         fading in from opacity 0 anyway, so the switch is never seen. */
      vals.each(function (d, i) {
        var on = i < upto;
        var end = on ? Math.max(3, x(d.value)) : 0;
        var p = CH.barLabel(this, end, f);
        d3.select(this).attr('text-anchor', on ? p.anchor : 'start')
          .transition().duration(dur).delay(i * 140 + 200)
          .attr('x', on ? p.x : 10)
          .style('opacity', on ? 1 : 0);
      });
    }
    return { update: update };
  }

  /* ======================================================================
     2. SCATTER — the device cloud, re-projected
     ====================================================================== */
  function makeScatter(el) {
    var f = CH.frame(el, { top: 20, right: 24, bottom: 44, left: 58 });
    var rows = D.devices.rows;
    var labels = {};
    D.devices.meta.features.forEach(function (ft) { labels[ft.key] = ft.label; });

    var x = d3.scaleLinear().range([0, f.iw]);
    var y = d3.scaleLinear().range([f.ih, 0]);

    var gridG = f.g.append('g').attr('class', 'grid');
    var xAxisG = f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')');
    var yAxisG = f.g.append('g').attr('class', 'axis');
    var xLab = f.g.append('text').attr('class', 'chart-sub')
      .attr('x', f.iw).attr('y', f.ih + 36).attr('text-anchor', 'end');
    var yLab = f.g.append('text').attr('class', 'chart-sub')
      .attr('transform', 'rotate(-90)').attr('x', 0).attr('y', -42).attr('text-anchor', 'end');

    var dots = f.g.append('g').selectAll('circle').data(rows).enter().append('circle')
      .attr('r', 2.9).attr('fill', 'var(--neutral)').attr('opacity', 0.5)
      .style('cursor', 'crosshair');

    dots.on('mousemove', function (evt, d) {
      Tip.show('<span class="tip-k">' + (SEG_NAME[d.segment] || 'device') + '</span>' +
        Math.round(d.dur) + ' min average cook<br>' +
        Math.round(d.temp) + '°F average set point<br>' +
        Math.round(d.smoke) + '% of cooks with smoke mode', evt);
    }).on('mouseleave', function () { Tip.hide(); });

    var SEG_NAME = {};
    D.segments.forEach(function (s) { SEG_NAME[s.key] = s.name; });

    var legendEl = el.closest('figure').querySelector('[data-legend]');
    if (legendEl) {
      legendEl.innerHTML = D.segments.map(function (s) {
        return '<span class="legend-item" data-k="' + s.key + '">' +
          '<span class="legend-swatch" style="background:' + SEG_COLOR[s.key] +
          ';border-radius:50%;width:8px;height:8px"></span>' + s.name + '</span>';
      }).join('');
      legendEl.style.opacity = 0;
    }

    var cur = { xKey: 'dur', yKey: 'temp' };

    function domainFor(key) {
      var ext = d3.extent(rows, function (r) { return r[key]; });
      var pad = (ext[1] - ext[0]) * 0.06;
      return [Math.max(0, ext[0] - pad), ext[1] + pad];
    }

    function axes() {
      xAxisG.call(d3.axisBottom(x).ticks(6));
      yAxisG.call(d3.axisLeft(y).ticks(6));
      gridG.call(d3.axisLeft(y).ticks(6).tickSize(-f.iw).tickFormat(''));
      gridG.select('.domain').remove();
      xLab.text(labels[cur.xKey]);
      yLab.text(labels[cur.yKey]);
    }

    x.domain(domainFor('dur'));
    y.domain(domainFor('temp'));
    axes();
    dots.attr('cx', function (d) { return x(d.dur); }).attr('cy', function (d) { return y(d.temp); });

    function update(s) {
      var dur = CH.reduced ? 0 : 900;
      var xKey = s.x || cur.xKey, yKey = s.y || cur.yKey;
      var moved = xKey !== cur.xKey || yKey !== cur.yKey;
      cur.xKey = xKey; cur.yKey = yKey;

      var ix = d3.interpolate(x.domain(), domainFor(xKey));
      var iy = d3.interpolate(y.domain(), domainFor(yKey));

      // Remember where each dot is now so it can travel rather than jump.
      var from = new Map();
      dots.each(function (d) { from.set(d, [+this.getAttribute('cx'), +this.getAttribute('cy')]); });

      f.g.transition().duration(moved ? dur : 0).ease(d3.easeCubicInOut)
        .tween('proj', function () {
          return function (k) {
            x.domain(ix(k)); y.domain(iy(k));
            dots.attr('cx', function (d) {
              var p = from.get(d);
              return p[0] + (x(d[xKey]) - p[0]) * k;
            }).attr('cy', function (d) {
              var p = from.get(d);
              return p[1] + (y(d[yKey]) - p[1]) * k;
            });
            axes();
          };
        })
        .on('end', function () {
          dots.attr('cx', function (d) { return x(d[xKey]); })
              .attr('cy', function (d) { return y(d[yKey]); });
        });

      if (!moved) {
        dots.attr('cx', function (d) { return x(d[xKey]); })
            .attr('cy', function (d) { return y(d[yKey]); });
      }

      dots.transition().duration(dur)
        .attr('fill', function (d) {
          if (!s.color) return 'var(--neutral)';
          if (s.focus && d.segment !== s.focus) return 'var(--neutral)';
          return SEG_COLOR[d.segment];
        })
        .attr('opacity', function (d) {
          if (!s.color) return 0.5;
          if (s.focus) return d.segment === s.focus ? 0.85 : 0.12;
          return 0.72;
        })
        .attr('r', function (d) {
          return s.focus && d.segment === s.focus ? 3.6 : 2.9;
        });

      if (legendEl) {
        legendEl.style.opacity = s.color ? 1 : 0;
        d3.select(legendEl).selectAll('.legend-item').style('opacity', function () {
          var k = this.getAttribute('data-k');
          return !s.focus || k === s.focus ? 1 : 0.3;
        });
      }
    }

    return { update: update };
  }

  /* ======================================================================
     3. ELBOW — how many groups are actually there
     ====================================================================== */
  function makeElbow(el) {
    var f = CH.frame(el, { top: 26, right: 30, bottom: 46, left: 60 });
    var rows = D.elbow;
    var x = d3.scaleLinear().domain(d3.extent(rows, function (r) { return r.k; })).range([0, f.iw]);
    var y = d3.scaleLinear().domain([0, d3.max(rows, function (r) { return r.wss; }) * 1.06]).range([f.ih, 0]);

    f.g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-f.iw).tickFormat(''))
      .select('.domain').remove();
    f.g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + f.ih + ')')
      .call(d3.axisBottom(x).ticks(rows.length).tickFormat(function (v) { return 'k=' + v; }));
    f.g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(CH.fmt.compact));
    f.g.append('text').attr('class', 'chart-sub')
      .attr('transform', 'rotate(-90)').attr('y', -46).attr('text-anchor', 'end')
      .text('WITHIN-CLUSTER SUM OF SQUARES');

    var line = d3.line().x(function (d) { return x(d.k); }).y(function (d) { return y(d.wss); })
      .curve(d3.curveMonotoneX);
    var path = f.g.append('path').datum(rows).attr('class', 'series-line series-hi')
      .attr('d', line).style('opacity', 0);
    var pts = f.g.selectAll('circle').data(rows).enter().append('circle')
      .attr('cx', function (d) { return x(d.k); }).attr('cy', function (d) { return y(d.wss); })
      .attr('r', 4).attr('fill', 'var(--accent-mark)').style('opacity', 0);
    var annotG = f.g.append('g');

    var drawn = false;
    function update(s) {
      var dur = CH.reduced ? 0 : 500;
      CH.show(path, true, dur);
      CH.show(pts, true, dur);
      if (!drawn) { drawn = true; CH.drawIn(path, 1100); }
      annotG.selectAll('*').remove();
      if (s.mark) {
        var d = rows.filter(function (r) { return r.k === s.mark; })[0];
        window.setTimeout(function () {
          CH.annotate(annotG, {
            key: 'e', x: x(d.k), y: y(d.wss), dx: 44, dy: -52,
            label: 'k = ' + d.k, sub: 'the last split that buys much'
          }).style('opacity', 0).transition().duration(340).style('opacity', 1);
        }, 400);
      }
    }
    return { update: update };
  }

  /* ======================================================================
     profile table
     ====================================================================== */
  function renderTable() {
    var host = document.querySelector('[data-seg-table]');
    if (!host) return;
    host.innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th>Segment</th><th>Share</th><th>Avg cook</th><th>Set temp</th>' +
      '<th>Smoke</th><th>Weekend</th><th>Set points</th></tr></thead><tbody>' +
      D.segments.map(function (s) {
        return '<tr>' +
          '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
          SEG_COLOR[s.key] + ';margin-right:8px"></span>' + s.name + '</td>' +
          '<td>' + s.share + '%</td>' +
          '<td>' + Math.round(s.profile.dur) + ' min</td>' +
          '<td>' + Math.round(s.profile.temp) + '°F</td>' +
          '<td>' + Math.round(s.profile.smoke) + '%</td>' +
          '<td>' + Math.round(s.profile.wknd) + '%</td>' +
          '<td>' + s.profile.chg.toFixed(1) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderCards() {
    var host = document.querySelector('[data-seg-cards]');
    if (!host) return;
    host.innerHTML = D.segments.map(function (s) {
      return '<div class="seg-card" style="--seg:' + SEG_COLOR[s.key] + '">' +
        '<span class="seg-share">' + s.share + '%</span>' +
        '<h4>' + s.name + '</h4>' +
        '<p>' + s.blurb + '</p></div>';
    }).join('');
  }

  /* ====================================================================== */
  function showViz(root, which) {
    d3.select(root).selectAll('[data-viz]').each(function () {
      var on = this.getAttribute('data-viz') === which;
      d3.select(this).style('opacity', on ? 1 : 0).attr('aria-hidden', on ? null : 'true');
    });
  }

  var STEPS = [
    { viz: 'rollup', state: { upto: 2 }, cap: 'Raw events, filtered down to cooks that actually happened.' },
    { viz: 'rollup', state: { upto: 4 }, cap: 'Device-level profiles are the unit the model reasons about.' },
    { viz: 'scatter', state: { x: 'dur', y: 'temp' }, cap: 'Every dot is one device. No labels, no groups — just behaviour.' },
    { viz: 'elbow', state: { mark: 6 }, cap: 'k-means run for k = 2 to 8 on the same feature set.' },
    { viz: 'scatter', state: { x: 'dur', y: 'temp', color: true }, cap: 'Six segments, coloured.' },
    { viz: 'scatter', state: { x: 'dur', y: 'smoke', color: true }, cap: 'Same devices, projected onto duration and smoke-mode use.' },
    { viz: 'scatter', state: { x: 'dur', y: 'temp', color: true, focus: 'default' }, cap: 'The largest segment.' },
    { viz: 'scatter', state: { x: 'chg', y: 'ramp', color: true, focus: 'tinkerer' }, cap: 'Set points per cook against mid-cook temperature ramps.' },
    { viz: 'scatter', state: { x: 'dur', y: 'wknd', color: true, focus: 'overnight' }, cap: 'Duration against the share of cooks at the weekend.' }
  ];

  function boot() {
    CH.loadJSON([
      B + 'data/segmentation/devices.json',
      B + 'data/segmentation/segments.json',
      B + 'data/segmentation/elbow.json',
      B + 'data/segmentation/rollup.json'
    ]).then(function (res) {
      D.devices = res[0];
      D.segments = res[1].rows;
      D.elbow = res[2].rows;
      D.rollup = res[3];
      D.segments.forEach(function (s, i) { SEG_COLOR[s.key] = PAL[i % PAL.length]; });

      var VIZ = {
        rollup: makeRollup(document.querySelector('[data-viz="rollup"] .graphic-body')),
        scatter: makeScatter(document.querySelector('[data-viz="scatter"] .graphic-body')),
        elbow: makeElbow(document.querySelector('[data-viz="elbow"] .graphic-body'))
      };
      renderTable();
      renderCards();

      var root = document.querySelector('#scrolly-seg');
      Scrolly.init('#scrolly-seg', function (i) {
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
