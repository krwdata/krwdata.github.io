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
          /* This used to read "No employer data appears here." It cannot, now
             that the Woodridge page states the size of the warehouse outright.
             Claiming less than is true is the only version worth publishing. */
          '<p class="foot-note">Every chart from a work project is drawn from a seeded synthetic generator ' +
          'that preserves the shape of the original analysis and none of its values. Figures describing the ' +
          'scale of systems I have worked on, and the methods behind them, are real.</p>' +
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

  /* --- source links ------------------------------------------------------- */
  /* Anything marked data-code="path" points into the repo on GitHub rather than
     at this host: Pages serves .py as a raw download and 404s on a directory,
     so neither does the job of "go and read this". The markup carries a working
     absolute href too, so this only keeps it in sync — it is not required. */
  function wireCodeLinks() {
    [].forEach.call(document.querySelectorAll('[data-code]'), function (a) {
      var path = a.getAttribute('data-code');
      var dir = path.slice(-1) === '/';
      a.href = (dir ? S.treeBase : S.codeBase) + path;
      a.setAttribute('rel', 'noopener');
    });
  }

  /* --- step-card glyphs --------------------------------------------------- */
  /* A scrolly step can declare data-icon="anchor" and get that glyph washed in
     behind its prose. It is a second, wordless statement of the step's claim —
     the sort of thing a print designer would set as a drop capital.

     Rules it has to obey to be worth having:
       - decoration only. Never the sole carrier of a fact (rule 5 in the
         handoff), so it is aria-hidden and pointer-events: none.
       - drawn, not imported. Stroke paths on a 24-unit grid, inheriting
         currentColor, so one CSS token controls every glyph on the site and
         there are no image requests.
       - keyed to .is-active, so it arrives with the card rather than sitting
         there competing with the step above it.

     Add one by adding a path here. Keep them geometric: at 130px and 11%
     opacity, detail turns to fog. */
  var GLYPHS = {
    /* — Woodridge, the data-quality half — */
    spike:    'M2 19l4-1 2 1 2-15 2 15 3-1 5 1',                    // a rate that can't exist
    zoom:     'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M15.2 15.2L21 21',
    clocks:   'M8.5 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12M8.5 6.2V9l2.2 1.4' +
              'M15.5 9a6 6 0 1 1 0 12 6 6 0 0 1 0-12M15.5 12.2V15l2.2 1.4',
    split:    'M2 12h7M9 12l5-6h7M9 12l5 6h7',                      // two timestamps, two answers
    boundary: 'M12 2v20M4 7h5M4 12h5M4 17h5M15 10h5M15 15h5M15 20h5', // the week line
    anchor:   'M12 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M12 6.5V21M6.5 11h11M3 14a9 9 0 0 0 18 0',
    taper:    'M2 4c5 0 7 3 9 8s4 7 11 7',                          // elevated, then falling away
    /* — Woodridge, the churn half — */
    fleet:    'M5 6h.01M12 6h.01M19 6h.01M5 12h.01M12 12h.01M19 12h.01M5 18h.01M12 18h.01M19 18h.01',
    funnel:   'M3 4h18l-7 8v9l-4-2v-7z',
    silence:  'M2 12h6M16 12h6M10.5 12h.01M13 12h.01',              // eight weeks of nothing
    target:   'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M12 12h.01',
    rank:     'M3 6h16M3 12h11M3 18h6',
    /* — DJ — */
    wheel:    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10' +
              'M12 2v5M22 12h-5M12 22v-5M2 12h5M19.1 4.9l-3.6 3.6M19.1 19.1l-3.6-3.6M4.9 19.1l3.6-3.6M4.9 4.9l3.6 3.6',
    tempo:    'M2 15c3 0 3-9 6-9s3 12 6 12 3-9 6-9 2 3 2 3',        // the arc of a night
    midnight: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7',
    chords:   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M5 6l13 5M4 14l16-6M7 20l9-15',
    exit:     'M14 3h6v18h-6M11 12H2M11 12L7.5 8.5M11 12l-3.5 3.5',  // the way out
    balance:  'M12 3v16M6 21h12M4 8h16M4 8l-2.5 5.5h5zM20 8l-2.5 5.5h5z',
    pulse:    'M2 12h4l2-5 3 10 3-7 2 2h6',                          // the energy of a room
    pair:     'M9 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14',
    slope:    'M4 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4M20 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4M6 15l12-4',
    mirror:   'M12 2v20M8 6L3 12l5 6M16 6l5 6-5 6',                  // two of the same thing
    /* — Scorecard API — */
    stopwatch: 'M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 9v4l3 2M9.5 2.5h5M12 2.5v2.5',
    layers:   'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',                     // what was already there
    api:      'M2 12h11M13 12l-4-4M13 12l-4 4M17 4h5v16h-5',         // one request, at the end
    docs:     'M8 3h7l4 4v12H8zM15 3v4h4M4 7v14h11',
    stairs:   'M3 20h4v-5h4v-5h4V5h6',                               // the set-point profile
    diverge:  'M2 12h6M8 12c5 0 4-7 14-7M8 12c5 0 4 7 14 7',         // two channels, on purpose
    gauge:    'M3 18a9 9 0 1 1 18 0M12 18l5-7M12 18h.01',
    /* — Segmentation — */
    scatter:  'M3 3v18h18M7 16h.01M9 11h.01M12 14h.01M14 7h.01M17 12h.01M19 6h.01M7 9h.01M16 17h.01M11 6h.01',
    elbow:    'M3 3v18h18M6 6c2 9 4 11 13 12',                       // choosing k honestly
    clusters: 'M5 6h.01M7 8h.01M4 9h.01M17 6h.01M19 8h.01M16 9h.01M11 16h.01M13 18h.01M10 19h.01'
  };

  /* Inject the declared glyph behind each card that asks for one. */
  function renderGlyphs() {
    [].forEach.call(document.querySelectorAll('[data-icon]'), function (host) {
      if (host.querySelector('.step-glyph')) return;      // idempotent
      var d = GLYPHS[host.getAttribute('data-icon')];
      if (!d) return;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'step-glyph');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '1.4');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p);
      host.insertBefore(svg, host.firstChild);
    });
  }
  window.SITE_GLYPHS = GLYPHS;      // so the console can list what's available

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
    wireCodeLinks();
    renderGlyphs();
    measureSticky();
    window.addEventListener('resize', measureSticky, { passive: true });
    // Web fonts land after first paint and change the header's height.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureSticky);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.SITE_REDUCED_MOTION = reduced;
})();
