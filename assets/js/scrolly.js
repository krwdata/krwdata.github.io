/* ===========================================================================
   scrolly.js — the scroll engine. ~60 lines of IntersectionObserver instead of
   a library: a step becomes active when it crosses the middle band of the
   viewport, and the graphic column is told which state to draw.
   =========================================================================== */
(function () {
  'use strict';

  /**
   * Wire one scrolly section.
   * @param {string} sel   selector for the .scrolly container
   * @param {function(number, HTMLElement)} onStep  called with (index, el)
   */
  function scrolly(sel, onStep) {
    var root = document.querySelector(sel);
    if (!root) return;
    var steps = [].slice.call(root.querySelectorAll('.step'));
    if (!steps.length) return;

    var current = -1;
    function activate(i) {
      if (i === current) return;
      current = i;
      steps.forEach(function (s, j) { s.classList.toggle('is-active', j === i); });
      onStep(i, steps[i]);
    }

    var io = new IntersectionObserver(function (entries) {
      // The band is thin, so at most one step is inside it. Take the last
      // entering entry; if none is inside, keep whatever was active.
      var hit = null;
      entries.forEach(function (e) { if (e.isIntersecting) hit = e.target; });
      if (hit) activate(steps.indexOf(hit));
    }, { rootMargin: '-48% 0px -48% 0px', threshold: 0 });

    steps.forEach(function (s) { io.observe(s); });

    // Draw step 0 immediately so the graphic is never blank on load.
    activate(0);

    // If the page loads mid-scroll (refresh, back button), snap to the right step.
    requestAnimationFrame(function () {
      var mid = window.innerHeight / 2, best = 0, bestD = Infinity;
      steps.forEach(function (s, j) {
        var r = s.getBoundingClientRect();
        var d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestD) { bestD = d; best = j; }
      });
      activate(best);
    });
  }

  /* --- frame rail: highlights PROBLEM / ROOT CAUSE / FIX as you pass ------- */
  function frameRail() {
    var links = [].slice.call(document.querySelectorAll('.frame-step'));
    if (!links.length) return;
    var targets = links
      .map(function (a) { return document.querySelector(a.getAttribute('href')); })
      .filter(Boolean);
    if (!targets.length) return;

    function sync() {
      var line = window.innerHeight * 0.34, active = 0;
      targets.forEach(function (t, i) { if (t.getBoundingClientRect().top <= line) active = i; });
      links.forEach(function (a, i) { a.classList.toggle('is-active', i === active); });
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { sync(); ticking = false; });
    }, { passive: true });
    sync();
  }

  /* --- responsive redraw -------------------------------------------------- */
  /* Charts re-measure on resize; debounced so dragging a window is cheap. */
  var resizeFns = [];
  function onResize(fn) { resizeFns.push(fn); }
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resizeFns.forEach(function (f) { f(); }); }, 160);
  });

  window.Scrolly = { init: scrolly, rail: frameRail, onResize: onResize };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', frameRail);
  else frameRail();
})();
