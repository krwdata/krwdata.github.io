/* ===========================================================================
   site.js — chrome shared by every page: header, footer, counters, tooltip.
   No framework. Everything reads from window.SITE (config.js).
   =========================================================================== */
(function () {
  'use strict';

  var S = window.SITE;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Depth-aware paths: pages live at / and /projects/<slug>/. Every element
     that needs a link declares where it points; we prefix it once here. */
  var base = document.documentElement.getAttribute('data-base') || '';
  function href(p) { return /^(https?:|mailto:|#)/.test(p) ? p : base + p; }
  window.SITE_HREF = href;

  /* --- header ------------------------------------------------------------ */
  function renderHeader() {
    var el = document.querySelector('[data-site-head]');
    if (!el) return;
    var status = S.openToWork
      ? '<span class="status-pill"><span class="status-dot" aria-hidden="true"></span>' + S.statusLine + '</span>'
      : '';
    el.className = 'site-head';
    el.innerHTML =
      '<div class="site-head-in">' +
        '<a class="brand" href="' + href('index.html') + '">' +
          '<span class="brand-name">' + S.name + '</span>' +
          '<span class="brand-title">' + S.title + '</span>' +
        '</a>' +
        '<span class="head-spacer"></span>' +
        status +
        '<nav class="head-links" aria-label="Contact">' +
          '<a href="' + href('index.html') + '#work">Work</a>' +
          '<a href="' + href('index.html') + '#about">About</a>' +
          '<a href="' + href(S.resume) + '">Resume</a>' +
          '<a href="' + S.linkedin + '" rel="noopener">LinkedIn</a>' +
          '<a href="' + S.github + '" rel="noopener">GitHub</a>' +
          '<a href="mailto:' + S.email + '">Email</a>' +
        '</nav>' +
      '</div>';
  }

  /* --- footer ------------------------------------------------------------ */
  function renderFooter() {
    var el = document.querySelector('[data-site-foot]');
    if (!el) return;
    el.className = 'site-foot';
    el.innerHTML =
      '<div class="wrap foot-grid">' +
        '<div>' +
          '<p class="eyebrow">Contact</p>' +
          '<div class="foot-links">' +
            '<a href="mailto:' + S.email + '">' + S.email + '</a>' +
            '<a href="' + S.linkedin + '" rel="noopener">' + S.linkedinLabel + '</a>' +
            '<a href="' + S.github + '" rel="noopener">' + S.githubLabel + '</a>' +
            '<a href="' + href(S.resume) + '">Resume (PDF)</a>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<p class="eyebrow">Colophon</p>' +
          '<p class="foot-note">Hand-built with vanilla HTML, CSS and D3 — no framework, no build step. ' +
          'Every chart on this site is drawn from data in this repo. ' +
          '<a href="' + S.repo + '" rel="noopener">View source →</a></p>' +
        '</div>' +
        '<div>' +
          '<p class="eyebrow">Data note</p>' +
          '<p class="foot-note">Work-project figures are reproduced from seeded synthetic generators that preserve ' +
          'the shape of the original analysis. No employer data appears here.</p>' +
        '</div>' +
      '</div>';
  }

  /* --- animated counters -------------------------------------------------- */
  /* Counts once, on first view. Value + formatting live in data attributes so
     the markup stays readable and the number is present without JS. */
  function initCounters() {
    var nodes = [].slice.call(document.querySelectorAll('[data-count]'));
    if (!nodes.length) return;

    function fmt(v, node) {
      var dp = +(node.getAttribute('data-dp') || 0);
      var s = v.toFixed(dp);
      if (node.getAttribute('data-commas') !== 'false') s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (node.getAttribute('data-prefix') || '') + s;
    }

    function run(node) {
      var target = parseFloat(node.getAttribute('data-count'));
      var unit = node.getAttribute('data-unit') || '';
      var unitHtml = unit ? '<span class="unit">' + unit + '</span>' : '';
      if (reduced) { node.innerHTML = fmt(target, node) + unitHtml; return; }
      var dur = 1100 + Math.random() * 350, t0 = null;
      function tick(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        node.innerHTML = fmt(target * eased, node) + unitHtml;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* --- shared tooltip ----------------------------------------------------- */
  var tipEl = null;
  window.Tip = {
    show: function (html, evt) {
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
      tipEl.innerHTML = html;
      tipEl.style.opacity = 1;
      this.move(evt);
    },
    move: function (evt) {
      if (!tipEl) return;
      var pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      var x = evt.clientX + pad, y = evt.clientY + pad;
      if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
      tipEl.style.left = x + 'px';
      tipEl.style.top = y + 'px';
    },
    hide: function () { if (tipEl) tipEl.style.opacity = 0; }
  };

  /* --- sticky offsets ----------------------------------------------------- */
  /* The header and the frame rail are both sticky, and both change height with
     the viewport. Hard-coding their offsets in CSS breaks the moment the nav
     wraps, so measure once and publish the numbers as custom properties. */
  function measureSticky() {
    var head = document.querySelector('.site-head');
    var rail = document.querySelector('.frame-rail');
    var h = head ? head.offsetHeight : 52;
    var r = rail ? rail.offsetHeight : 0;
    var root = document.documentElement;
    root.style.setProperty('--head-h', h + 'px');
    root.style.setProperty('--stick-h', (h + r) + 'px');
  }

  /* --- year stamp --------------------------------------------------------- */
  function stampYear() {
    [].forEach.call(document.querySelectorAll('[data-year]'), function (n) {
      n.textContent = new Date().getFullYear();
    });
  }

  function boot() {
    renderHeader();
    renderFooter();
    initCounters();
    stampYear();
    measureSticky();
    window.addEventListener('resize', measureSticky, { passive: true });
    // Web fonts land after first paint and change the header's height.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureSticky);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.SITE_REDUCED_MOTION = reduced;
})();
