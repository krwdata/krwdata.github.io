# kylerobert425.github.io

Portfolio for **Kyle Woods** — Data Analyst & Analytics Engineer, Salt Lake City.

A mission-control dashboard that opens into four scroll-driven case studies.
Vanilla HTML, CSS and D3. No framework, no build step, no dependencies to
install — the only third-party file in the repo is `d3.v7.min.js`, vendored
locally so the site works offline.

Live at **https://kylerobert425.github.io**

---

## Run it locally

Charts load their data with `fetch()`, which browsers block on `file://`. So
you need a server — any server. Python has one built in:

```bash
cd kylerobert425.github.io
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Nothing to install, nothing to compile.

(If you do open `index.html` straight off disk, the pages still render — the
charts just replace themselves with a note telling you to start a server.)

---

## Deploy

This repo is named `<username>.github.io`, so GitHub Pages serves it from the
root of the default branch. One-time setup:

1. Create a public repo called **`kylerobert425.github.io`**.
2. Push this directory to it.
3. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`.**

That's it. Every push to `main` republishes within a minute or two. The
`.nojekyll` file stops GitHub from running Jekyll over the directory, which
would otherwise ignore anything beginning with an underscore.

```bash
cd kylerobert425.github.io
git remote add origin git@github.com:kylerobert425/kylerobert425.github.io.git
git branch -M main
git push -u origin main
```

---

## Layout

```
index.html                          the dashboard
projects/
  scorecard-api/                    Past → Present → Future
  woodridge-churn/                  Problem → Root cause → Fix
  consumer-segmentation/            Past → Present → Future
  anatomy-of-a-dj-set/              the personal one, real data
assets/
  css/theme.css                     design tokens + shared components
  css/dashboard.css                 landing page
  css/case-study.css                scrollytelling pages
  js/config.js                      ← name, email, links. Edit here only.
  js/site.js                        header, footer, counters, tooltip
  js/scrolly.js                     the scroll engine (IntersectionObserver)
  js/dashboard.js                   the live panel previews
  js/charts/                        one file per case study + common.js
  img/                              headshot, DJ photo, OG images, favicon
data/
  generators/                       the scripts that produce everything below
  scorecard/  woodridge/            synthetic JSON
  segmentation/  dj/                (dj/ is real, parsed from Serato)
resume/                             the PDF the site links to
```

### Changing your details

Everything personal lives in one object: `assets/js/config.js`. Name, title,
email, LinkedIn, GitHub, resume path, and whether the "open to work" indicator
shows in the header. Nothing else hard-codes them.

---

## The data

**Three of the four projects were built at work, so none of the real numbers
appear here.** Every chart on those pages is drawn from seeded, deterministic
generators that reproduce the *shape* of the original analysis — the fleet
ramp, the seasonality, the ranking of components, the data-quality bug — and
none of its values. The generators are commented with what real-world
behaviour each part preserves, and they are meant to be read.

```bash
cd data/generators
python3 gen_scorecard.py        # thermal test traces + graded scorecard
python3 gen_woodridge.py        # weekly error rates, the week-anchor bug, churn
python3 gen_segmentation.py     # behavioural clusters + a real k-means elbow
```

Standard library only. No numpy, no pandas. Each script prints a summary of
what it wrote, and re-running any of them reproduces byte-identical output.

**The DJ project is real data.** `parse_serato.py` reads Serato DJ Pro's
undocumented binary session files and emits derived JSON:

```bash
python3 parse_serato.py                      # uses ../../../dj-data/serato
python3 parse_serato.py --featured 5797-2    # feature a different set
```

The raw Serato library is deliberately **not** in this repo — it contains
absolute filesystem paths. It lives in `dj-data/` one directory up, which is
git-ignored. See `dj-data/README.md` for how to refresh it.

---

## What's where, if you want to read the interesting parts

| You want to see | Look at |
|---|---|
| The scroll engine, in ~60 lines | `assets/js/scrolly.js` |
| A chart that morphs between two datasets and rescales its axis mid-transition | `assets/js/charts/woodridge.js` → `makeRates` |
| Reverse-engineering a binary format | `data/generators/parse_serato.py` |
| A bug reproduced honestly rather than faked | `data/generators/gen_woodridge.py` → `broken_trends` |
| k-means in pure Python, no libraries | `data/generators/gen_segmentation.py` |

---

## Colour

Five brand colours — tiger orange `#F88714`, crimson violet `#720E3D`, deep pink
`#E14FAD`, onyx `#141516`, scarlet fire `#F0401B` — declared once at the top of
`assets/css/theme.css` and derived from there.

Two things in that file are worth knowing before changing a colour:

- **The orange does not do the same job on both surfaces.** It is brilliant on
  onyx and only 2.2:1 on paper, so there are three accent tokens: `--accent`
  for chrome on dark, `--accent-mark` for marks on either surface, and
  `--accent-ink` (the crimson, ~10:1) for accent *text* on light.
- **The six chart slots were validated, not chosen.** They clear the lightness
  band, the chroma floor, adjacent-pair separation under simulated protanopia
  and deuteranopia, and contrast — against the light paper *and* the dark panel.
  Four warm brand hues cannot carry six categories: under colour-blindness
  simulation they collapse into each other, so blue, gold and teal are added as
  the smallest set that clears the gates while keeping orange, pink and crimson
  in the first slots. Status colours (`--good` / `--warn` / `--bad`) are
  reserved and never used for a series.

## Accessibility & performance notes

- Every page has a skip link, landmark elements and labelled navigation.
- `prefers-reduced-motion` is respected: counters snap to their value, lines
  appear instead of drawing themselves, and chart transitions run at zero
  duration. The content never depends on the animation.
- Charts are progressive enhancement — the prose carries the argument on its
  own, and every figure has a caption stating what it shows.
- The dashboard degrades to stacked cards below 860px; case-study graphics pin
  full width above their step text below the same breakpoint.
- Sticky offsets are measured at runtime rather than hard-coded, so the layout
  survives the header wrapping on small screens.
- No chart depends on colour alone: every multi-series figure carries a legend,
  the focused series is directly labelled, and the underlying numbers appear in
  a table or in the prose.

---

## Licence

Code is free to reuse. The writing, the photographs and the DJ data are not.
